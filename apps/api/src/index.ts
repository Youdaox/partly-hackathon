import { createApp } from './app.js';
import { config } from './config.js';
import { getDb } from './db/index.js';

async function main() {
  const app = await createApp();

  // 0.0.0.0 so a phone running Expo can reach the API over the LAN.
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[api] listening on http://localhost:${config.port}`);
    console.log(`[api] health:      http://localhost:${config.port}/health`);
  });

  /**
   * Close the database before exiting.
   *
   * This matters for the PGlite dev driver: it holds an on-disk directory, and being
   * killed mid-write leaves it in a state the next boot cannot open. `tsx watch`
   * restarts on every save, so without this a normal edit can corrupt the dev database.
   */
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    server.close();
    try {
      const db = await getDb();
      await db.close();
    } catch {
      // Already gone, or never opened — nothing to clean up.
    }
    console.log(`[api] shut down on ${signal}`);
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

main().catch((error) => {
  console.error('[api] failed to start:', error);
  process.exit(1);
});
