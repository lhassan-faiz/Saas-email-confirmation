import { Job, Worker } from "bullmq";
import { config } from "../config";
import { pool, query } from "../db/pool";
import { PROVISION_QUEUE_NAME, ProvisionTrialJobPayload } from "../jobs/queue";
import { CryptoService } from "../services/crypto.service";
import { EmailService } from "../services/email.service";
import { IptvService } from "../services/iptv.service";
import { loggerConfig } from "../utils/logger";

interface TrialRow {
  id: string;
  first_name: string;
  email: string;
  trial_type: "m3u" | "mag";
  mac_address: string | null;
  status: string;
}

interface ServiceAccountRow {
  id: string;
  username: string;
  password_ciphertext: string;
  password_iv: string;
  password_auth_tag: string;
  host: string;
  playlist_url: string | null;
  expires_at: string | Date;
}

const cryptoService = new CryptoService();
const emailService = new EmailService();
const iptvService = new IptvService();

async function processProvisionJob(job: Job<ProvisionTrialJobPayload>): Promise<void> {
  const trialRequestId = job.data.trialRequestId;

  const trialResult = await query<TrialRow>(
    `
      SELECT id, first_name, email, trial_type, mac_address, status
      FROM trial_requests
      WHERE id = $1
      LIMIT 1
    `,
    [trialRequestId],
  );

  const trial = trialResult.rows[0];
  if (!trial) {
    return;
  }

  if (trial.status === "PENDING_EMAIL_VERIFICATION") {
    throw new Error("Trial still pending email verification");
  }

  let accountResult = await query<ServiceAccountRow>(
    `
      SELECT id, username, password_ciphertext, password_iv, password_auth_tag, host, playlist_url, expires_at
      FROM service_accounts
      WHERE trial_request_id = $1
      LIMIT 1
    `,
    [trialRequestId],
  );
  let account = accountResult.rows[0];
  let plaintextPassword: string;

  if (!account) {
    const provisioned = await iptvService.createTrial({
      email: trial.email,
      trialType: trial.trial_type,
      macAddress: trial.mac_address,
    });

    const encrypted = cryptoService.encrypt(provisioned.password);
    const expiresAt = provisioned.expiresAt ?? new Date(Date.now() + config.iptvTrialDurationHours * 60 * 60 * 1000);

    try {
      const insertAccount = await query<ServiceAccountRow>(
        `
          INSERT INTO service_accounts (
            trial_request_id, username, password_ciphertext, password_iv, password_auth_tag, host, playlist_url, expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, username, password_ciphertext, password_iv, password_auth_tag, host, playlist_url, expires_at
        `,
        [
          trialRequestId,
          provisioned.username,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          provisioned.host,
          provisioned.playlistUrl ?? null,
          expiresAt,
        ],
      );
      account = insertAccount.rows[0];
      plaintextPassword = provisioned.password;
    } catch (error) {
      accountResult = await query<ServiceAccountRow>(
        `
          SELECT id, username, password_ciphertext, password_iv, password_auth_tag, host, playlist_url, expires_at
          FROM service_accounts
          WHERE trial_request_id = $1
          LIMIT 1
        `,
        [trialRequestId],
      );
      account = accountResult.rows[0];
      if (!account) {
        throw error;
      }
      plaintextPassword = cryptoService.decrypt({
        ciphertext: account.password_ciphertext,
        iv: account.password_iv,
        authTag: account.password_auth_tag,
      });
    }

    await query(
      `
        UPDATE trial_requests
        SET status = 'PROVISIONED', updated_at = NOW()
        WHERE id = $1
          AND status IN ('VERIFIED_PENDING_PROVISION', 'FAILED', 'PROVISIONED')
      `,
      [trialRequestId],
    );
  } else {
    plaintextPassword = cryptoService.decrypt({
      ciphertext: account.password_ciphertext,
      iv: account.password_iv,
      authTag: account.password_auth_tag,
    });
  }

  const deliveredAlready = await query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM deliveries
        WHERE trial_request_id = $1
          AND channel = 'email'
          AND status = 'SENT'
      ) AS exists
    `,
    [trialRequestId],
  );

  if (deliveredAlready.rows[0]?.exists) {
    await query(
      `
        UPDATE trial_requests
        SET status = 'DELIVERED', updated_at = NOW()
        WHERE id = $1
      `,
      [trialRequestId],
    );
    return;
  }

  await emailService.sendCredentialsEmail({
    to: trial.email,
    firstName: trial.first_name,
    trialType: trial.trial_type,
    username: account.username,
    password: plaintextPassword,
    host: account.host,
    playlistUrl: account.playlist_url,
    expiresAt: new Date(account.expires_at),
  });

  await query(
    `
      INSERT INTO deliveries (trial_request_id, channel, status, error)
      VALUES ($1, 'email', 'SENT', NULL)
    `,
    [trialRequestId],
  );

  await query(
    `
      UPDATE trial_requests
      SET status = 'DELIVERED', updated_at = NOW()
      WHERE id = $1
    `,
    [trialRequestId],
  );
}

const worker = new Worker<ProvisionTrialJobPayload>(PROVISION_QUEUE_NAME, processProvisionJob, {
  connection: {
    url: config.redisUrl,
  },
  concurrency: 5,
});

worker.on("ready", () => {
  // eslint-disable-next-line no-console
  console.log(`[worker] ready (${loggerConfig.level})`);
});

worker.on("completed", (job) => {
  // eslint-disable-next-line no-console
  console.log(`[worker] completed trial=${job.data.trialRequestId}`);
});

worker.on("failed", async (job, err) => {
  if (!job) return;

  const maxAttempts = job.opts.attempts ?? 1;
  if (job.attemptsMade >= maxAttempts) {
    await query(
      `
        INSERT INTO deliveries (trial_request_id, channel, status, error)
        VALUES ($1, 'email', 'FAILED', $2)
      `,
      [job.data.trialRequestId, err.message.slice(0, 2000)],
    );
    await query(
      `
        UPDATE trial_requests
        SET status = 'FAILED', updated_at = NOW()
        WHERE id = $1
      `,
      [job.data.trialRequestId],
    );
  }

  // eslint-disable-next-line no-console
  console.error(`[worker] failed trial=${job.data.trialRequestId} err=${err.message}`);
});

async function shutdown(): Promise<void> {
  await worker.close();
  await pool.end();
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
