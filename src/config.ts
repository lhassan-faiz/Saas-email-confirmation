import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return value;
}, z.boolean());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: z.string().optional().default(""),
    SMTP_PASS: z.string().optional().default(""),
    SMTP_FROM: z.string().min(1),
    OTP_EXP_MINUTES: z.coerce.number().int().positive().default(10),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_HMAC_KEY: z.string().min(32),
    TRIAL_LIMIT_PER_EMAIL_DAYS: z.coerce.number().int().positive().default(7),
    TRIAL_LIMIT_PER_IP_DAYS: z.coerce.number().int().positive().default(7),
    TRIAL_PENDING_WINDOW_MINUTES: z.coerce.number().int().positive().default(30),
    TRIAL_PENDING_MAX_PER_EMAIL: z.coerce.number().int().positive().default(3),
    TRIAL_PENDING_MAX_PER_IP: z.coerce.number().int().positive().default(5),
    ENCRYPTION_KEY: z.string().min(32),
    IPTV_API_BASE_URL: z.string().url(),
    IPTV_API_KEY: z.string().optional().default(""),
    IPTV_API_TOKEN: z.string().optional().default(""),
    IPTV_PACKAGE_ID: z.coerce.number().int().positive().default(4),
    IPTV_TEMPLATE_ID: z.coerce.number().int().positive().default(1),
    IPTV_COUNTRY: z.string().default("ALL"),
    IPTV_MAX_CONNECTIONS: z.coerce.number().int().positive().default(1),
    IPTV_FORCED_COUNTRY: z.string().default("ALL"),
    IPTV_ADULT: booleanFromEnv.default(false),
    IPTV_ENABLE_VPN: booleanFromEnv.default(false),
    IPTV_PAID: booleanFromEnv.default(false),
    IPTV_NOTE_PREFIX: z.string().default("Free Trial"),
    IPTV_WHATSAPP_TELEGRAM: z.string().default("0000000000"),
    IPTV_TRIAL_DURATION_HOURS: z.coerce.number().int().positive().default(24),
    CORS_ORIGIN: z.string().default("*"),
    CAPTCHA_ENABLED: booleanFromEnv.default(false),
    CAPTCHA_SECRET: z.string().optional().default(""),
    CAPTCHA_VERIFY_URL: z.string().url().default("https://www.google.com/recaptcha/api/siteverify"),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(50),
    RATE_LIMIT_WINDOW: z.string().default("1 minute"),
    TRUST_PROXY: booleanFromEnv.default(true),
  })
  .superRefine((env, ctx) => {
    if (env.CAPTCHA_ENABLED && !env.CAPTCHA_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CAPTCHA_SECRET"],
        message: "CAPTCHA_SECRET is required when CAPTCHA_ENABLED=true",
      });
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const message = parsedEnv.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
  throw new Error(`Invalid environment configuration: ${message}`);
}

export const config = {
  nodeEnv: parsedEnv.data.NODE_ENV,
  port: parsedEnv.data.PORT,
  databaseUrl: parsedEnv.data.DATABASE_URL,
  redisUrl: parsedEnv.data.REDIS_URL,
  smtpHost: parsedEnv.data.SMTP_HOST,
  smtpPort: parsedEnv.data.SMTP_PORT,
  smtpUser: parsedEnv.data.SMTP_USER,
  smtpPass: parsedEnv.data.SMTP_PASS,
  smtpFrom: parsedEnv.data.SMTP_FROM,
  otpExpMinutes: parsedEnv.data.OTP_EXP_MINUTES,
  otpMaxAttempts: parsedEnv.data.OTP_MAX_ATTEMPTS,
  otpHmacKey: parsedEnv.data.OTP_HMAC_KEY,
  trialLimitPerEmailDays: parsedEnv.data.TRIAL_LIMIT_PER_EMAIL_DAYS,
  trialLimitPerIpDays: parsedEnv.data.TRIAL_LIMIT_PER_IP_DAYS,
  trialPendingWindowMinutes: parsedEnv.data.TRIAL_PENDING_WINDOW_MINUTES,
  trialPendingMaxPerEmail: parsedEnv.data.TRIAL_PENDING_MAX_PER_EMAIL,
  trialPendingMaxPerIp: parsedEnv.data.TRIAL_PENDING_MAX_PER_IP,
  encryptionKey: parsedEnv.data.ENCRYPTION_KEY,
  iptvApiBaseUrl: parsedEnv.data.IPTV_API_BASE_URL,
  iptvApiKey: parsedEnv.data.IPTV_API_KEY || parsedEnv.data.IPTV_API_TOKEN,
  iptvApiToken: parsedEnv.data.IPTV_API_TOKEN,
  iptvPackageId: parsedEnv.data.IPTV_PACKAGE_ID,
  iptvTemplateId: parsedEnv.data.IPTV_TEMPLATE_ID,
  iptvCountry: parsedEnv.data.IPTV_COUNTRY,
  iptvMaxConnections: parsedEnv.data.IPTV_MAX_CONNECTIONS,
  iptvForcedCountry: parsedEnv.data.IPTV_FORCED_COUNTRY,
  iptvAdult: parsedEnv.data.IPTV_ADULT,
  iptvEnableVpn: parsedEnv.data.IPTV_ENABLE_VPN,
  iptvPaid: parsedEnv.data.IPTV_PAID,
  iptvNotePrefix: parsedEnv.data.IPTV_NOTE_PREFIX,
  iptvWhatsappTelegram: parsedEnv.data.IPTV_WHATSAPP_TELEGRAM,
  iptvTrialDurationHours: parsedEnv.data.IPTV_TRIAL_DURATION_HOURS,
  corsOrigin: parsedEnv.data.CORS_ORIGIN,
  captchaEnabled: parsedEnv.data.CAPTCHA_ENABLED,
  captchaSecret: parsedEnv.data.CAPTCHA_SECRET,
  captchaVerifyUrl: parsedEnv.data.CAPTCHA_VERIFY_URL,
  rateLimitMax: parsedEnv.data.RATE_LIMIT_MAX,
  rateLimitWindow: parsedEnv.data.RATE_LIMIT_WINDOW,
  trustProxy: parsedEnv.data.TRUST_PROXY,
};
