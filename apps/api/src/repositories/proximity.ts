/**
 * Persistence for `proximity_graph_cache`.
 *
 * The oracle does NOT read from this table — it builds the graph in memory, which
 * takes ~100ms for the Yaris and is cached per process. The table exists so the
 * graph can be inspected with SQL and so a future job runner can precompute it.
 * Populate it with `pnpm --filter @first-look/api seed`.
 */

import type { ProximityEdge, VehicleSlug } from '@first-look/shared';
import type { Db } from '../db/index.js';

export async function replaceProximityEdges(
  db: Db,
  vehicleSlug: VehicleSlug,
  edges: ProximityEdge[],
): Promise<number> {
  await db.query('DELETE FROM proximity_graph_cache WHERE vehicle_slug = $1', [vehicleSlug]);

  // Batch the inserts; the Yaris graph is ~53k edges and one round trip each is slow.
  const BATCH = 500;
  let written = 0;

  for (let i = 0; i < edges.length; i += BATCH) {
    const batch = edges.slice(i, i + BATCH);
    const values: unknown[] = [];
    const tuples: string[] = [];

    batch.forEach((edge, index) => {
      const base = index * 5;
      tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      values.push(vehicleSlug, edge.partId, edge.neighborPartId, edge.distance, edge.kind);
    });

    await db.query(
      `INSERT INTO proximity_graph_cache (vehicle_slug, part_id, neighbor_part_id, distance, kind)
       VALUES ${tuples.join(', ')}
       ON CONFLICT DO NOTHING`,
      values,
    );
    written += batch.length;
  }

  return written;
}

export async function countProximityEdges(db: Db, vehicleSlug: VehicleSlug): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM proximity_graph_cache WHERE vehicle_slug = $1',
    [vehicleSlug],
  );
  return Number(rows[0]?.count ?? 0);
}
