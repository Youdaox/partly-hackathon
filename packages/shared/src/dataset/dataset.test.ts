/**
 * Verification against the real Yaris data. Run with `pnpm --filter @first-look/shared test`.
 *
 * These assert on facts confirmed by inspecting the shipped dataset, so they fail loudly
 * if the data is swapped for a different bundle.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildProximityGraph,
  graphStats,
  hasDiagramAssets,
  hotspotCenter,
  listDiagramsWithAssets,
  listVehicles,
  loadAssemblies,
  loadDiagramSegments,
  loadPredictions,
  loadVehicle,
  proximityGraph,
  scoreHiddenDamage,
  searchParts,
  toEdgeRows,
} from './index.js';

const YARIS = 'toyota-yaris-qmn16';

test('listVehicles finds the demo fleet', () => {
  const vehicles = listVehicles();
  assert.ok(vehicles.length >= 8, `expected >=8 vehicles, got ${vehicles.length}`);

  const withCatalogue = vehicles.filter((v) => v.hasCatalogue).map((v) => v.slug).sort();
  assert.deepEqual(withCatalogue, [
    'hyundai-santafe-pns53',
    'jaguar-epace-rfh447',
    'toyota-yaris-qmn16',
  ]);
});

test('loadVehicle parses the nested variant property list', () => {
  const vehicle = loadVehicle(YARIS);
  assert.equal(vehicle.slug, YARIS);
  assert.equal(vehicle.make, 'toyota');
  assert.equal(vehicle.model, 'YARIS');
  assert.equal(vehicle.year, 2023);
  assert.equal(vehicle.hasCatalogue, true);
  assert.equal(vehicle.hasPrediction, true);
});

test('loadAssemblies parses the Yaris catalogue and indexes diagrams', () => {
  const cat = loadAssemblies(YARIS);

  assert.equal(Object.keys(cat.assemblies).length, 7009);
  assert.equal(Object.keys(cat.diagrams).length, 187);

  // Every assembly has these two; only about half are placed on a diagram.
  for (const assembly of Object.values(cat.assemblies)) {
    assert.equal(typeof assembly.display_name, 'string');
    assert.equal(typeof assembly.is_orderable, 'boolean');
  }

  assert.equal(cat.diagramOfPart.size, 3563);
  assert.ok(cat.partsOfDiagram.size > 0);

  // A part belongs to exactly one diagram; the indexes must agree.
  for (const [partId, diagramId] of cat.diagramOfPart) {
    assert.ok(cat.partsOfDiagram.get(diagramId)?.includes(partId));
  }
});

test('loadPredictions links damaged parts to catalogue part ids', () => {
  const preds = loadPredictions(YARIS);
  assert.equal(preds.vehicleSlug, YARIS);
  assert.ok(preds.parts.length >= 8, `expected >=8 damaged parts, got ${preds.parts.length}`);
  assert.ok(preds.contextFrames.length > 0);

  const bumper = preds.parts.find((p) => p.rawPartName === 'Front Bumper Cover');
  assert.ok(bumper, 'expected a Front Bumper Cover prediction');
  assert.equal(bumper.severity, 'severe');
  assert.ok(bumper.oemParts.length > 0, 'expected catalogue matches');

  // Every linked part id must resolve in the catalogue — this is the join the whole
  // oracle depends on.
  const cat = loadAssemblies(YARIS);
  let linked = 0;
  for (const part of preds.parts) {
    for (const oem of part.oemParts) {
      assert.ok(cat.assemblies[oem.partId], `unresolved part_id ${oem.partId}`);
      linked++;
    }
  }
  assert.ok(linked > 0);
});

test('hotspots are bounding boxes reduced to centres', () => {
  const center = hotspotCenter({ diagram_id: 'd', x1: 10, y1: 20, x2: 30, y2: 60, code: 'c' });
  assert.deepEqual(center, { x: 20, y: 40 });
});

test('the catalogue references more diagrams than the bundle ships', () => {
  const cat = loadAssemblies(YARIS);
  const onDisk = listDiagramsWithAssets(YARIS);

  // Guard rail for the UI team: never assume a diagram_id has an image.
  assert.ok(
    onDisk.length < Object.keys(cat.diagrams).length,
    'expected the bundle to ship only a subset of diagram assets',
  );
  for (const diagramId of onDisk) {
    assert.equal(hasDiagramAssets(YARIS, diagramId), true);
  }
});

test('diagram segments join annotations to parts via hotspot code', () => {
  const cat = loadAssemblies(YARIS);

  // Only diagrams whose assets shipped can produce segments.
  const withAssets = listDiagramsWithAssets(YARIS);
  assert.ok(withAssets.length > 0, 'no diagram assets on disk');

  let diagramsWithSegments = 0;
  let totalSegments = 0;

  for (const diagramId of withAssets) {
    const segments = loadDiagramSegments(YARIS, diagramId);
    if (segments.length) diagramsWithSegments++;
    totalSegments += segments.length;

    for (const segment of segments) {
      assert.ok(cat.assemblies[segment.partId], 'segment must resolve to a real part');
      assert.equal(segment.object.kind, 'pnc');
      assert.equal(cat.assemblies[segment.partId]?.hotspot?.code, segment.code);
    }
  }

  assert.ok(
    diagramsWithSegments > 20,
    `expected most shipped diagrams to map onto parts, got ${diagramsWithSegments}`,
  );
  assert.ok(totalSegments > 100, `expected plenty of segments, got ${totalSegments}`);
});

test('buildProximityGraph produces a sparse, connected-enough graph', () => {
  const cat = loadAssemblies(YARIS);
  const graph = buildProximityGraph(cat);
  const stats = graphStats(graph);

  assert.ok(stats.nodes > 3000, `expected >3000 nodes, got ${stats.nodes}`);
  assert.ok(stats.spatialEdges > 0);
  assert.ok(stats.assemblyEdges > 0, 'sub_assembly_ids are the only cross-diagram bridge');
  assert.ok(stats.avgDegree < 40, `graph too dense: avg degree ${stats.avgDegree}`);

  // Undirected: spatial kNN can be asymmetric, but assembly edges must be symmetric.
  for (const edges of graph.adjacency.values()) {
    for (const edge of edges) {
      assert.ok(edge.distance >= 0 && edge.distance <= 1, `bad distance ${edge.distance}`);
      if (edge.kind !== 'assembly') continue;
      const back = graph.adjacency
        .get(edge.neighborPartId)
        ?.some((e) => e.neighborPartId === edge.partId && e.kind === 'assembly');
      assert.ok(back, 'assembly edges must exist in both directions');
    }
  }

  assert.equal(toEdgeRows(graph).length, stats.edges);
});

test('oracle ranks plausible hidden damage from the real prediction', () => {
  const cat = loadAssemblies(YARIS);
  const graph = proximityGraph(YARIS);
  const preds = loadPredictions(YARIS);

  // Seed with the parts the AI actually saw damaged.
  const seeds = preds.parts
    .flatMap((p) => p.oemParts.slice(0, 1))
    .map((p) => ({ partId: p.partId, weight: 1 }));
  assert.ok(seeds.length > 0);

  const ranked = scoreHiddenDamage(graph, cat, seeds, { limit: 10 });

  assert.ok(ranked.length > 0, 'oracle returned nothing');
  assert.ok(ranked.length <= 10);

  const seedIds = new Set(seeds.map((s) => s.partId));
  for (const item of ranked) {
    assert.ok(!seedIds.has(item.partId), 'must not re-suggest already-visible damage');
    assert.ok(item.score > 0 && item.score <= 1, `score out of range: ${item.score}`);
    assert.equal(cat.assemblies[item.partId]?.is_orderable, true, 'orderableOnly was set');
    assert.ok(item.reason.length > 0);
    assert.ok(item.displayName.length > 0);
  }

  // Ranked descending.
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1]!.score >= ranked[i]!.score, 'results must be sorted by score');
  }
});

test('searchParts resolves free text onto catalogue parts', () => {
  const hits = searchParts(YARIS, 'front bumper cover', 5);
  assert.ok(hits.length > 0, 'expected a match for "front bumper cover"');
  assert.ok(hits[0]!.assembly.display_name.toLowerCase().includes('front bumper cover'));

  assert.deepEqual(searchParts(YARIS, '   '), []);
});
