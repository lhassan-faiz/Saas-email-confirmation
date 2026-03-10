import crypto from "node:crypto";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { PoolClient } from "pg";
import { config } from "../config";
import { query, withTransaction } from "../db/pool";
import { AppError } from "../utils/errors";
import { TrialStatus } from "../types/trial";

interface VerificationRecord {
  id: string;
  trial_request_id: string;
  otp_hash: string;
  token: string;
  expires_at: string | Date;
  verified_at: string | Date | null;
  attempts: number;
  created_at: string | Date;
}

interface TrialStatusRow {
  id: string;
  status: TrialStatus;
}

export class VerificationService {
  async createVerification(trialRequestId: string): Promise<{ otp: string; expiresAt: Date }> {
    const otp = this.generateOtp();
    const token = randomUUID();
    const otpHash = this.hashOtp(otp);

    const insert = await query<{ expires_at: Date }>(
      `
        INSERT INTO email_verifications (trial_request_id, otp_hash, token, expires_at)
        VALUES ($1, $2, $3, NOW() + (($4::text || ' minutes')::interval))
        RETURNING expires_at
      `,
      [trialRequestId, otpHash, token, config.otpExpMinutes],
    );

    return {
      otp,
      expiresAt: new Date(insert.rows[0].expires_at),
    };
  }

  async verifyOtp(trialRequestId: string, otp: string): Promise<string> {
    return withTransaction(async (client) => {
      const trial = await this.lockTrial(client, trialRequestId);
      if (!trial) {
        throw new AppError(404, "Trial request not found", "TRIAL_NOT_FOUND");
      }

      if (this.isAlreadyVerified(trial.status)) {
        return trial.id;
      }

      if (trial.status !== "PENDING_EMAIL_VERIFICATION") {
        throw new AppError(409, "Trial is not awaiting email verification", "INVALID_TRIAL_STATUS");
      }

      const verification = await this.getLatestVerification(client, trialRequestId);
      if (!verification) {
        throw new AppError(404, "Verification record not found", "VERIFICATION_NOT_FOUND");
      }

      if (verification.verified_at) {
        await this.markTrialVerified(client, trialRequestId);
        return trial.id;
      }

      if (new Date(verification.expires_at).getTime() < Date.now()) {
        throw new AppError(400, "OTP has expired", "OTP_EXPIRED");
      }

      if (verification.attempts >= config.otpMaxAttempts) {
        throw new AppError(429, "Maximum OTP attempts reached", "OTP_ATTEMPTS_EXCEEDED");
      }

      if (!this.otpMatches(otp, verification.otp_hash)) {
        const attemptResult = await client.query<{ attempts: number }>(
          `
            UPDATE email_verifications
            SET attempts = attempts + 1
            WHERE id = $1
            RETURNING attempts
          `,
          [verification.id],
        );

        const attempts = attemptResult.rows[0].attempts;
        const attemptsLeft = Math.max(config.otpMaxAttempts - attempts, 0);
        throw new AppError(400, `Invalid OTP. Attempts left: ${attemptsLeft}`, "OTP_INVALID");
      }

      await client.query("UPDATE email_verifications SET verified_at = NOW() WHERE id = $1", [verification.id]);
      await this.markTrialVerified(client, trialRequestId);

      return trial.id;
    });
  }

  private async lockTrial(client: PoolClient, trialRequestId: string): Promise<TrialStatusRow | null> {
    const result = await client.query<TrialStatusRow>(
      "SELECT id, status FROM trial_requests WHERE id = $1 FOR UPDATE",
      [trialRequestId],
    );
    return result.rows[0] ?? null;
  }

  private async getLatestVerification(
    client: PoolClient,
    trialRequestId: string,
  ): Promise<VerificationRecord | null> {
    const result = await client.query<VerificationRecord>(
      `
        SELECT *
        FROM email_verifications
        WHERE trial_request_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [trialRequestId],
    );

    return result.rows[0] ?? null;
  }

  private async markTrialVerified(client: PoolClient, trialRequestId: string): Promise<void> {
    await client.query(
      `
        UPDATE trial_requests
        SET status = 'VERIFIED_PENDING_PROVISION', updated_at = NOW()
        WHERE id = $1
      `,
      [trialRequestId],
    );
  }

  private generateOtp(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  private hashOtp(otp: string): string {
    return crypto.createHmac("sha256", config.otpHmacKey).update(otp).digest("hex");
  }

  private otpMatches(providedOtp: string, expectedHash: string): boolean {
    const provided = Buffer.from(this.hashOtp(providedOtp), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    if (provided.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(provided, expected);
  }

  private isAlreadyVerified(status: TrialStatus): boolean {
    return ["VERIFIED_PENDING_PROVISION", "PROVISIONED", "DELIVERED"].includes(status);
  }
}
