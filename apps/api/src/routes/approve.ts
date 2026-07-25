/**
 * Public customer approval endpoints, mounted at /api/approve.
 *
 * These are intentionally unauthenticated — the job id in the URL is the secret. For
 * a hackathon that is fine; a real build would use a signed, expiring token.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { ApprovalPayload } from '@first-look/shared';
import { loadVehicle } from '@first-look/shared/dataset';

import { getDb } from '../db/index.js';
import { badRequest, notFound, parseBody } from '../http.js';
import * as approvalsRepo from '../repositories/approvals.js';
import * as jobsRepo from '../repositories/jobs.js';

export const approveRouter = Router();

const submitSchema = z.object({ optionId: z.string().min(1) });

// GET /api/approve/:jobId — what the approval page renders
approveRouter.get('/:jobId', async (req, res) => {
  const db = await getDb();
  const { jobId } = req.params;

  const job = await jobsRepo.getJob(db, jobId);
  if (!job) throw notFound(`Job ${jobId} not found`);

  const approval = await approvalsRepo.getApproval(db, jobId);
  if (!approval) {
    throw notFound(
      'This job has not been sent to the customer yet',
    );
  }

  const payload: ApprovalPayload = {
    jobId: job.id,
    vehicle: loadVehicle(job.vehicleSlug),
    status: job.status,
    lineItems: approval.options,
    approvedOption: approval.approvedOption,
    approvedAt: approval.approvedAt,
  };

  res.json(payload);
});

// POST /api/approve/:jobId — customer picks an option
approveRouter.post('/:jobId', async (req, res) => {
  const body = parseBody(submitSchema, req.body);
  const db = await getDb();
  const { jobId } = req.params;

  const job = await jobsRepo.getJob(db, jobId);
  if (!job) throw notFound(`Job ${jobId} not found`);

  const approval = await approvalsRepo.getApproval(db, jobId);
  if (!approval) throw notFound('This job has not been sent to the customer yet');

  // Only accept an option we actually offered, so a stale or edited link cannot
  // approve something that was never quoted.
  const offered = approval.options.some((item) =>
    item.options.some((option) => option.id === body.optionId),
  );
  if (!offered) {
    throw badRequest(
      'Unknown option',
      `Option "${body.optionId}" was not offered for this job.`,
    );
  }

  const updated = await approvalsRepo.submitApproval(db, jobId, body.optionId);
  if (!updated) throw notFound('This job has not been sent to the customer yet');

  await jobsRepo.setJobStatus(db, jobId, 'approved');

  const payload: ApprovalPayload = {
    jobId,
    vehicle: loadVehicle(job.vehicleSlug),
    status: 'approved',
    lineItems: updated.options,
    approvedOption: updated.approvedOption,
    approvedAt: updated.approvedAt,
  };

  res.json(payload);
});
