import axios from "axios";
import { query } from "../db/pool";
import { config } from "../config";
import { AppError } from "../utils/errors";

interface CaptchaVerifyResponse {
  success: boolean;
  score?: number;
}

export class AntiAbuseService {
  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async assertTrialAllowed(email: string, ip: string): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);

    const emailBlock = await query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM trial_requests
          WHERE email = $1
            AND status IN ('VERIFIED_PENDING_PROVISION', 'PROVISIONED', 'DELIVERED')
            AND created_at >= NOW() - (($2::text || ' days')::interval)
        ) AS exists
      `,
      [normalizedEmail, config.trialLimitPerEmailDays],
    );

    if (emailBlock.rows[0]?.exists) {
      throw new AppError(429, "A verified trial already exists for this email in the limit window", "TRIAL_EMAIL_LIMIT");
    }

    const ipBlock = await query<{ exists: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM trial_requests
          WHERE ip = $1::inet
            AND status IN ('VERIFIED_PENDING_PROVISION', 'PROVISIONED', 'DELIVERED')
            AND created_at >= NOW() - (($2::text || ' days')::interval)
        ) AS exists
      `,
      [ip, config.trialLimitPerIpDays],
    );

    if (ipBlock.rows[0]?.exists) {
      throw new AppError(429, "A verified trial already exists from this IP in the limit window", "TRIAL_IP_LIMIT");
    }

    const pendingEmailCount = await query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM trial_requests
        WHERE email = $1
          AND status = 'PENDING_EMAIL_VERIFICATION'
          AND created_at >= NOW() - (($2::text || ' minutes')::interval)
      `,
      [normalizedEmail, config.trialPendingWindowMinutes],
    );

    if ((pendingEmailCount.rows[0]?.count ?? 0) >= config.trialPendingMaxPerEmail) {
      throw new AppError(
        429,
        "Too many unverified requests for this email. Please wait before trying again.",
        "PENDING_EMAIL_LIMIT",
      );
    }

    const pendingIpCount = await query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM trial_requests
        WHERE ip = $1::inet
          AND status = 'PENDING_EMAIL_VERIFICATION'
          AND created_at >= NOW() - (($2::text || ' minutes')::interval)
      `,
      [ip, config.trialPendingWindowMinutes],
    );

    if ((pendingIpCount.rows[0]?.count ?? 0) >= config.trialPendingMaxPerIp) {
      throw new AppError(
        429,
        "Too many unverified requests from this IP. Please wait before trying again.",
        "PENDING_IP_LIMIT",
      );
    }
  }

  async verifyCaptcha(token: string | undefined, ip: string): Promise<void> {
    if (!config.captchaEnabled) {
      return;
    }

    if (!token) {
      throw new AppError(400, "Captcha token is required", "CAPTCHA_REQUIRED");
    }

    const params = new URLSearchParams({
      secret: config.captchaSecret,
      response: token,
      remoteip: ip,
    });

    const response = await axios.post<CaptchaVerifyResponse>(config.captchaVerifyUrl, params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 5000,
    });

    if (!response.data.success) {
      throw new AppError(400, "Captcha verification failed", "CAPTCHA_INVALID");
    }

    if (typeof response.data.score === "number" && response.data.score < 0.5) {
      throw new AppError(400, "Captcha score too low", "CAPTCHA_LOW_SCORE");
    }
  }
}
