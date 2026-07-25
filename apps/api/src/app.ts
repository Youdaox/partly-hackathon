/**
 * Express app construction, separate from the server bootstrap so tests and scripts
 * can build an app without binding a port.
 */

import cors from 'cors';
import express from 'express';

import { getDb, migrate } from './db/index.js';
import { errorHandler } from './http.js';
import { approveRouter } from './routes/approve.js';
import { jobsRouter } from './routes/jobs.js';
import { vehiclesRouter } from './routes/vehicles.js';

export async function createApp() {
  const db = await getDb();
  await migrate(db);

  const app = express();

  // Wide open on purpose: the Expo app runs from a phone on the LAN, and the
  // approval link gets opened from wherever the customer happens to be.
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, driver: db.driver });
  });

  app.use('/api/vehicles', vehiclesRouter);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/approve', approveRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Must be registered last.
  app.use(errorHandler);

  return app;
}
