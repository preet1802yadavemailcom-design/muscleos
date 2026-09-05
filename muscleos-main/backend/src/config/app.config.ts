import { registerAs } from '@nestjs/config';

/** Placeholder values that exist ONLY as visible examples/local-dev
 *  convenience — never valid to actually run with. Checked against the
 *  real env values below so a typo'd .env that accidentally left these in
 *  place is caught the same way a missing env var is. */
const KNOWN_INSECURE_DEFAULTS = new Set([
  'muscleos_jwt_secret_change_in_production',
  'muscleos_refresh_secret_change_in_production',
  'muscleos_cookie_secret',
  'muscleos_jwt_super_secret_key_change_in_production',
  'muscleos_refresh_super_secret_key',
  'change_me_generate_a_real_random_value_min_32_chars',
  'change_me_generate_a_different_random_value_min_32_chars',
]);

/** Fails startup (rather than silently running with a guessable secret)
 *  when a security-critical env var is missing OR still set to one of the
 *  placeholder values shipped in .env.example/docker-compose.yml. Only
 *  enforced in production — local dev still gets a (clearly-named,
 *  never-shipped) fallback so `npm run start:dev` works with zero setup. */
function requireSecret(envVar: string, devFallback: string): string {
  const value = process.env[envVar];
  const isProduction = process.env.NODE_ENV === 'production';

  if (!value || KNOWN_INSECURE_DEFAULTS.has(value)) {
    if (isProduction) {
      throw new Error(
        `Refusing to start: ${envVar} is not set (or is still a placeholder value). `
        + 'This is a security-critical secret with no safe default in production — set a real random value '
        + '(e.g. `openssl rand -base64 32`) before starting.',
      );
    }
    return devFallback;
  }
  return value;
}

export const AppConfig = registerAs('app', () => ({
  name: process.env.APP_NAME || 'MuscleOS',
  version: process.env.APP_VERSION || '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '', 10) || 3000,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: requireSecret('JWT_SECRET', 'dev-only-jwt-secret-not-for-production-use'),
  jwtRefreshSecret: requireSecret('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-not-for-production-use'),
  jwtAccessExpiration: process.env.JWT_ACCESS_EXPIRATION || '15m',
  jwtRefreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '', 10) || 12,
  cookieSecret: requireSecret('COOKIE_SECRET', 'dev-only-cookie-secret-not-for-production-use'),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '', 10) || 900000,
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '', 10) || 100,
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '', 10) || 5242880,
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  resendApiKey: process.env.RESEND_API_KEY,
  emailFrom: process.env.EMAIL_FROM || 'MuscleOS <onboarding@resend.dev>',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
}));
