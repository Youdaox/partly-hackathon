import type { ApprovalLineItem, CustomerApproval } from '@partli/shared';
import type { Db } from '../db/index.js';

interface ApprovalRow {
  id: string;
  job_id: string;
  options: ApprovalLineItem[] | string;
  approved_option: string | null;
  approved_at: Date | string | null;
  created_at: Date | string;
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const toApproval = (row: ApprovalRow): CustomerApproval => ({
  id: row.id,
  jobId: row.job_id,
  // node-postgres parses jsonb for us; PGlite may hand back the raw string.
  options: typeof row.options === 'string' ? JSON.parse(row.options) : row.options,
  approvedOption: row.approved_option,
  approvedAt: row.approved_at ? toIso(row.approved_at) : null,
  createdAt: toIso(row.created_at),
});

/**
 * Create or replace the options offered for a job.
 *
 * Re-sending to the customer overwrites the option list but deliberately keeps any
 * approval already made, so a late re-send cannot silently discard a decision.
 */
export async function upsertApproval(
  db: Db,
  jobId: string,
  options: ApprovalLineItem[],
): Promise<CustomerApproval> {
  const { rows } = await db.query<ApprovalRow>(
    `INSERT INTO customer_approvals (job_id, options)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (job_id) DO UPDATE SET options = EXCLUDED.options
     RETURNING *`,
    [jobId, JSON.stringify(options)],
  );
  return toApproval(rows[0]!);
}

export async function getApproval(db: Db, jobId: string): Promise<CustomerApproval | null> {
  const { rows } = await db.query<ApprovalRow>(
    'SELECT * FROM customer_approvals WHERE job_id = $1',
    [jobId],
  );
  return rows[0] ? toApproval(rows[0]) : null;
}

/** Record the customer's choice. Returns null when there is nothing to approve. */
export async function submitApproval(
  db: Db,
  jobId: string,
  optionId: string,
): Promise<CustomerApproval | null> {
  const { rows } = await db.query<ApprovalRow>(
    `UPDATE customer_approvals
     SET approved_option = $2, approved_at = now()
     WHERE job_id = $1
     RETURNING *`,
    [jobId, optionId],
  );
  return rows[0] ? toApproval(rows[0]) : null;
}
