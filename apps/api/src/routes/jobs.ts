/**
 * Job lifecycle: create, read, add damage, run the oracle, send to the customer.
 * Mounted at /api/jobs.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { JobState, SendToCustomerResponse } from '@first-look/shared';
import { hasCatalogue, loadVehicle, searchParts } from '@first-look/shared/dataset';

import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { badRequest, notFound, parseBody } from '../http.js';
import * as approvalsRepo from '../repositories/approvals.js';
import * as repo from '../repositories/jobs.js';
import { buildLineItems } from '../services/approvals.js';
import { runOracle, visibleDamageFromPredictions } from '../services/oracle.js';

export const jobsRouter = Router();

const createJobSchema = z.object({
  vehicleSlug: z.string().min(1),
  /**
   * Pre-populate visible damage from the shipped AI prediction. Handy for demos —
   * you get a populated job without talking to it first.
   */
  seedFromPrediction: z.boolean().optional(),
});

const addDamageSchema = z
  .object({
    partId: z.string().optional(),
    rawText: z.string().optional(),
    displayName: z.string().optional(),
    manufacturerPartNumber: z.string().nullable().optional(),
    source: z.enum(['voice', 'prediction', 'manual']).optional(),
  })
  .refine((value) => Boolean(value.partId || value.rawText || value.displayName), {
    message: 'Provide partId, rawText, or displayName',
  });

const predictSchema = z.object({ limit: z.number().int().min(1).max(50).optional() });

const confirmSchema = z.object({
  predictionId: z.string().min(1),
  confirmed: z.boolean(),
});

/** Load a job or throw 404. */
async function requireJob(id: string) {
  const db = await getDb();
  const job = await repo.getJob(db, id);
  if (!job) throw notFound(`Job ${id} not found`);
  return { db, job };
}

// POST /api/jobs — create a job for a vehicle_slug
jobsRouter.post('/', async (req, res) => {
  const body = parseBody(createJobSchema, req.body);
  const db = await getDb();

  const vehicle = loadVehicle(body.vehicleSlug);
  if (!vehicle.hasCatalogue && !vehicle.hasPrediction) {
    throw badRequest(
      `Unknown vehicle "${body.vehicleSlug}"`,
      'No catalogue or prediction exists for that slug.',
    );
  }

  const job = await repo.createJob(db, body.vehicleSlug);

  if (body.seedFromPrediction) {
    for (const part of visibleDamageFromPredictions(body.vehicleSlug)) {
      await repo.addVisibleDamage(db, {
        jobId: job.id,
        partId: part.partId,
        displayName: part.displayName,
        manufacturerPartNumber: part.manufacturerPartNumber,
        source: 'prediction',
      });
    }
  }

  res.status(201).json(job);
});

// GET /api/jobs — front-desk dashboard listing
jobsRouter.get('/', async (_req, res) => {
  const db = await getDb();
  const jobs = await repo.listJobs(db);

  const withVehicles = jobs.map((job) => ({
    ...job,
    vehicle: loadVehicle(job.vehicleSlug),
  }));

  res.json(withVehicles);
});

// GET /api/jobs/:id — current job state (visible + hidden damage)
jobsRouter.get('/:id', async (req, res) => {
  const { db, job } = await requireJob(req.params.id);

  const state: JobState = {
    ...job,
    vehicle: loadVehicle(job.vehicleSlug),
    visibleDamage: await repo.listVisibleDamage(db, job.id),
    hiddenDamage: await repo.listHiddenDamage(db, job.id),
  };

  res.json(state);
});

// POST /api/jobs/:id/damage — add a visible damage item
jobsRouter.post('/:id/damage', async (req, res) => {
  const body = parseBody(addDamageSchema, req.body);
  const { db, job } = await requireJob(req.params.id);

  let partId = body.partId;
  let displayName = body.displayName;
  let manufacturerPartNumber = body.manufacturerPartNumber ?? null;

  // Free text from voice capture: resolve it against the catalogue.
  if (!partId) {
    const query = body.rawText ?? body.displayName ?? '';
    if (!hasCatalogue(job.vehicleSlug)) {
      throw badRequest(
        `Vehicle "${job.vehicleSlug}" has no parts catalogue`,
        'Free-text damage can only be resolved for vehicles with an assemblies.json. Pass an explicit partId instead.',
      );
    }

    const [best] = searchParts(job.vehicleSlug, query, 1);
    if (!best) {
      throw badRequest(
        `No catalogue part matches "${query}"`,
        'Try a different wording, or pass an explicit partId.',
      );
    }

    partId = best.partId;
    displayName ??= best.assembly.display_name;
    manufacturerPartNumber ??= best.assembly.manufacturer_part_number ?? null;
  }

  const item = await repo.addVisibleDamage(db, {
    jobId: job.id,
    partId,
    displayName: displayName ?? partId,
    manufacturerPartNumber,
    source: body.source ?? 'voice',
  });

  res.status(201).json(item);
});

// DELETE /api/jobs/:id/damage/:damageId — undo a mis-heard item
jobsRouter.delete('/:id/damage/:damageId', async (req, res) => {
  const { db, job } = await requireJob(req.params.id);
  const removed = await repo.removeVisibleDamage(db, job.id, req.params.damageId);
  if (!removed) throw notFound(`Damage item ${req.params.damageId} not found`);
  res.status(204).end();
});

// POST /api/jobs/:id/oracle/predict — rank hidden damage and persist it
jobsRouter.post('/:id/oracle/predict', async (req, res) => {
  const body = parseBody(predictSchema, req.body ?? {});
  const { db, job } = await requireJob(req.params.id);

  if (!hasCatalogue(job.vehicleSlug)) {
    throw badRequest(
      `Vehicle "${job.vehicleSlug}" has no parts catalogue`,
      'The oracle needs assemblies.json. Only toyota-yaris-qmn16, hyundai-santafe-pns53 and jaguar-epace-rfh447 have one.',
    );
  }

  const visibleDamage = await repo.listVisibleDamage(db, job.id);
  const existingHidden = await repo.listHiddenDamage(db, job.id);

  const { predictions, seedCount } = runOracle({
    vehicleSlug: job.vehicleSlug,
    visibleDamage,
    confirmedHidden: existingHidden,
    limit: body.limit ?? 10,
  });

  if (seedCount === 0) {
    throw badRequest(
      'No visible damage to reason from',
      'Add at least one visible damage item before running the oracle.',
    );
  }

  const saved = await repo.replaceHiddenDamage(db, job.id, predictions);
  if (job.status === 'capturing') await repo.setJobStatus(db, job.id, 'predicted');

  res.json({ predictions: saved });
});

// POST /api/jobs/:id/oracle/confirm — repairer confirms or denies a prediction
jobsRouter.post('/:id/oracle/confirm', async (req, res) => {
  const body = parseBody(confirmSchema, req.body);
  const { db, job } = await requireJob(req.params.id);

  const updated = await repo.setHiddenDamageConfirmed(
    db,
    job.id,
    body.predictionId,
    body.confirmed,
  );
  if (!updated) throw notFound(`Prediction ${body.predictionId} not found on this job`);

  // A confirmed prediction is real damage, so promote it onto the visible list.
  if (body.confirmed) {
    await repo.addVisibleDamage(db, {
      jobId: job.id,
      partId: updated.partId,
      displayName: updated.displayName,
      manufacturerPartNumber: null,
      source: 'prediction',
    });
  }

  res.json(updated);
});

// POST /api/jobs/:id/send-to-customer — build options and a shareable link
jobsRouter.post('/:id/send-to-customer', async (req, res) => {
  const { db, job } = await requireJob(req.params.id);

  const visibleDamage = await repo.listVisibleDamage(db, job.id);
  const hiddenDamage = await repo.listHiddenDamage(db, job.id);

  const lineItems = buildLineItems({
    vehicleSlug: job.vehicleSlug,
    visibleDamage,
    hiddenDamage,
  });

  if (lineItems.length === 0) {
    throw badRequest(
      'Nothing to send',
      'Add visible damage (or confirm a hidden damage prediction) first.',
    );
  }

  await approvalsRepo.upsertApproval(db, job.id, lineItems);
  if (job.status !== 'approved') await repo.setJobStatus(db, job.id, 'sent_to_customer');

  const response: SendToCustomerResponse = {
    jobId: job.id,
    approvalUrl: `${config.webBaseUrl}/approve/${job.id}`,
    lineItems,
  };

  res.json(response);
});
