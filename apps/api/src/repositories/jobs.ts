/**
 * Job, visible damage and hidden damage persistence.
 *
 * Every function takes the `Db` explicitly so routes stay easy to test. SQL rows are
 * snake_case; everything returned from here is the camelCase domain type from
 * `@partli/shared`.
 */

import type {
  DamageItem,
  DamageSource,
  HiddenDamagePrediction,
  Job,
  JobStatus,
  VehicleSlug,
} from '@partli/shared';
import type { Db } from '../db/index.js';

// --- row shapes -------------------------------------------------------------

interface JobRow {
  id: string;
  vehicle_slug: string;
  status: JobStatus;
  created_at: Date | string;
}

interface VisibleDamageRow {
  id: string;
  job_id: string;
  part_id: string;
  display_name: string;
  manufacturer_part_number: string | null;
  source: DamageSource;
  created_at: Date | string;
}

interface HiddenDamageRow {
  id: string;
  job_id: string;
  part_id: string;
  display_name: string;
  confidence_score: number | string;
  confirmed: boolean | null;
  reason: string | null;
  created_at: Date | string;
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const toJob = (row: JobRow): Job => ({
  id: row.id,
  vehicleSlug: row.vehicle_slug,
  status: row.status,
  createdAt: toIso(row.created_at),
});

const toDamageItem = (row: VisibleDamageRow): DamageItem => ({
  id: row.id,
  jobId: row.job_id,
  partId: row.part_id,
  displayName: row.display_name,
  manufacturerPartNumber: row.manufacturer_part_number,
  source: row.source,
  createdAt: toIso(row.created_at),
});

const toHiddenDamage = (row: HiddenDamageRow): HiddenDamagePrediction => ({
  id: row.id,
  jobId: row.job_id,
  partId: row.part_id,
  displayName: row.display_name,
  // node-postgres returns DOUBLE PRECISION as a number, PGlite can hand back a string.
  confidenceScore: Number(row.confidence_score),
  confirmed: row.confirmed,
  reason: row.reason,
  createdAt: toIso(row.created_at),
});

// --- jobs -------------------------------------------------------------------

export async function createJob(db: Db, vehicleSlug: VehicleSlug): Promise<Job> {
  const { rows } = await db.query<JobRow>(
    'INSERT INTO jobs (vehicle_slug) VALUES ($1) RETURNING *',
    [vehicleSlug],
  );
  return toJob(rows[0]!);
}

export async function getJob(db: Db, id: string): Promise<Job | null> {
  const { rows } = await db.query<JobRow>('SELECT * FROM jobs WHERE id = $1', [id]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function listJobs(db: Db, limit = 100): Promise<Job[]> {
  const { rows } = await db.query<JobRow>(
    'SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1',
    [limit],
  );
  return rows.map(toJob);
}

export async function setJobStatus(db: Db, id: string, status: JobStatus): Promise<Job | null> {
  const { rows } = await db.query<JobRow>(
    'UPDATE jobs SET status = $2 WHERE id = $1 RETURNING *',
    [id, status],
  );
  return rows[0] ? toJob(rows[0]) : null;
}

// --- visible damage ---------------------------------------------------------

export interface AddVisibleDamageInput {
  jobId: string;
  partId: string;
  displayName: string;
  manufacturerPartNumber: string | null;
  source: DamageSource;
}

/**
 * Insert a visible damage item. Adding the same part twice updates the existing row
 * instead of erroring — the repairer may mention a part more than once while talking.
 */
export async function addVisibleDamage(
  db: Db,
  input: AddVisibleDamageInput,
): Promise<DamageItem> {
  const { rows } = await db.query<VisibleDamageRow>(
    `INSERT INTO visible_damage (job_id, part_id, display_name, manufacturer_part_number, source)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (job_id, part_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           manufacturer_part_number = EXCLUDED.manufacturer_part_number,
           source = EXCLUDED.source
     RETURNING *`,
    [
      input.jobId,
      input.partId,
      input.displayName,
      input.manufacturerPartNumber,
      input.source,
    ],
  );
  return toDamageItem(rows[0]!);
}

export async function listVisibleDamage(db: Db, jobId: string): Promise<DamageItem[]> {
  const { rows } = await db.query<VisibleDamageRow>(
    'SELECT * FROM visible_damage WHERE job_id = $1 ORDER BY created_at ASC',
    [jobId],
  );
  return rows.map(toDamageItem);
}

export async function removeVisibleDamage(db: Db, jobId: string, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    'DELETE FROM visible_damage WHERE job_id = $1 AND id = $2 RETURNING id',
    [jobId, id],
  );
  return rows.length > 0;
}

// --- hidden damage ----------------------------------------------------------

export interface HiddenDamageInput {
  partId: string;
  displayName: string;
  confidenceScore: number;
  reason: string | null;
}

/**
 * Replace this job's unreviewed predictions with a fresh set.
 *
 * Predictions the repairer already answered are left alone: re-running the oracle
 * must never wipe a human decision.
 */
export async function replaceHiddenDamage(
  db: Db,
  jobId: string,
  predictions: HiddenDamageInput[],
): Promise<HiddenDamagePrediction[]> {
  await db.query('DELETE FROM hidden_damage_predictions WHERE job_id = $1 AND confirmed IS NULL', [
    jobId,
  ]);

  for (const prediction of predictions) {
    await db.query(
      `INSERT INTO hidden_damage_predictions (job_id, part_id, display_name, confidence_score, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (job_id, part_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             confidence_score = EXCLUDED.confidence_score,
             reason = EXCLUDED.reason
         WHERE hidden_damage_predictions.confirmed IS NULL`,
      [
        jobId,
        prediction.partId,
        prediction.displayName,
        prediction.confidenceScore,
        prediction.reason,
      ],
    );
  }

  return listHiddenDamage(db, jobId);
}

export async function listHiddenDamage(
  db: Db,
  jobId: string,
): Promise<HiddenDamagePrediction[]> {
  const { rows } = await db.query<HiddenDamageRow>(
    `SELECT * FROM hidden_damage_predictions
     WHERE job_id = $1
     ORDER BY confidence_score DESC, display_name ASC`,
    [jobId],
  );
  return rows.map(toHiddenDamage);
}

export async function getHiddenDamage(
  db: Db,
  jobId: string,
  predictionId: string,
): Promise<HiddenDamagePrediction | null> {
  const { rows } = await db.query<HiddenDamageRow>(
    'SELECT * FROM hidden_damage_predictions WHERE job_id = $1 AND id = $2',
    [jobId, predictionId],
  );
  return rows[0] ? toHiddenDamage(rows[0]) : null;
}

/**
 * Record a repairer's yes/no and move the stored confidence to match.
 *
 * A confirmation is ground truth, so it pins confidence to 1 or 0 rather than
 * nudging it — the number is what the customer-facing quote is built from.
 */
export async function setHiddenDamageConfirmed(
  db: Db,
  jobId: string,
  predictionId: string,
  confirmed: boolean,
): Promise<HiddenDamagePrediction | null> {
  const { rows } = await db.query<HiddenDamageRow>(
    `UPDATE hidden_damage_predictions
     SET confirmed = $3, confidence_score = $4
     WHERE job_id = $1 AND id = $2
     RETURNING *`,
    [jobId, predictionId, confirmed, confirmed ? 1 : 0],
  );
  return rows[0] ? toHiddenDamage(rows[0]) : null;
}
