/**
 * Provisions (or re-provisions) the platform's Super Admin account.
 *
 * This is intentionally NOT an HTTP endpoint. Per the security requirement
 * that Super Admin accounts are never publicly registrable, the only way to
 * create one is running this script with direct database access — i.e. by
 * someone who already has production credentials.
 *
 * Usage:
 *   SUPER_ADMIN_EMAIL=you@company.com \
 *   SUPER_ADMIN_PASSWORD='a long random password, not typed twice anywhere' \
 *   SUPER_ADMIN_FIRST_NAME=Jane \
 *   SUPER_ADMIN_LAST_NAME=Doe \
 *   npx ts-node scripts/provision-super-admin.ts
 *
 * The account is created with:
 *   - emailVerified = true, status = ACTIVE   (no email OTP loop needed)
 *   - twoFactorEnabled = false                (cannot be true yet — no
 *     secret exists until the person completes setup)
 *   - gymId = null, branchId = null           (platform-level, not tenant-scoped)
 *
 * Because AuthService.login() refuses to issue a session to a SUPER_ADMIN
 * with twoFactorEnabled=false (it returns `requiresTwoFactorSetup` +
 * a short-lived setup token instead), the very first login after running
 * this script is FORCED through 2FA setup before any real session exists —
 * there is no window where a password-only Super Admin session is possible.
 */
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const firstName = process.env.SUPER_ADMIN_FIRST_NAME || 'Super';
  const lastName = process.env.SUPER_ADMIN_LAST_NAME || 'Admin';

  if (!email || !password) {
    console.error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD environment variables are required.');
    process.exit(1);
  }
  if (password.length < 16) {
    console.error('SUPER_ADMIN_PASSWORD must be at least 16 characters — this account has platform-wide access.');
    process.exit(1);
  }

  const existing = await prisma.user.findFirst({ where: { email, role: UserRole.SUPER_ADMIN } });
  if (existing) {
    console.error(`A Super Admin with email ${email} already exists (id: ${existing.id}). Refusing to overwrite — use the app's password reset flow instead if you need to rotate credentials.`);
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 14); // higher cost than normal users given the blast radius
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      gymId: null,
      branchId: null,
      twoFactorEnabled: false,
    },
  });

  console.log(`Super Admin provisioned: ${user.email} (${user.id})`);
  console.log('Next step: log in once to trigger mandatory 2FA setup — the account cannot get a session until that completes.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
