import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/appdb';
const pool = new Pool({ connectionString: DATABASE_URL });

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    const [adminHash, userHash] = await Promise.all([
      bcrypt.hash('Admin123!', 12),
      bcrypt.hash('User1234!', 12),
    ]);

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

    await client.query(
      `INSERT INTO admins (email, name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = $3, name = $2;`,
      ['admin@example.com', 'Dev Admin', adminHash],
    );
    const userScopes = ['read:profile', 'write:profile', 'read:dashboard'];
    await client.query(
      `INSERT INTO users (email, name, password_hash, role, scopes)
       VALUES ($1, $2, $3, 'USER', $4)
       ON CONFLICT (email) DO UPDATE SET password_hash = $3, name = $2, scopes = $4;`,
      ['user@example.com', 'Dev User', userHash, userScopes],
    );

    console.log('Seeded:');
    console.log('  admin@example.com  / Admin123!  (admin)');
    console.log(`  user@example.com   / User1234!  (user)  scopes=${JSON.stringify(userScopes)}`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err: Error) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
