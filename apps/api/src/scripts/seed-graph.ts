/**
 * Precompute proximity graphs into `proximity_graph_cache`.
 *
 * Optional — the API builds graphs in memory on demand. Run this if you want to
 * inspect the graph with SQL:
 *
 *   pnpm --filter @partli/api seed
 *   pnpm --filter @partli/api seed toyota-yaris-qmn16
 */

import { CATALOGUE_VEHICLE_SLUGS } from '@partli/shared';
import { graphStats, proximityGraph, toEdgeRows } from '@partli/shared/dataset';

import { getDb, migrate } from '../db/index.js';
import { replaceProximityEdges } from '../repositories/proximity.js';

async function main() {
  const slugs = process.argv.slice(2);
  const targets = slugs.length > 0 ? slugs : [...CATALOGUE_VEHICLE_SLUGS];

  const db = await getDb();
  await migrate(db);

  for (const slug of targets) {
    const started = Date.now();
    const graph = proximityGraph(slug);
    const stats = graphStats(graph);
    const written = await replaceProximityEdges(db, slug, toEdgeRows(graph));

    console.log(
      `[seed] ${slug}: ${written} edges ` +
        `(${stats.spatialEdges} spatial, ${stats.assemblyEdges} assembly) ` +
        `across ${stats.nodes} parts in ${Date.now() - started}ms`,
    );
  }

  await db.close();
}

main().catch((error) => {
  console.error('[seed] failed:', error);
  process.exit(1);
});
