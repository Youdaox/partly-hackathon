/**
 * The 3D inspection's damage data.
 *
 * Still a mock — this screen does not call the backend — but it is no longer an
 * invented car. It mirrors what the prediction flow actually returns for rego
 * QMN16 (Toyota Yaris 2023, front-right impact), so a judge moving between the
 * two screens sees one vehicle and one set of parts rather than two demos.
 *
 * The prediction flow is the source of truth, and one thing about it is worth
 * knowing when comparing the screens: Partly's interpreter reports the bumper
 * reinforcement and the impact absorber as *visible* on this vehicle — they are
 * named in the photo captions — so they sit in the visible group here too, even
 * though they are the classic "hidden" examples. What our engine adds is the
 * group below them: the lamp brackets, the radiator support and the chassis
 * rail brace, which appear in no photo at all.
 *
 * `explanation` lines are the reasons the engine actually produces (see
 * `backend/app/engines/graph.py::_reason`), so the wording matches too.
 *
 * meshName values must exist in components/VehicleViewer/carLayout.ts. That
 * file was rewritten for the real Corolla GLB, whose overlay regions cover the
 * components a repairer thinks in rather than a full parts catalogue — so four
 * parts here point at the nearest region that does exist rather than at
 * geometry nobody placed:
 *
 *   reinforcement + rail brace  -> CrashBar        (one region, so one entry)
 *   impact absorber             -> folded into the bumper cover's parts
 *   right headlamp bracket      -> RightHeadlight  (carries that lamp)
 *
 * Parts that share a region are merged into one entry rather than left as two
 * rows fighting over the same mesh — the reinforcement and the brace behind it
 * are the same place on the car, and the absorber is directly behind the
 * cover. The headlamp bracket keeps its own entry because it is the hidden
 * counterpart of a visible part, and the two never show under the same toggle.
 * If those regions are ever placed individually, split these back out.
 */

import type { DamageRegion } from '@/types/damage';

export const mockDamageData: DamageRegion[] = [
  // --- visible: what Partly's interpreter identified in the photos ---------
  // Observed facts. `confidence` stays because the 3D overlay uses it for
  // opacity, but no percentage is shown for these anywhere in the UI.
  {
    meshName: 'FrontBumper',
    partName: 'Front bumper cover',
    damageType: 'visible',
    confidence: 0.95,
    description: 'Cracked and deformed across the front-right corner.',
    explanation: 'The outer skin at the point of impact.',
    parts: [
      'Front bumper cover',
      'Front bumper grille',
      'Front bumper badge',
      'Front bumper impact absorber',
    ],
  },
  {
    meshName: 'RightHeadlight',
    partName: 'Right headlamp assembly',
    damageType: 'visible',
    confidence: 0.95,
    description: 'Lens shattered, housing cracked at the mounting tab.',
    explanation: 'In the impact zone and rarely survives it.',
    parts: ['Headlamp assembly', 'Headlamp lens', 'Headlamp housing'],
  },
  {
    meshName: 'RightFender',
    partName: 'Right front guard panel',
    damageType: 'visible',
    confidence: 0.95,
    description: 'Creased from the wheel arch forward to the headlamp.',
    explanation: 'Adjacent panel in the impact corner.',
    parts: ['Front guard panel', 'Guard liner', 'Guard grommets'],
  },

  // --- invisible: what our engine predicts, behind the panels --------------
  // In no photo. Only these carry a likelihood on screen.
  {
    meshName: 'RightHeadlight',
    partName: 'Right headlamp bracket',
    damageType: 'invisible',
    confidence: 0.88,
    description: 'Radiator support headlamp bracket, right side.',
    explanation: 'Bolted to the right headlamp assembly.',
    parts: ['Radiator support headlamp bracket - right', 'Inner guard headlamp bracket'],
  },
  {
    meshName: 'RadiatorSupport',
    partName: 'Radiator support',
    damageType: 'invisible',
    confidence: 0.81,
    description: 'Carries the headlamp bracket and the cooling pack.',
    explanation: 'Carries the lamp and the cooling pack.',
    parts: ['Radiator support panel', 'Core mounting bushings'],
  },
  {
    meshName: 'CrashBar',
    partName: 'Front bumper reinforcement & rail brace',
    damageType: 'invisible',
    confidence: 0.62,
    description: 'Bar deformed behind the cover; the brace behind it folds with it.',
    explanation: 'Took the load once the cover and absorber gave way.',
    parts: [
      'Bumper reinforcement bar',
      'Front bumper reinforcement brace - right',
      'Chassis rail brace',
    ],
  },
];
