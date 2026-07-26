/**
 * Turns a real case report into the 3D viewer's `DamageRegion[]` — the join
 * between the prediction backend and the model.
 *
 * A region is a mesh, not a part: several real catalogue parts (a headlamp
 * assembly, its bracket, its wiring harness connector) commonly land on the
 * one region a repairer would call "the right headlamp area" (see
 * `meshForPart` in `carLayout.ts`), so this groups by mesh and keeps every
 * real part underneath it rather than picking one to represent the rest.
 *
 * Hardware and consumable lines are skipped outright — the report already
 * folds fasteners away from the main sections for the same reason (nine clip
 * rows made a list unreadable), and the backend does not send `klass`/`side`
 * for them at all, to stay under its payload budget.
 */

import type { Bucket, ReportLine } from '@partli/shared';

import { meshForPart } from '@/components/VehicleViewer/carLayout';
import type { DamageRegion, DamageType, RegionPart } from '@/types/damage';
import type { CaseReport } from '@/lib/backend';

function toRegionPart(line: ReportLine, bucket: Bucket): RegionPart {
  return {
    partId: line.part_id,
    name: line.name,
    qty: line.qty,
    bucket,
    p: line.p,
    reason: line.reason,
    confirmed: line.confirmed,
    diagramId: line.diagram_id,
    diagramAvailable: line.diagram_available,
  };
}

/** Short, plain-language line for the region as a whole. */
function describeRegion(damageType: DamageType, parts: RegionPart[]): string {
  if (damageType === 'visible') {
    const names = parts.map((p) => p.name);
    return names.length > 1 ? `${names[0]} and ${names.length - 1} more` : names[0];
  }
  // Predicted: lead with why, since that's the sentence a repairer actually reads.
  return parts[0].reason ?? `${parts.length} part${parts.length === 1 ? '' : 's'} predicted here.`;
}

/**
 * Build the 3D viewer's regions from a live case report.
 *
 * `impactZone` stands in for the per-part zone the API leaves out (see
 * `_region_hint` in `report_service.py`) — safe because the report never
 * surfaces a part far from where the hit happened.
 */
export function regionsFromReport(report: CaseReport | null | undefined): DamageRegion[] {
  if (!report) return [];
  const impactZone = report.impact?.zone ?? 'front';

  const byMesh = new Map<string, { visible: RegionPart[]; predicted: RegionPart[] }>();

  const fold = (lines: ReportLine[] | undefined, bucket: Bucket) => {
    for (const line of lines ?? []) {
      // Lines with no klass carry no region hint (hardware/consumables never
      // do; see report_service.py) — nothing to place, so skip rather than guess.
      if (!line.klass) continue;
      const meshName = meshForPart(line.klass, line.side ?? 'C', impactZone);
      const entry = byMesh.get(meshName) ?? { visible: [], predicted: [] };
      const part = toRegionPart(line, bucket);
      (bucket === 'visible' ? entry.visible : entry.predicted).push(part);
      byMesh.set(meshName, entry);
    }
  };

  fold(report.sections?.visible, 'visible');
  fold(report.sections?.order, 'order');
  fold(report.sections?.check, 'check');

  const regions: DamageRegion[] = [];
  for (const [meshName, { visible, predicted }] of byMesh) {
    // A mesh reads "confirmed" (orange) if the camera stated it outright, or a
    // repairer ticked a predicted part on it — same "Confirmed" the report page's
    // own filter tab uses, so the two agree about what counts as settled rather
    // than the 3D view drawing a line the list underneath disagrees with.
    const ticked = predicted.filter((p) => p.confirmed === true);
    const damageType: DamageType = visible.length > 0 || ticked.length > 0 ? 'visible' : 'invisible';
    const parts = [...visible, ...predicted].sort((a, b) => b.p - a.p);
    const confidence =
      damageType === 'visible'
        ? Math.max(0.9, ...visible.map((p) => p.p), ...ticked.map((p) => p.p))
        : Math.max(...predicted.map((p) => p.p));

    regions.push({
      meshName,
      partName: parts[0].name,
      damageType,
      confidence,
      // The combined, confidence-sorted list either way — a ticked part sorted in
      // was never pulled into a separate `visible`-only array to describe from.
      description: describeRegion(damageType, parts),
      parts,
    });
  }

  return regions;
}
