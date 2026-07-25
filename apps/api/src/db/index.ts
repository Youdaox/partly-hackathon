/**
 * Database access.
 *
 * Two drivers behind one tiny interface:
 *   - `DATABASE_URL` set  -> real Postgres via node-postgres (docker-compose, prod).
 *   - `DATABASE_URL` unset -> embedded PGlite in `apps/api/.pglite`.
 *
 * PGlite *is* Postgres 16 compiled to WASM, so the same migration SQL and the same
 * `$1` placeholders work on both. It exists so four people can run the stack in
 * parallel without everyone fighting Docker on day one. Use real Postgres for the
 * demo — it is the path that gets tested.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { config } from '../config.js';

export interface QueryResult<T> {
  rows: T[];
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /**
   * Run a script that may contain several statements separated by `;`.
   * `query()` uses the extended protocol, which accepts exactly one statement —
   * migrations need this instead.
   */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  /** Which driver is live — surfaced on /health so nobody debugs the wrong database. */
  readonly driver: 'postgres' | 'pglite';
}

let instance: Db | null = null;

async function createPostgres(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url });

  // Fail fast with a useful message rather than on the first request.
  await pool.query('SELECT 1');

  return {
    driver: 'postgres',
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(sql, params);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

async function createPglite(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.pglite');

  let pglite: Awaited<ReturnType<typeof PGlite.create>>;
  try {
    pglite = await PGlite.create(dir);
  } catch (error) {
    // PGlite fails with an opaque WASM `Aborted()` when its directory is locked by
    // another process or was left half-written by a hard kill. Say so plainly.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not open the embedded dev database at ${dir} (${message}).\n` +
        'Another API process is probably still running. Stop it, or delete the ' +
        'directory to start fresh:\n' +
        `  rm -rf ${dir}`,
    );
  }

  return {
    driver: 'pglite',
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pglite.query(sql, params as never[]);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await pglite.exec(sql);
    },
    async close() {
      await pglite.close();
    },
  };
}

export async function getDb(): Promise<Db> {
  if (instance) return instance;

  if (config.databaseUrl) {
    try {
      instance = await createPostgres(config.databaseUrl);
      console.log('[db] connected to Postgres');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not connect to Postgres at DATABASE_URL (${message}).\n` +
          'Start it with `pnpm db:up`, or unset DATABASE_URL to use the embedded ' +
          'PGlite dev database instead.',
      );
    }
  } else {
    instance = await createPglite();
    console.warn(
      '[db] DATABASE_URL not set — using the embedded PGlite dev database ' +
        '(apps/api/.pglite). Run `pnpm db:up` and set DATABASE_URL for real Postgres.',
    );
  }

  return instance;
}

/** Apply every .sql file in `migrations/`, in filename order. Safe to re-run. */
export async function migrate(db: Db): Promise<void> {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
  if (!fs.existsSync(dir)) {
    throw new Error(`Migrations directory not found at ${dir}`);
  }

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.exec(sql);
    console.log(`[db] applied migration ${file}`);
  }
}

/** Test/script helper — drops every row but keeps the schema. */
export async function truncateAll(db: Db): Promise<void> {
  await db.query(
    'TRUNCATE customer_approvals, hidden_damage_predictions, visible_damage, jobs RESTART IDENTITY CASCADE',
  );
}
