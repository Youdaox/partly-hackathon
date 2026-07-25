/**
 * Loaders for the on-disk dataset.
 *
 * These are the only functions in the monorepo that read `data/`. They parse the raw
 * `completed`-wrapped JSON into the flat shapes the rest of the app uses, and cache
 * per-slug because `assemblies.json` is multi-megabyte (7k parts for the Yaris).
 */

import fs from 'node:fs';
import type {
  DiagramId,
  PartId,
  VehicleSlug,
  VehicleSummary,
} from '../types.js';
import {
  annotationsFile,
  assembliesFile,
  diagramDir as diagramDirPath,
  diagramMetaFile,
  getDataDir,
  predictionsFile,
  vehicleDir as vehicleDirPath,
  vehicleFile,
} from './paths.js';
import type {
  RawAnnotationObject,
  RawAnnotationsFile,
  RawAssembliesFile,
  RawAssembly,
  RawDiagram,
  RawDiagramMeta,
  RawPredictionsFile,
  RawVehicleFile,
} from './raw.js';

import path from 'node:path';

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

/** Flatten the `[{make: "toyota"}, {model: "YARIS"}]` property-list format. */
function flattenVariantProperties(
  props: Array<Record<string, string | number>> | undefined,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const entry of props ?? []) {
    for (const [k, v] of Object.entries(entry)) {
      // Later entries win; `production_year` is more specific than `production_year_from`.
      out[k] = v;
    }
  }
  return out;
}

export function loadVehicle(slug: VehicleSlug): VehicleSummary {
  const hasCatalogue = fs.existsSync(assembliesFile(slug));
  const hasPrediction = fs.existsSync(predictionsFile(slug));

  let make = '';
  let model = '';
  let year: number | null = null;

  if (fs.existsSync(vehicleFile(slug))) {
    const raw = readJson<RawVehicleFile>(vehicleFile(slug));
    const variant = raw.completed?.variants?.[0];
    const props = flattenVariantProperties(variant?.properties);
    make = String(props.make ?? raw.completed?.oem_brand ?? '');
    model = String(props.model ?? '');
    const rawYear = props.production_year ?? props.production_year_from;
    year = rawYear == null ? null : Number(rawYear);
  }

  // Fall back to the slug (`toyota-yaris-qmn16` -> toyota / yaris) so vehicles
  // without a vehicle.json still render sensibly.
  if (!make || !model) {
    const parts = slug.split('-');
    make ||= parts[0] ?? slug;
    model ||= parts[1] ?? '';
  }

  return { slug, make, model, year, hasCatalogue, hasPrediction };
}

/** Every vehicle that has either a catalogue or a prediction, sorted by slug. */
export function listVehicles(): VehicleSummary[] {
  const dataDir = getDataDir();
  const slugs = new Set<string>();

  const vehiclesDir = path.join(dataDir, 'vehicles');
  if (fs.existsSync(vehiclesDir)) {
    for (const entry of fs.readdirSync(vehiclesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) slugs.add(entry.name);
    }
  }

  const predsDir = path.join(dataDir, 'predictions');
  if (fs.existsSync(predsDir)) {
    for (const file of fs.readdirSync(predsDir)) {
      if (file.endsWith('.json')) slugs.add(file.replace(/\.json$/, ''));
    }
  }

  return [...slugs].sort().map(loadVehicle);
}

// ---------------------------------------------------------------------------
// Assemblies (the parts catalogue)
// ---------------------------------------------------------------------------

export interface AssemblyCatalogue {
  vehicleSlug: VehicleSlug;
  /** All parts, keyed by part id. */
  assemblies: Record<PartId, RawAssembly>;
  /** All exploded diagrams, keyed by diagram id. */
  diagrams: Record<DiagramId, RawDiagram>;
  rootNodes: PartId[];
  /** partId -> the diagram its hotspot sits on. Each part belongs to at most one. */
  diagramOfPart: Map<PartId, DiagramId>;
  /** diagramId -> parts placed on it. */
  partsOfDiagram: Map<DiagramId, PartId[]>;
}

const catalogueCache = new Map<VehicleSlug, AssemblyCatalogue>();

export function loadAssemblies(slug: VehicleSlug): AssemblyCatalogue {
  const cached = catalogueCache.get(slug);
  if (cached) return cached;

  const file = assembliesFile(slug);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No parts catalogue for "${slug}". Only toyota-yaris-qmn16, hyundai-santafe-pns53 ` +
        'and jaguar-epace-rfh447 ship a full assemblies.json.',
    );
  }

  const raw = readJson<RawAssembliesFile>(file).completed ?? {};
  const assemblies = raw.assemblies ?? {};
  const diagrams = raw.diagrams ?? {};

  const diagramOfPart = new Map<PartId, DiagramId>();
  const partsOfDiagram = new Map<DiagramId, PartId[]>();

  for (const [partId, assembly] of Object.entries(assemblies)) {
    const diagramId = assembly.hotspot?.diagram_id;
    if (!diagramId) continue;
    diagramOfPart.set(partId, diagramId);
    const list = partsOfDiagram.get(diagramId);
    if (list) list.push(partId);
    else partsOfDiagram.set(diagramId, [partId]);
  }

  const catalogue: AssemblyCatalogue = {
    vehicleSlug: slug,
    assemblies,
    diagrams,
    rootNodes: raw.root_nodes ?? [],
    diagramOfPart,
    partsOfDiagram,
  };
  catalogueCache.set(slug, catalogue);
  return catalogue;
}

export function hasCatalogue(slug: VehicleSlug): boolean {
  return fs.existsSync(assembliesFile(slug));
}

/** Look up one part. Returns null rather than throwing so callers can 404 cleanly. */
export function findPart(
  slug: VehicleSlug,
  partId: PartId,
): { partId: PartId; assembly: RawAssembly } | null {
  const { assemblies } = loadAssemblies(slug);
  const assembly = assemblies[partId];
  return assembly ? { partId, assembly } : null;
}

/**
 * Search index for one vehicle: every part's name tokens, plus how many parts each
 * token appears in. Built once per slug because the Yaris has 7k parts.
 */
interface SearchIndex {
  totalParts: number;
  /** token -> number of parts whose name contains it. */
  documentFrequency: Map<string, number>;
  entries: Array<{
    partId: PartId;
    assembly: RawAssembly;
    name: string;
    tokens: Set<string>;
  }>;
}

const searchIndexCache = new Map<VehicleSlug, SearchIndex>();

function getSearchIndex(slug: VehicleSlug): SearchIndex {
  const cached = searchIndexCache.get(slug);
  if (cached) return cached;

  const { assemblies } = loadAssemblies(slug);
  const entries: SearchIndex['entries'] = [];
  const documentFrequency = new Map<string, number>();

  for (const [partId, assembly] of Object.entries(assemblies)) {
    const name = assembly.display_name?.toLowerCase();
    if (!name) continue;
    const tokens = new Set(tokenizeName(name));
    entries.push({ partId, assembly, name, tokens });
    for (const token of tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const index: SearchIndex = { totalParts: entries.length, documentFrequency, entries };
  searchIndexCache.set(slug, index);
  return index;
}

/**
 * Resolve free text from voice capture onto real catalogue parts.
 *
 * Matches on words rather than the whole string, because a repairer says "headlamp
 * smashed", not "Left Headlamp Assembly". Each matched word is weighted by how rare
 * it is across the catalogue (IDF), so "bumper" counts for far more than "front" —
 * without that, any part containing a common positional word floods the results.
 *
 * On top of the word scores:
 *   - the full phrase appearing verbatim is a large bonus, so exact names still win
 *   - parts that cannot be ordered are pushed right down; they cannot be quoted
 *   - fasteners and trim are demoted unless the query actually named them
 *   - duplicate display names are collapsed, keeping the best-scoring part id
 */
export function searchParts(
  slug: VehicleSlug,
  query: string,
  limit = 10,
): Array<{ partId: PartId; assembly: RawAssembly; score: number }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const queryTokens = meaningfulTokens(needle);
  if (queryTokens.length === 0) return [];

  const index = getSearchIndex(slug);
  const results: Array<{ partId: PartId; assembly: RawAssembly; score: number }> = [];

  // Rarer words identify a part better. log(N / df) is the standard weighting.
  const weightOf = (token: string) => {
    const df = index.documentFrequency.get(token) ?? 0;
    if (df === 0) return 0;
    return Math.log(index.totalParts / df);
  };

  for (const entry of index.entries) {
    const { name, tokens, assembly } = entry;

    let score = 0;
    let matched = 0;
    for (const token of queryTokens) {
      if (!tokens.has(token)) continue;
      matched++;
      score += weightOf(token);
    }

    const phraseHit = name.includes(needle);
    if (matched === 0 && !phraseHit) continue;

    if (phraseHit) score += 6;
    if (name === needle) score += 10;
    else if (name.startsWith(needle)) score += 2;

    // A part the shop cannot order is almost never the right answer.
    if (!assembly.is_orderable) score -= 5;

    // Someone describing visible damage means the panel, not the clip holding it on.
    for (const word of MINOR_PART_WORDS) {
      if (tokens.has(word) && !queryTokens.includes(word)) {
        score -= 3;
        break;
      }
    }

    // Conversely, "headlamp" most likely means the whole headlamp assembly.
    for (const word of MAJOR_PART_WORDS) {
      if (tokens.has(word) && !queryTokens.includes(word)) {
        score += 1;
        break;
      }
    }

    // Tiebreak towards the shorter, less qualified name.
    score -= name.length / 1000;

    // Callers treat lower as better, so invert.
    results.push({ partId: entry.partId, assembly, score: -score });
  }

  results.sort((a, b) => a.score - b.score);

  // The catalogue holds several part ids per physical part (trim and variant rows),
  // so without this the top of the list is the same name three times over.
  const seen = new Set<string>();
  const deduped: typeof results = [];
  for (const hit of results) {
    const key = hit.assembly.display_name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(hit);
    if (deduped.length === limit) break;
  }

  return deduped;
}

/** Fasteners and trim — rarely what someone means when describing visible damage. */
const MINOR_PART_WORDS = [
  'clip', 'retainer', 'fastener', 'screw', 'bolt', 'nut', 'grommet', 'washer',
  'spacer', 'pin', 'plug', 'cap', 'insert', 'bracket', 'brace', 'stay', 'liner',
  'surround', 'moulding', 'seal', 'gasket', 'stud', 'rivet', 'label', 'bump',
];

/** Words that mark the main serviceable unit rather than a sub-component. */
const MAJOR_PART_WORDS = ['assembly', 'panel'];

const tokenizeName = (value: string) => value.split(/[^a-z0-9]+/i).filter(Boolean);

/** Query tokens worth matching on: real words, not stopwords, not single letters. */
function meaningfulTokens(query: string): string[] {
  const seen = new Set<string>();
  for (const token of tokenizeName(query)) {
    if (token.length < 2) continue;
    if (SEARCH_STOPWORDS.has(token)) continue;
    seen.add(token);
  }
  return [...seen];
}

/**
 * Words too common to identify a part, plus the damage vocabulary a repairer speaks
 * but the catalogue never uses. Without this, "the front bumper is cracked" would
 * rank anything containing "is".
 */
const SEARCH_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'is', 'are', 'was', 'were', 'it', 'its', 'to', 'of',
  'in', 'on', 'off', 'at', 'by', 'for', 'with', 'from', 'this', 'that', 'there',
  'has', 'have', 'had', 'been', 'be', 'i', 'we', 'my', 'you', 'all', 'some', 'bit',
  // Damage vocabulary — describes the state, not the part.
  'damaged', 'damage', 'broken', 'break', 'smashed', 'smash', 'cracked', 'crack',
  'scratched', 'scratch', 'scraped', 'scrape', 'dented', 'dent', 'bent', 'hit',
  'hanging', 'missing', 'torn', 'tear', 'loose', 'gone', 'destroyed', 'crushed',
  'shattered', 'ripped', 'pushed', 'completely', 'badly', 'quite', 'very', 'looks',
  'need', 'needs', 'replace', 'replaced', 'replacement', 'repair', 'repaired',
]);

// ---------------------------------------------------------------------------
// Diagrams
// ---------------------------------------------------------------------------

/**
 * Whether this diagram's image + annotations actually ship in the bundle.
 *
 * Heads up: the catalogue references far more diagrams than the dataset includes.
 * For the Yaris, `assemblies.json` names 187 diagrams but only 50 have a folder on
 * disk. Always check this before trying to render a diagram image.
 */
export function hasDiagramAssets(slug: VehicleSlug, diagramId: DiagramId): boolean {
  return fs.existsSync(diagramDirPath(slug, diagramId));
}

/** The diagram ids that have an image + annotations on disk, sorted. */
export function listDiagramsWithAssets(slug: VehicleSlug): DiagramId[] {
  const dir = path.join(vehicleDirPath(slug), 'diagrams');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function loadDiagramMeta(slug: VehicleSlug, diagramId: DiagramId): RawDiagramMeta | null {
  const file = diagramMetaFile(slug, diagramId);
  if (!fs.existsSync(file)) return null;
  return readJson<RawDiagramMeta>(file);
}

/**
 * Segment polygons for a diagram. Only `kind: "pnc"` objects carry a usable `code`,
 * which matches `assembly.hotspot.code` — that is how a polygon maps back to a part.
 */
export function loadAnnotations(
  slug: VehicleSlug,
  diagramId: DiagramId,
): RawAnnotationObject[] {
  const file = annotationsFile(slug, diagramId);
  if (!fs.existsSync(file)) return [];
  return readJson<RawAnnotationsFile>(file).completed?.annotation?.objects ?? [];
}

/** Map a diagram's polygons onto part ids via the shared hotspot `code`. */
export function loadDiagramSegments(
  slug: VehicleSlug,
  diagramId: DiagramId,
): Array<{ partId: PartId; code: string; displayName: string; object: RawAnnotationObject }> {
  const { assemblies, partsOfDiagram } = loadAssemblies(slug);
  const byCode = new Map<string, PartId>();
  for (const partId of partsOfDiagram.get(diagramId) ?? []) {
    const code = assemblies[partId]?.hotspot?.code;
    if (code) byCode.set(code, partId);
  }

  const out: Array<{
    partId: PartId;
    code: string;
    displayName: string;
    object: RawAnnotationObject;
  }> = [];
  for (const object of loadAnnotations(slug, diagramId)) {
    if (object.kind !== 'pnc' || !object.code) continue;
    const partId = byCode.get(object.code);
    if (!partId) continue;
    out.push({
      partId,
      code: object.code,
      displayName: assemblies[partId]?.display_name ?? '',
      object,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

/** A damaged part from the AI prediction, already linked to catalogue part ids. */
export interface ParsedPrediction {
  rawPartName: string;
  severity: string | null;
  confidence: string | null;
  damageReason: string | null;
  recommendedAction: string | null;
  /** Catalogue matches, best first. Empty when the AI could not link it. */
  oemParts: Array<{
    partId: PartId;
    partName: string;
    diagramId: DiagramId | null;
    confidence: string | null;
  }>;
}

export interface ParsedPredictions {
  vehicleSlug: VehicleSlug;
  damageSummary: string | null;
  /** Frames the model chose as collision-relevant. */
  contextFrames: Array<{ uri: string; relevanceScore: number; context: string }>;
  parts: ParsedPrediction[];
}

const predictionCache = new Map<VehicleSlug, ParsedPredictions>();

export function hasPredictions(slug: VehicleSlug): boolean {
  return fs.existsSync(predictionsFile(slug));
}

export function loadPredictions(slug: VehicleSlug): ParsedPredictions {
  const cached = predictionCache.get(slug);
  if (cached) return cached;

  const file = predictionsFile(slug);
  if (!fs.existsSync(file)) {
    throw new Error(`No prediction file for "${slug}" at ${file}`);
  }

  const raw = readJson<RawPredictionsFile>(file);

  const contextFrames = (raw.context_selection?.completed?.data?.selected ?? []).map((s) => ({
    uri: s.uri,
    relevanceScore: s.relevance_score,
    context: s.collision_context,
  }));

  // `oem_parts` is the catalogue-linked view of the same damage `raw_parts` describes.
  // Prefer it; fall back to raw_parts for anything the linker dropped.
  const oemGroups = raw.oem_parts?.completed?.data?.oem_parts ?? [];
  const rawParts = raw.raw_parts?.completed?.data?.recommended_parts ?? [];

  const parts: ParsedPrediction[] = oemGroups.map((group) => ({
    rawPartName: group.raw_part_name,
    severity: group.severity ?? null,
    confidence: group.confidence ?? null,
    damageReason: group.damage_reason ?? null,
    recommendedAction: group.recommended_action ?? null,
    oemParts: (group.associated_oem_parts ?? []).map((p) => ({
      partId: p.part_id,
      partName: p.part_name,
      diagramId: p.diagram_id ?? null,
      confidence: p.confidence ?? null,
    })),
  }));

  const linked = new Set(parts.map((p) => p.rawPartName));
  for (const rp of rawParts) {
    if (linked.has(rp.raw_part_name)) continue;
    parts.push({
      rawPartName: rp.raw_part_name,
      severity: rp.severity ?? null,
      confidence: rp.confidence ?? null,
      damageReason: rp.damage_reason ?? null,
      recommendedAction: rp.recommended_action ?? null,
      oemParts: [],
    });
  }

  const parsed: ParsedPredictions = {
    vehicleSlug: slug,
    damageSummary: raw.raw_parts?.completed?.data?.vehicle_damage_summary ?? null,
    contextFrames,
    parts,
  };
  predictionCache.set(slug, parsed);
  return parsed;
}

/** Clear the in-memory caches. Useful in tests and after editing data on disk. */
export function clearDatasetCache(): void {
  catalogueCache.clear();
  predictionCache.clear();
  searchIndexCache.clear();
}
