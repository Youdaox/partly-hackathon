/**
 * Mock damage data for the AI Damage Inspection Viewer demo.
 *
 * Stands in for a real detection pipeline (out of scope — see screens/InspectionViewerScreen.tsx).
 * meshName values match the parts named in components/VehicleViewer/PlaceholderCarModel.tsx.
 */

import type { DamageRegion } from '@/types/damage';

export const mockDamageData: DamageRegion[] = [
  // --- visible: what a repairer can see standing in front of the car ---
  {
    meshName: 'FrontBumper',
    partName: 'Front bumper',
    damageType: 'visible',
    confidence: 0.95,
    description: 'Cracks and deformation detected across the lower bumper cover.',
    explanation:
      'Impact point and crack propagation are consistent with a direct frontal collision.',
    parts: ['Front bumper cover', 'Bumper reinforcement', 'Fog light bezel'],
  },
  {
    meshName: 'LeftHeadlight',
    partName: 'Left headlight',
    damageType: 'visible',
    confidence: 0.9,
    description: 'Lens shattered, housing cracked at the mounting tab.',
    explanation: 'Shattered lens pattern matches direct impact rather than a stone chip.',
    parts: ['Headlight assembly', 'Headlight mounting bracket'],
  },
  {
    meshName: 'LeftFender',
    partName: 'Left fender',
    damageType: 'visible',
    confidence: 0.82,
    description: 'Visible crease running from the wheel arch toward the headlight.',
    explanation: 'Crease direction suggests force transferred from the bumper corner.',
    parts: ['Front fender panel', 'Fender liner'],
  },

  // --- invisible: what the AI infers is likely damaged behind the panels ---
  {
    meshName: 'CrashBar',
    partName: 'Crash reinforcement bar',
    damageType: 'invisible',
    confidence: 0.78,
    description: 'Possible structural deformation based on impact force.',
    explanation:
      'Impact severity suggests possible deformation behind the bumper assembly — ' +
      'this class of frontal hit bends the crash bar in similar vehicles more often than not.',
    parts: ['Crash bar', 'Absorber', 'Mounting brackets'],
  },
  {
    meshName: 'RadiatorSupport',
    partName: 'Radiator support',
    damageType: 'invisible',
    confidence: 0.64,
    description: 'Possible misalignment where the support meets the crash bar.',
    explanation:
      'Bumper deformation of this magnitude often pushes the radiator support back far ' +
      'enough to misalign the core — worth checking before ordering cooling parts.',
    parts: ['Radiator support panel', 'Core mounting bushings'],
  },
  {
    meshName: 'Sensors',
    partName: 'Parking sensors',
    damageType: 'invisible',
    confidence: 0.55,
    description: 'Front sensor cluster sits directly behind the cracked bumper section.',
    explanation:
      'Sensors mounted in the damaged bumper span are frequently knocked out of calibration ' +
      'even when the housing looks intact — flag for a recalibration check.',
    parts: ['Parking sensor', 'Sensor wiring harness'],
  },
];
