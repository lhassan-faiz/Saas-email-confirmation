import { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { query } from "../db/pool";
import { enqueueProvisionTrial } from "../jobs/queue";
import { AntiAbuseService } from "../services/antiabuse.service";
import { EmailService } from "../services/email.service";
import { VerificationService } from "../services/verification.service";
import { AppError } from "../utils/errors";

const macRegex = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

const requestTrialSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(320),
    trialType: z.enum(["m3u", "mag"]),
    macAddress: z.string().trim().optional(),
    captchaToken: z.string().trim().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.trialType === "mag") {
      if (!body.macAddress) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["macAddress"],
          message: "macAddress is required when trialType is mag",
        });
      } else if (!macRegex.test(body.macAddress)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["macAddress"],
          message: "macAddress must match XX:XX:XX:XX:XX:XX",
        });
      }
    }
  });

const verifyOtpSchema = z.object({
  requestId: z.string().uuid(),
  otp: z.string().trim().regex(/^\d{6}$/),
});

const statusParamsSchema = z.object({
  requestId: z.string().uuid(),
});

const antiAbuseService = new AntiAbuseService();
const verificationService = new VerificationService();
const emailService = new EmailService();

export class TrialController {
  async requestTrial(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parsed = requestTrialSchema.safeParse(request.body);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; ");
      throw new AppError(400, details || "Invalid payload", "VALIDATION_ERROR");
    }

    const ip = request.ip;
    const userAgent = request.headers["user-agent"] ?? null;
    const email = antiAbuseService.normalizeEmail(parsed.data.email);
    const macAddress =
      parsed.data.trialType === "mag" && parsed.data.macAddress
        ? parsed.data.macAddress.toUpperCase()
        : null;

    await antiAbuseService.assertTrialAllowed(email, ip);
    await antiAbuseService.verifyCaptcha(parsed.data.captchaToken, ip);

    const insertResult = await query<{ id: string }>(
      `
        INSERT INTO trial_requests (
          first_name, last_name, email, trial_type, mac_address, status, ip, user_agent
        )
        VALUES ($1, $2, $3, $4, $5, 'PENDING_EMAIL_VERIFICATION', $6::inet, $7)
        RETURNING id
      `,
      [
        parsed.data.firstName,
        parsed.data.lastName,
        email,
        parsed.data.trialType,
        macAddress,
        ip,
        userAgent,
      ],
    );

    const trialRequestId = insertResult.rows[0].id;
    const verification = await verificationService.createVerification(trialRequestId);

    try {
      await emailService.sendVerificationEmail({
        to: email,
        firstName: parsed.data.firstName,
        otp: verification.otp,
        expiresAt: verification.expiresAt,
      });
    } catch {
      await query(
        `
          UPDATE trial_requests
          SET status = 'FAILED', updated_at = NOW()
          WHERE id = $1
        `,
        [trialRequestId],
      );
      throw new AppError(502, "Failed to send verification email", "EMAIL_SEND_FAILED");
    }

    reply.code(202).send({
      requestId: trialRequestId,
      status: "PENDING_EMAIL_VERIFICATION",
      otpExpiresAt: verification.expiresAt.toISOString(),
      message: "Verification email sent",
    });
  }

  async verifyOtp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parsed = verifyOtpSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid requestId or OTP", "VALIDATION_ERROR");
    }

    const trialRequestId = await verificationService.verifyOtp(parsed.data.requestId, parsed.data.otp);
    await enqueueProvisionTrial({ trialRequestId });

    reply.send({
      requestId: trialRequestId,
      status: "VERIFIED_PENDING_PROVISION",
      message: "Email verified. Trial provisioning started.",
    });
  }

  async getTrialStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parsed = statusParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new AppError(400, "Invalid requestId", "VALIDATION_ERROR");
    }

    const result = await query<{
      id: string;
      status: string;
      trial_type: string;
      created_at: string | Date;
      updated_at: string | Date;
      last_delivery_status: string | null;
      last_delivery_error: string | null;
    }>(
      `
        SELECT
          tr.id,
          tr.status,
          tr.trial_type,
          tr.created_at,
          tr.updated_at,
          d.status AS last_delivery_status,
          d.error AS last_delivery_error
        FROM trial_requests tr
        LEFT JOIN LATERAL (
          SELECT status, error
          FROM deliveries
          WHERE trial_request_id = tr.id
          ORDER BY created_at DESC
          LIMIT 1
        ) d ON TRUE
        WHERE tr.id = $1
      `,
      [parsed.data.requestId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new AppError(404, "Trial request not found", "TRIAL_NOT_FOUND");
    }

    reply.send({
      requestId: row.id,
      status: row.status,
      trialType: row.trial_type,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      delivery: row.last_delivery_status
        ? {
            status: row.last_delivery_status,
            error: row.last_delivery_error,
          }
        : null,
    });
  }
}
