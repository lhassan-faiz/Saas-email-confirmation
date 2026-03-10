# IPTV Free Trial Backend (Node.js + TypeScript)

Production-ready Fastify backend for a WordPress free-trial form with:

- OTP email verification
- Queue-driven IPTV provisioning
- Encrypted credential storage (AES-256-GCM)
- Delivery by email
- Anti-abuse protections (rate limit, IP/email windows, CAPTCHA, attempt limits)

## Tech Stack

- Node.js 20+
- TypeScript
- Fastify
- PostgreSQL
- Redis
- Zod
- Nodemailer
- Axios
- BullMQ (Redis-backed queue)

## Trial Flow

1. `POST /api/trial/request` stores request + sends OTP email.
2. User verifies using `POST /api/trial/verify-otp`.
3. Backend enqueues provisioning job.
4. Worker calls external IPTV API (`GET /api/dev_api.php` with query params + `api_key`).
5. Credentials are encrypted at rest and emailed to user.
6. Status transitions:
   - `PENDING_EMAIL_VERIFICATION`
   - `VERIFIED_PENDING_PROVISION`
   - `PROVISIONED`
   - `DELIVERED`
   - `FAILED`

## Project Structure

```text
backend/
  src/
    server.ts
    routes/trial.routes.ts
    controllers/trial.controller.ts
    services/
      verification.service.ts
      email.service.ts
      iptv.service.ts
      crypto.service.ts
      antiabuse.service.ts
    jobs/queue.ts
    workers/provisionTrial.worker.ts
    db/
      pool.ts
      migrate.ts
    migrations/001_init.sql
    utils/
      logger.ts
      errors.ts
      redis.ts
    types/trial.ts
  Dockerfile
  docker-compose.yml
  package.json
  tsconfig.json
```

## Environment Variables

Copy and edit:

```bash
cp .env.example .env
```

Required keys:

```env
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iptv_trial
REDIS_URL=redis://127.0.0.1:6379

SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=your-brevo-login@smtp-brevo.com
SMTP_PASS=your-brevo-smtp-key
SMTP_FROM="IPTV Trial <no-reply@example.com>"

OTP_EXP_MINUTES=10
OTP_MAX_ATTEMPTS=5
OTP_HMAC_KEY=0123456789abcdef0123456789abcdef
TRIAL_LIMIT_PER_EMAIL_DAYS=7
TRIAL_LIMIT_PER_IP_DAYS=7
TRIAL_PENDING_WINDOW_MINUTES=30
TRIAL_PENDING_MAX_PER_EMAIL=3
TRIAL_PENDING_MAX_PER_IP=5
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef

IPTV_API_BASE_URL=http://api.drm-cloud.com/api/dev_api.php
IPTV_API_KEY=
IPTV_API_TOKEN=
IPTV_PACKAGE_ID=4
IPTV_TEMPLATE_ID=1
IPTV_COUNTRY=ALL
IPTV_MAX_CONNECTIONS=1
IPTV_FORCED_COUNTRY=ALL
IPTV_ADULT=false
IPTV_ENABLE_VPN=false
IPTV_PAID=false
IPTV_NOTE_PREFIX=Free Trial
IPTV_WHATSAPP_TELEGRAM=0612345678
IPTV_TRIAL_DURATION_HOURS=24

CAPTCHA_ENABLED=false
CAPTCHA_SECRET=
CAPTCHA_VERIFY_URL=https://www.google.com/recaptcha/api/siteverify

CORS_ORIGIN=http://localhost:8080
RATE_LIMIT_MAX=50
RATE_LIMIT_WINDOW=1 minute
TRUST_PROXY=true
```

## Local Run (without Docker)

1. Install dependencies:

```bash
npm install
```

2. Run migrations:

```bash
npm run migrate
```

3. Start API:

```bash
npm run dev
```

4. Start worker (separate terminal):

```bash
npm run dev:worker
```

5. Start mock IPTV API (separate terminal, only for mock mode/local simulation):

```bash
npm run dev:mock-iptv
```

## Docker Run

1. Create `.env` from `.env.example`.
2. Build and start:

```bash
docker compose up --build
```

This starts:

- API on `http://localhost:3000`
- Postgres on `localhost:5432`
- Redis on `localhost:6379`
- Worker for provisioning jobs

## Migration Commands

- Run migrations:

```bash
npm run migrate
```

Migrations are SQL files in `src/migrations` and tracked in `schema_migrations`.

## API Endpoints

### `POST /api/trial/request`

Creates a trial request and sends OTP email.

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "trialType": "m3u"
}
```

MAG/STB request:

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "trialType": "mag",
  "macAddress": "00:1A:79:12:34:56"
}
```

Optional CAPTCHA:

```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "trialType": "m3u",
  "captchaToken": "captcha-token-from-frontend"
}
```

### `POST /api/trial/verify-otp`

```json
{
  "requestId": "18fbe00f-c2e8-49dc-b376-680212b3d865",
  "otp": "123456"
}
```

### `GET /api/trial/status/:requestId`

Returns request status and last delivery state.

## Curl Examples

Request trial:

```bash
curl -X POST http://localhost:3000/api/trial/request \
  -H "Content-Type: application/json" \
  -d '{
    "firstName":"John",
    "lastName":"Doe",
    "email":"lhassanfaiz01@gmail.com",
    "trialType":"m3u"
  }'
```

Verify OTP:

```bash
curl -X POST http://localhost:3000/api/trial/verify-otp \
  -H "Content-Type: application/json" \
  -d '{
    "requestId":"18fbe00f-c2e8-49dc-b376-680212b3d865",
    "otp":"123456"
  }'
```

Check status:

```bash
curl "http://localhost:3000/api/trial/status/18fbe00f-c2e8-49dc-b376-680212b3d865"
```

## Quick End-to-End Local Test

1. Ensure these are running:
   - `npm run dev`
   - `npm run dev:worker`
   - `npm run dev:mock-iptv`
2. For real provider tests, set `.env` with:
   - `IPTV_API_BASE_URL=http://api.drm-cloud.com/api/dev_api.php`
   - `IPTV_API_KEY=<reseller API key from panel>`
3. For mock tests, set:
   - `IPTV_API_BASE_URL=http://127.0.0.1:4000`
   - `IPTV_API_KEY=mock-key`
4. Request trial, receive OTP email in your mailbox, verify OTP.
5. Check status; it should move to `DELIVERED`.

## Security and Anti-Abuse Controls

- Strict input validation with Zod
- Conditional MAC validation (`mag` requires MAC)
- OTP hash-only storage (HMAC-SHA256)
- Dedicated OTP HMAC key (`OTP_HMAC_KEY`) separate from encryption key
- OTP expiration and max-attempt enforcement
- Global + route-specific rate limiting (Redis-backed)
- Trial limit per email and per IP over configurable day windows (applied after email verification stage)
- Additional pending-request anti-spam limit before verification (`TRIAL_PENDING_*`)
- Stores request IP + user-agent
- Optional CAPTCHA verification
- Idempotent provisioning via:
  - queue dedupe (`jobId = trialRequestId`)
  - unique constraint on `service_accounts.trial_request_id`
- AES-256-GCM encrypted credential storage
- Helmet security headers
- Configurable CORS
- Centralized error handling
- Request logging via Fastify logger

## WordPress Integration Notes

- WordPress is only the frontend form/UI.
- This backend is fully standalone.
- WordPress should call:
  - `POST /api/trial/request`
  - `POST /api/trial/verify-otp`
  - `GET /api/trial/status/:requestId`
