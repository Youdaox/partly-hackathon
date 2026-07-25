import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchVehicle } from './matching.js';
import type { VehicleSummary } from './types.js';

/** The real demo fleet, as `listVehicles()` parses it. */
const FLEET: VehicleSummary[] = [
  { slug: 'hyundai-iload-ezu765', make: 'hyundai', model: 'iload', year: null, hasCatalogue: false, hasPrediction: true },
  { slug: 'hyundai-santafe-pns53', make: 'hyundai', model: 'SANTA FE', year: 2022, hasCatalogue: true, hasPrediction: true },
  { slug: 'jaguar-epace-rfh447', make: 'jaguar', model: 'E-PACE', year: 2018, hasCatalogue: true, hasPrediction: true },
  { slug: 'toyota-hiace-nye733', make: 'toyota', model: 'hiace', year: null, hasCatalogue: false, hasPrediction: true },
  { slug: 'toyota-prius-pkw74', make: 'toyota', model: 'prius', year: null, hasCatalogue: false, hasPrediction: true },
  { slug: 'toyota-yaris-qmn16', make: 'toyota', model: 'YARIS', year: 2023, hasCatalogue: true, hasPrediction: true },
];

test('matches on model alone and keeps the damage text', () => {
  const match = matchVehicle('yaris front right hit, bumper hanging off', FLEET);
  assert.equal(match?.vehicle.slug, 'toyota-yaris-qmn16');
  assert.equal(match?.remainder, 'front right hit, bumper hanging off');
});

test('model outranks make when both appear', () => {
  // "toyota" alone is ambiguous across three vehicles; "prius" decides it.
  const match = matchVehicle('toyota prius rear damage', FLEET);
  assert.equal(match?.vehicle.slug, 'toyota-prius-pkw74');
  assert.equal(match?.remainder, 'rear damage');
});

test('handles models written with a space against a squashed slug', () => {
  const match = matchVehicle('santa fe scraped along the left side', FLEET);
  assert.equal(match?.vehicle.slug, 'hyundai-santafe-pns53');
  assert.equal(match?.remainder, 'scraped along the left side');
});

test('handles models written without their hyphen', () => {
  assert.equal(matchVehicle('epace front bumper', FLEET)?.vehicle.slug, 'jaguar-epace-rfh447');
  assert.equal(matchVehicle('e-pace front bumper', FLEET)?.vehicle.slug, 'jaguar-epace-rfh447');
});

test('is case insensitive', () => {
  assert.equal(matchVehicle('YARIS bonnet', FLEET)?.vehicle.slug, 'toyota-yaris-qmn16');
});

test('returns null when no vehicle is named', () => {
  assert.equal(matchVehicle('front bumper cover is cracked', FLEET), null);
  assert.equal(matchVehicle('', FLEET), null);
  assert.equal(matchVehicle('   ', FLEET), null);
});

test('does not match on the registration fragment in a slug', () => {
  // "qmn16" is plate noise, not something a repairer would say to pick a car.
  assert.equal(matchVehicle('16', FLEET), null);
  assert.equal(matchVehicle('pns53', FLEET), null);
});

test('requireCatalogue skips vehicles the oracle cannot run on', () => {
  assert.equal(matchVehicle('prius rear damage', FLEET)?.vehicle.slug, 'toyota-prius-pkw74');
  assert.equal(matchVehicle('prius rear damage', FLEET, { requireCatalogue: true }), null);
});

test('a bare vehicle name leaves no damage text', () => {
  const match = matchVehicle('toyota yaris', FLEET);
  assert.equal(match?.vehicle.slug, 'toyota-yaris-qmn16');
  assert.equal(match?.remainder, '');
});
