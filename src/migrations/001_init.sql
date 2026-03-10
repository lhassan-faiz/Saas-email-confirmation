CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS trial_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  trial_type TEXT NOT NULL CHECK (trial_type IN ('m3u', 'mag')),
  mac_address TEXT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'PENDING_EMAIL_VERIFICATION',
    'VERIFIED_PENDING_PROVISION',
    'PROVISIONED',
    'DELIVERED',
    'FAILED'
  )),
  ip INET NOT NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mac_required_for_mag CHECK (
    (trial_type = 'mag' AND mac_address IS NOT NULL)
    OR (trial_type = 'm3u')
  )
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_request_id UUID NOT NULL REFERENCES trial_requests(id) ON DELETE CASCADE,
  otp_hash TEXT NOT NULL,
  token UUID NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_request_id UUID NOT NULL UNIQUE REFERENCES trial_requests(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password_ciphertext TEXT NOT NULL,
  password_iv TEXT NOT NULL,
  password_auth_tag TEXT NOT NULL,
  host TEXT NOT NULL,
  playlist_url TEXT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_request_id UUID NOT NULL REFERENCES trial_requests(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trial_requests_email_created_at
  ON trial_requests (email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trial_requests_ip_created_at
  ON trial_requests (ip, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trial_requests_status
  ON trial_requests (status);

CREATE INDEX IF NOT EXISTS idx_email_verifications_trial_request
  ON email_verifications (trial_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deliveries_trial_request
  ON deliveries (trial_request_id, created_at DESC);

