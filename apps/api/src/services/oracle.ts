/**
 * The hidden-damage oracle.
 *
 * Thin orchestration only: the graph maths lives in `@partli/shared/dataset` so
 * it stays pure and testable. This module turns a job's visible damage into seeds,
 * runs the scoring, and hands back rows ready to persist.
 */

import type { DamageItem, HiddenDamagePrediction } from '@partli/shared';
import {
  loadAssemblies,
  loadPredictions,
  hasPredictions,
  proximityGraph,
  scoreHiddenDamage,
  type DamageSeed,
} from '@partli/shared/dataset';
import type { HiddenDamageInput } from '../repositories/jobs.js';

/** Severity from the AI dataset -> how strongly that part should pull the scoring. */
const SEVERITY_WEIGHT: Record<string, number> = {
  severe: 1,
  moderate: 0.7,
  minor: 0.4,
};

function weightForSeverity(severity: string | null | undefined): number {
  if (!severity) return 0.8;
  return SEVERITY_WEIGHT[severity.toLowerCase()] ?? 0.8;
}

export interface RunOracleInput {
  vehicleSlug: string;
  visibleDamage: DamageItem[];
  /** Predictions the repairer already confirmed also count as real damage. */
  confirmedHidden?: HiddenDamagePrediction[];
  limit?: number;
}

export interface RunOracleResult {
  predictions: HiddenDamageInput[];
  seedCount: number;
}

/**
 * Score hidden damage for a job.
 *
 * Seeds are the job's visible damage, weighted by the AI's severity call where we
 * can match the part back to the prediction file, plus anything the repairer has
 * already confirmed. Returns [] when there is nothing to reason from.
 */
export function runOracle(input: RunOracleInput): RunOracleResult {
  const { vehicleSlug, visibleDamage, confirmedHidden = [], limit = 10 } = input;

  const catalogue = loadAssemblies(vehicleSlug);
  const graph = proximityGraph(vehicleSlug);

  // Severity lookup, keyed by catalogue part id, from the shipped AI prediction.
  const severityByPartId = new Map<string, string | null>();
  if (hasPredictions(vehicleSlug)) {
    for (const part of loadPredictions(vehicleSlug).parts) {
      for (const oem of part.oemParts) {
        if (!severityByPartId.has(oem.partId)) severityByPartId.set(oem.partId, part.severity);
      }
    }
  }

  const seeds: DamageSeed[] = [];

  for (const item of visibleDamage) {
    if (!catalogue.assemblies[item.partId]) continue; // not a real catalogue part
    seeds.push({ partId: item.partId, weight: weightForSeverity(severityByPartId.get(item.partId)) });
  }

  for (const prediction of confirmedHidden) {
    if (prediction.confirmed !== true) continue;
    if (!catalogue.assemblies[prediction.partId]) continue;
    if (seeds.some((s) => s.partId === prediction.partId)) continue;
    seeds.push({ partId: prediction.partId, weight: 1 });
  }

  if (seeds.length === 0) return { predictions: [], seedCount: 0 };

  const scored = scoreHiddenDamage(graph, catalogue, seeds, { limit });

  return {
    seedCount: seeds.length,
    predictions: scored.map((item) => ({
      partId: item.partId,
      displayName: item.displayName,
      confidenceScore: Number(item.score.toFixed(4)),
      reason: item.reason,
    })),
  };
}

/**
 * Seed a brand-new job's visible damage from the shipped AI prediction, so the demo
 * has something to work with before anyone speaks. Best catalogue match per damaged
 * part; parts the AI could not link are skipped.
 */
export function visibleDamageFromPredictions(
  vehicleSlug: string,
): Array<{ partId: string; displayName: string; manufacturerPartNumber: string | null }> {
  if (!hasPredictions(vehicleSlug)) return [];

  const catalogue = loadAssemblies(vehicleSlug);
  const seen = new Set<string>();
  const out: Array<{
    partId: string;
    displayName: string;
    manufacturerPartNumber: string | null;
  }> = [];

  for (const part of loadPredictions(vehicleSlug).parts) {
    const best = part.oemParts[0];
    if (!best || seen.has(best.partId)) continue;
    const assembly = catalogue.assemblies[best.partId];
    if (!assembly) continue;
    seen.add(best.partId);
    out.push({
      partId: best.partId,
      displayName: assembly.display_name,
      manufacturerPartNumber: assembly.manufacturer_part_number ?? null,
    });
  }

  return out;
}
