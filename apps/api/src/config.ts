import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),

  /**
   * Postgres connection string. When unset the API falls back to an embedded
   * PGlite database under `apps/api/.pglite` so the stack runs with no Docker.
   */
  databaseUrl: process.env.DATABASE_URL ?? null,

  /** Where the web app is served from — used to build customer approval links. */
  webBaseUrl: process.env.WEB_BASE_URL ?? 'http://localhost:3000',

  /** Default vehicle used by demo helpers. */
  defaultVehicleSlug: process.env.DEFAULT_VEHICLE_SLUG ?? 'toyota-yaris-qmn16',

  isProduction: process.env.NODE_ENV === 'production',
} as const;
