/**
 * Proximity graph + hidden-damage oracle.
 *
 * The idea: if a repairer can see that part X is damaged, parts that sit physically
 * next to X on the same exploded diagram — or that are sub-assemblies of X — are the
 * ones most likely to be damaged too but not yet visible.
 *
 * Two facts about the dataset drive the graph shape (both verified against the Yaris):
 *   1. A part's `hotspot` places it on exactly ONE diagram. Diagrams never share parts,
 *      so pixel distance is only meaningful between parts on the same diagram.
 *   2. `sub_assembly_ids` is therefore the ONLY thing connecting one diagram to another.
 *
 * So the graph has two edge kinds: `spatial` (within a diagram) and `assembly` (across).
 */

import type {
  PartId,
  ProximityEdge,
  ProximityGraph,
  VehicleSlug,
} from '../types.js';
import type { AssemblyCatalogue } from './load.js';
import type { RawAssembly, RawHotspot } from './raw.js';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Hotspots are bounding boxes; reduce to their centre point. */
export function hotspotCenter(hotspot: RawHotspot): { x: number; y: number } {
  return { x: (hotspot.x1 + hotspot.x2) / 2, y: (hotspot.y1 + hotspot.y2) / 2 };
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

export interface BuildGraphOptions {
  /**
   * How many nearest same-diagram neighbours to keep per part. Keeps the graph sparse;
   * some diagrams place 200+ parts, and a full clique would be O(n^2).
   */
  spatialNeighbors?: number;
  /** Drop spatial edges longer than this (normalised 0..1). */
  maxSpatialDistance?: number;
  /** Distance assigned to a parent<->sub-assembly edge. Structurally very close. */
  assemblyEdgeDistance?: number;
}

const DEFAULTS: Required<BuildGraphOptions> = {
  spatialNeighbors: 12,
  maxSpatialDistance: 0.35,
  assemblyEdgeDistance: 0.12,
};

/**
 * Build the undirected proximity graph for one vehicle.
 *
 * Pure: takes an already-loaded catalogue, touches no filesystem. Use
 * `buildProximityGraphForSlug` if you want the convenience wrapper.
 */
export function buildProximityGraph(
  catalogue: AssemblyCatalogue,
  options: BuildGraphOptions = {},
): ProximityGraph {
  const opts = { ...DEFAULTS, ...options };
  const { assemblies, partsOfDiagram } = catalogue;
  const adjacency = new Map<PartId, ProximityEdge[]>();

  const addEdge = (a: PartId, b: PartId, distance: number, kind: ProximityEdge['kind']) => {
    const list = adjacency.get(a);
    const edge: ProximityEdge = { partId: a, neighborPartId: b, distance, kind };
    if (list) list.push(edge);
    else adjacency.set(a, [edge]);
  };

  // --- spatial edges: k-nearest neighbours within each diagram ---
  for (const [, partIds] of partsOfDiagram) {
    const points: Array<{ partId: PartId; x: number; y: number }> = [];
    for (const partId of partIds) {
      const hotspot = assemblies[partId]?.hotspot;
      if (hotspot) points.push({ partId, ...hotspotCenter(hotspot) });
    }
    if (points.length < 2) continue;

    // Normalise by the spread of this diagram's own hotspots, so a distance of 0.1
    // means the same thing on a big engine-bay diagram as on a small trim diagram.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const diagonal = Math.hypot(maxX - minX, maxY - minY) || 1;

    for (const from of points) {
      const scored: Array<{ partId: PartId; distance: number }> = [];
      for (const to of points) {
        if (to.partId === from.partId) continue;
        const distance = Math.hypot(to.x - from.x, to.y - from.y) / diagonal;
        if (distance <= opts.maxSpatialDistance) scored.push({ partId: to.partId, distance });
      }
      scored.sort((a, b) => a.distance - b.distance);
      for (const n of scored.slice(0, opts.spatialNeighbors)) {
        addEdge(from.partId, n.partId, n.distance, 'spatial');
      }
    }
  }

  // --- assembly edges: parent <-> sub-assembly, both directions ---
  for (const [partId, assembly] of Object.entries(assemblies) as Array<[PartId, RawAssembly]>) {
    for (const child of assembly.sub_assembly_ids ?? []) {
      if (!assemblies[child.id]) continue;
      addEdge(partId, child.id, opts.assemblyEdgeDistance, 'assembly');
      addEdge(child.id, partId, opts.assemblyEdgeDistance, 'assembly');
    }
  }

  return { vehicleSlug: catalogue.vehicleSlug, adjacency };
}

/** Flatten a graph into rows for the `proximity_graph_cache` table. */
export function toEdgeRows(graph: ProximityGraph): ProximityEdge[] {
  const rows: ProximityEdge[] = [];
  for (const edges of graph.adjacency.values()) rows.push(...edges);
  return rows;
}

export function graphStats(graph: ProximityGraph): {
  nodes: number;
  edges: number;
  spatialEdges: number;
  assemblyEdges: number;
  avgDegree: number;
} {
  let edges = 0;
  let spatialEdges = 0;
  let assemblyEdges = 0;
  for (const list of graph.adjacency.values()) {
    edges += list.length;
    for (const e of list) {
      if (e.kind === 'spatial') spatialEdges++;
      else assemblyEdges++;
    }
  }
  const nodes = graph.adjacency.size;
  return {
    nodes,
    edges,
    spatialEdges,
    assemblyEdges,
    avgDegree: nodes ? edges / nodes : 0,
  };
}

// ---------------------------------------------------------------------------
// Base rates
// ---------------------------------------------------------------------------

/**
 * Prior likelihood that a part is damaged in a collision at all, independent of what
 * else is damaged. Keyed by lowercased `display_name` substring.
 *
 * PLACEHOLDER — the real seed base-rate table is being supplied separately. Anything
 * not listed falls back to `DEFAULT_BASE_RATE`. Replace the contents of this map, not
 * the lookup function, when the real table lands.
 */
export const BASE_RATES: Record<string, number> = {
  bumper: 1.3,
  'absorber': 1.25,
  reinforcement: 1.2,
  bracket: 1.15,
  retainer: 1.1,
  clip: 1.1,
  grille: 1.15,
  headlamp: 1.2,
  'head lamp': 1.2,
  radiator: 1.15,
  condenser: 1.15,
  fender: 1.2,
  hood: 1.1,
  bonnet: 1.1,
};

export const DEFAULT_BASE_RATE = 1.0;

export function baseRateFor(assembly: RawAssembly | undefined): number {
  if (!assembly?.display_name) return DEFAULT_BASE_RATE;
  const name = assembly.display_name.toLowerCase();
  let rate = DEFAULT_BASE_RATE;
  for (const [needle, value] of Object.entries(BASE_RATES)) {
    if (name.includes(needle) && value > rate) rate = value;
  }
  return rate;
}

// ---------------------------------------------------------------------------
// Scoring (multi-source shortest path over the graph)
// ---------------------------------------------------------------------------

export interface DamageSeed {
  partId: PartId;
  /** How confident we are this part is really damaged. 0..1, defaults to 1. */
  weight?: number;
}

export interface ScoreOptions {
  /** Max predictions to return. */
  limit?: number;
  /** Stop expanding a path once cumulative distance exceeds this. */
  maxDistance?: number;
  /** Higher = confidence falls off faster with distance. */
  decay?: number;
  /** Only suggest parts a shop can actually order. */
  orderableOnly?: boolean;
  /**
   * Collapse candidates that share a display name, keeping the highest scorer.
   * The catalogue holds several part ids per physical part (trim/variant rows), so
   * without this the list shows "Front Bumper Fastener" three times.
   */
  dedupeByName?: boolean;
}

const SCORE_DEFAULTS: Required<ScoreOptions> = {
  limit: 10,
  maxDistance: 0.9,
  decay: 3.2,
  orderableOnly: true,
  dedupeByName: true,
};

const normaliseName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export interface ScoredPart {
  partId: PartId;
  displayName: string;
  manufacturerPartNumber: string | null;
  /** 0..1 confidence that this part is also damaged. */
  score: number;
  /** The seed part that contributed most to this score. */
  viaPartId: PartId | null;
  viaDisplayName: string | null;
  distance: number;
  reason: string;
}

/** Minimal binary min-heap; avoids pulling in a dependency for Dijkstra. */
class MinHeap {
  private heap: Array<{ partId: PartId; distance: number }> = [];

  get size(): number {
    return this.heap.length;
  }

  push(item: { partId: PartId; distance: number }): void {
    this.heap.push(item);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent]!.distance <= this.heap[i]!.distance) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i]!, this.heap[parent]!];
      i = parent;
    }
  }

  pop(): { partId: PartId; distance: number } | undefined {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length && last) {
      this.heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < this.heap.length && this.heap[l]!.distance < this.heap[smallest]!.distance) smallest = l;
        if (r < this.heap.length && this.heap[r]!.distance < this.heap[smallest]!.distance) smallest = r;
        if (smallest === i) break;
        [this.heap[smallest], this.heap[i]] = [this.heap[i]!, this.heap[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Shortest-path distances from one seed, bounded by `maxDistance`.
 * Exported so the API can explain a single prediction if it wants to.
 */
export function shortestDistancesFrom(
  graph: ProximityGraph,
  source: PartId,
  maxDistance: number,
): Map<PartId, number> {
  const dist = new Map<PartId, number>([[source, 0]]);
  const settled = new Set<PartId>();
  const queue = new MinHeap();
  queue.push({ partId: source, distance: 0 });

  while (queue.size) {
    const current = queue.pop();
    if (!current) break;
    if (settled.has(current.partId)) continue;
    settled.add(current.partId);
    if (current.distance > maxDistance) continue;

    for (const edge of graph.adjacency.get(current.partId) ?? []) {
      const next = current.distance + edge.distance;
      if (next > maxDistance) continue;
      const known = dist.get(edge.neighborPartId);
      if (known === undefined || next < known) {
        dist.set(edge.neighborPartId, next);
        queue.push({ partId: edge.neighborPartId, distance: next });
      }
    }
  }

  return dist;
}

/**
 * Rank parts most likely to also be damaged, given the visible damage.
 *
 * For every seed we run a bounded Dijkstra and accumulate
 *   contribution = seedWeight * baseRate(candidate) * exp(-decay * distance)
 * then squash the total through `1 - exp(-total)` so the score lands in 0..1 and
 * multiple independent seeds pointing at the same part reinforce each other.
 */
export function scoreHiddenDamage(
  graph: ProximityGraph,
  catalogue: AssemblyCatalogue,
  seeds: DamageSeed[],
  options: ScoreOptions = {},
): ScoredPart[] {
  const opts = { ...SCORE_DEFAULTS, ...options };
  const { assemblies } = catalogue;
  const seedIds = new Set(seeds.map((s) => s.partId));

  // A seed's part id is not the only row describing that physical part. Suppress any
  // candidate sharing a seed's name, or the oracle "discovers" the damage we started from.
  const seedNames = new Set<string>();
  for (const seed of seeds) {
    const name = assemblies[seed.partId]?.display_name;
    if (name) seedNames.add(normaliseName(name));
  }

  const totals = new Map<
    PartId,
    { total: number; bestSeed: PartId | null; bestContribution: number; bestDistance: number }
  >();

  for (const seed of seeds) {
    if (!graph.adjacency.has(seed.partId) && !assemblies[seed.partId]) continue;
    const weight = seed.weight ?? 1;
    const distances = shortestDistancesFrom(graph, seed.partId, opts.maxDistance);

    for (const [partId, distance] of distances) {
      if (seedIds.has(partId)) continue; // already known to be damaged
      const assembly = assemblies[partId];
      if (!assembly) continue;
      if (opts.orderableOnly && !assembly.is_orderable) continue;
      if (assembly.is_generic) continue;
      if (assembly.display_name && seedNames.has(normaliseName(assembly.display_name))) continue;

      const contribution = weight * baseRateFor(assembly) * Math.exp(-opts.decay * distance);
      const entry = totals.get(partId);
      if (entry) {
        entry.total += contribution;
        if (contribution > entry.bestContribution) {
          entry.bestContribution = contribution;
          entry.bestSeed = seed.partId;
          entry.bestDistance = distance;
        }
      } else {
        totals.set(partId, {
          total: contribution,
          bestSeed: seed.partId,
          bestContribution: contribution,
          bestDistance: distance,
        });
      }
    }
  }

  const scored: ScoredPart[] = [];
  for (const [partId, entry] of totals) {
    const assembly = assemblies[partId]!;
    const viaName = entry.bestSeed ? (assemblies[entry.bestSeed]?.display_name ?? null) : null;
    scored.push({
      partId,
      displayName: assembly.display_name,
      manufacturerPartNumber: assembly.manufacturer_part_number ?? null,
      score: 1 - Math.exp(-entry.total),
      viaPartId: entry.bestSeed,
      viaDisplayName: viaName,
      distance: entry.bestDistance,
      reason: explainProximity(catalogue, partId, entry.bestSeed, entry.bestDistance),
    });
  }

  scored.sort((a, b) => b.score - a.score);

  if (!opts.dedupeByName) return scored.slice(0, opts.limit);

  const seen = new Set<string>();
  const deduped: ScoredPart[] = [];
  for (const item of scored) {
    const key = normaliseName(item.displayName);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length === opts.limit) break;
  }
  return deduped;
}

function explainProximity(
  catalogue: AssemblyCatalogue,
  partId: PartId,
  seedId: PartId | null,
  distance: number,
): string {
  if (!seedId) return 'Commonly damaged in this collision pattern.';
  const seedName = catalogue.assemblies[seedId]?.display_name ?? 'a damaged part';

  const seedDiagram = catalogue.diagramOfPart.get(seedId);
  const partDiagram = catalogue.diagramOfPart.get(partId);

  if (seedDiagram && seedDiagram === partDiagram) {
    const diagramName = catalogue.diagrams[seedDiagram]?.name;
    const closeness = distance < 0.15 ? 'directly adjacent to' : 'near';
    return diagramName
      ? `Sits ${closeness} ${seedName} on the ${diagramName} diagram.`
      : `Sits ${closeness} ${seedName}.`;
  }

  return `Part of the same assembly group as ${seedName}.`;
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

const graphCache = new Map<VehicleSlug, ProximityGraph>();

/** Convenience wrapper: load the catalogue from disk and build (or reuse) its graph. */
export function buildProximityGraphForSlug(
  slug: VehicleSlug,
  loader: (slug: VehicleSlug) => AssemblyCatalogue,
  options?: BuildGraphOptions,
): ProximityGraph {
  const cached = graphCache.get(slug);
  if (cached) return cached;
  const graph = buildProximityGraph(loader(slug), options);
  graphCache.set(slug, graph);
  return graph;
}

export function clearGraphCache(): void {
  graphCache.clear();
}
