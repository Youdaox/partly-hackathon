-- First Look — initial schema.
--
-- Runs on both the docker-compose Postgres and the PGlite dev fallback, so keep to
-- plain Postgres 16 SQL. Everything is IF NOT EXISTS: migrations run on every boot.

CREATE TABLE IF NOT EXISTS jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_slug TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'capturing'
                 CHECK (status IN ('capturing', 'predicted', 'sent_to_customer', 'approved')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs (created_at DESC);

-- Damage the repairer can actually see, from voice capture, the AI prediction, or
-- typed in by hand.
CREATE TABLE IF NOT EXISTS visible_damage (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                     UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  part_id                    TEXT NOT NULL,
  display_name               TEXT NOT NULL,
  manufacturer_part_number   TEXT,
  source                     TEXT NOT NULL
                               CHECK (source IN ('voice', 'prediction', 'manual')),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The same part must not be listed twice for one job.
  UNIQUE (job_id, part_id)
);

CREATE INDEX IF NOT EXISTS visible_damage_job_idx ON visible_damage (job_id);

-- Oracle output: parts likely damaged but not yet visible.
-- confirmed is NULL until a repairer says yes or no.
CREATE TABLE IF NOT EXISTS hidden_damage_predictions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  part_id          TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  confidence_score DOUBLE PRECISION NOT NULL
                     CHECK (confidence_score >= 0 AND confidence_score <= 1),
  confirmed        BOOLEAN,
  reason           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, part_id)
);

CREATE INDEX IF NOT EXISTS hidden_damage_job_idx ON hidden_damage_predictions (job_id);

-- Precomputed proximity edges, one row per directed edge, per vehicle.
-- Optional: the API builds the graph in memory on demand. This exists so a slow
-- cold start can be traded for a seed step (`pnpm --filter @first-look/api seed`).
CREATE TABLE IF NOT EXISTS proximity_graph_cache (
  vehicle_slug     TEXT NOT NULL,
  part_id          TEXT NOT NULL,
  neighbor_part_id TEXT NOT NULL,
  distance         DOUBLE PRECISION NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'spatial'
                     CHECK (kind IN ('spatial', 'assembly')),
  PRIMARY KEY (vehicle_slug, part_id, neighbor_part_id, kind)
);

CREATE INDEX IF NOT EXISTS proximity_lookup_idx
  ON proximity_graph_cache (vehicle_slug, part_id);

-- The options sent to the customer, and which one they picked.
CREATE TABLE IF NOT EXISTS customer_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  options         JSONB NOT NULL DEFAULT '[]'::jsonb,
  approved_option TEXT,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One live approval record per job; re-sending replaces the options.
  UNIQUE (job_id)
);
