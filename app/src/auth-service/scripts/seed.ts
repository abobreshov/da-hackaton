import { writeFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/appdb';
const pool = new Pool({ connectionString: DATABASE_URL });

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    const [adminHash, userHash, user2faHash] = await Promise.all([
      bcrypt.hash('Admin123!', 12),
      bcrypt.hash('User1234!', 12),
      bcrypt.hash('Secure2FA!', 12),
    ]);
    const totpSecret = authenticator.generateSecret();
    // Admin accounts now require TOTP (OWASP A07 / EPIC-14 Fix 3). The dev
    // admin gets its own enrolled secret written to `.seed-admin-totp.txt`
    // so local E2E / manual sessions can supply a live code.
    const adminTotpSecret = authenticator.generateSecret();

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE role AS ENUM ('ADMIN', 'USER');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE access_status AS ENUM ('ACTIVE', 'INACTIVE');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        two_factor_enabled BOOLEAN DEFAULT FALSE,
        two_factor_secret TEXT,
        access_status access_status DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role role DEFAULT 'USER',
        scopes TEXT[] NOT NULL DEFAULT '{}',
        two_factor_enabled BOOLEAN DEFAULT FALSE,
        two_factor_secret TEXT,
        access_status access_status DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT '{}';
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
    `);
    // OWASP V3.1.1 — email-verification columns. Seeded users are treated as
    // verified so existing dev creds keep working.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_hash TEXT;
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_expires_at TIMESTAMP WITH TIME ZONE;
    `);
    await client.query(`UPDATE users SET email_verified = TRUE WHERE email_verified = FALSE;`);

    await client.query(
      `INSERT INTO admins (email, name, password_hash, two_factor_enabled, two_factor_secret)
       VALUES ($1, $2, $3, TRUE, $4)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = $3, name = $2,
             two_factor_enabled = TRUE, two_factor_secret = $4;`,
      ['admin@example.com', 'Dev Admin', adminHash, adminTotpSecret],
    );
    const userScopes = ['read:profile', 'write:profile', 'read:dashboard'];
    await client.query(
      `INSERT INTO users (email, name, password_hash, role, scopes, two_factor_enabled, two_factor_secret)
       VALUES ($1, $2, $3, 'USER', $4, FALSE, NULL)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = $3, name = $2, scopes = $4,
             two_factor_enabled = FALSE, two_factor_secret = NULL;`,
      ['user@example.com', 'Dev User', userHash, userScopes],
    );
    await client.query(
      `INSERT INTO users (email, name, password_hash, role, scopes, two_factor_enabled, two_factor_secret)
       VALUES ($1, $2, $3, 'USER', $4, TRUE, $5)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = $3, name = $2, scopes = $4,
             two_factor_enabled = TRUE, two_factor_secret = $5;`,
      ['user2fa@example.com', 'Dev User 2FA', user2faHash, userScopes, totpSecret],
    );

    console.log('Seeded:');
    console.log('  admin@example.com     / Admin123!   (admin, 2FA ON — required)');
    console.log(
      `  user@example.com      / User1234!   (user)          scopes=${JSON.stringify(userScopes)}`,
    );
    console.log(
      `  user2fa@example.com   / Secure2FA!  (user, 2FA ON)  scopes=${JSON.stringify(userScopes)}`,
    );
    console.log(`  TOTP secret for user2fa@example.com: ${totpSecret}`);
    console.log(`  otpauth URI: ${authenticator.keyuri('user2fa@example.com', 'App', totpSecret)}`);
    console.log(`  TOTP secret for admin@example.com:   ${adminTotpSecret}`);
    console.log(
      `  otpauth URI: ${authenticator.keyuri('admin@example.com', 'App', adminTotpSecret)}`,
    );

    // Export the TOTP secret to a dev-only, gitignored file so Playwright /
    // other local test runners can generate live codes without re-querying the
    // DB. File lives next to this script.
    const secretFile = join(__dirname, '.seed-totp.txt');
    try {
      writeFileSync(
        secretFile,
        `# Auto-generated by seed.ts — DO NOT COMMIT\n` +
          `# Regenerated on every \`yarn workspace @app/auth-service seed\` run.\n` +
          `USER2FA_EMAIL=user2fa@example.com\n` +
          `USER2FA_TOTP_SECRET=${totpSecret}\n` +
          `ADMIN_EMAIL=admin@example.com\n` +
          `ADMIN_TOTP_SECRET=${adminTotpSecret}\n`,
        { mode: 0o600 },
      );
      console.log(`  TOTP secrets written to ${secretFile}`);
    } catch (err) {
      console.warn(`  Failed to write ${secretFile}: ${(err as Error).message}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err: Error) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
