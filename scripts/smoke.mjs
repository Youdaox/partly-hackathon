#!/usr/bin/env node
/**
 * End-to-end smoke test for the First Look API.
 *
 * Walks the entire demo path: create a job, add damage, run the oracle, confirm a
 * prediction, send to the customer, then approve as the customer.
 *
 *   node scripts/smoke.mjs                       # against http://localhost:4000
 *   node scripts/smoke.mjs http://10.0.0.5:4000  # against a LAN address
 */

const BASE = process.argv[2] ?? process.env.API_BASE_URL ?? 'http://localhost:4000';
const SLUG = process.env.VEHICLE_SLUG ?? 'toyota-yaris-qmn16';

let failures = 0;

function check(label, condition, extra = '') {
  const mark = condition ? '[32mPASS[0m' : '[31mFAIL[0m';
  console.log(`  ${mark}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failures++;
  return condition;
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
}

function heading(title) {
  console.log(`\n[1m${title}[0m`);
}

async function main() {
  console.log(`First Look smoke test against ${BASE}`);

  heading('health');
  const health = await call('GET', '/health');
  check('API is up', health.ok === true, `driver=${health.driver}`);

  heading('vehicles');
  const vehicles = await call('GET', '/api/vehicles');
  const withCatalogue = vehicles.filter((v) => v.hasCatalogue);
  check('fleet is listed', vehicles.length >= 8, `${vehicles.length} vehicles`);
  check('three have a full catalogue', withCatalogue.length === 3,
    withCatalogue.map((v) => v.slug).join(', '));
  check('catalogue vehicles sort first', vehicles[0].hasCatalogue === true);

  heading('parts search');
  const found = await call('GET', `/api/vehicles/${SLUG}/parts?q=front%20bumper%20cover`);
  check('free text resolves to catalogue parts', found.length > 0,
    found[0]?.displayName);

  heading('create job');
  const job = await call('POST', '/api/jobs', { vehicleSlug: SLUG, seedFromPrediction: true });
  check('job created', Boolean(job.id), job.id);
  check('starts in capturing', job.status === 'capturing');

  heading('visible damage');
  const voiceItem = await call('POST', `/api/jobs/${job.id}/damage`, {
    rawText: 'left headlamp assembly',
    source: 'voice',
  });
  check('voice text resolved to a real part', Boolean(voiceItem.partId),
    voiceItem.displayName);

  let state = await call('GET', `/api/jobs/${job.id}`);
  check('prediction seeding populated the list', state.visibleDamage.length > 1,
    `${state.visibleDamage.length} items`);
  check('vehicle details resolve', state.vehicle?.model === 'YARIS',
    `${state.vehicle?.make} ${state.vehicle?.model} ${state.vehicle?.year}`);

  console.log('    visible damage:');
  for (const item of state.visibleDamage) {
    console.log(`      - ${item.displayName}  [${item.source}]`);
  }

  heading('oracle: predict hidden damage');
  const { predictions } = await call('POST', `/api/jobs/${job.id}/oracle/predict`, { limit: 8 });
  check('oracle returned predictions', predictions.length > 0, `${predictions.length} items`);
  check('scores are in 0..1', predictions.every((p) => p.confidenceScore >= 0 && p.confidenceScore <= 1));
  check('sorted by confidence', predictions.every((p, i) =>
    i === 0 || predictions[i - 1].confidenceScore >= p.confidenceScore));
  check('every prediction explains itself', predictions.every((p) => p.reason?.length > 0));
  check('no duplicate part names', new Set(predictions.map((p) => p.displayName)).size === predictions.length);

  const visibleNames = new Set(state.visibleDamage.map((d) => d.displayName.toLowerCase()));
  check('does not re-suggest visible damage',
    predictions.every((p) => !visibleNames.has(p.displayName.toLowerCase())));

  console.log('    ranked hidden damage:');
  for (const p of predictions) {
    console.log(`      ${String(Math.round(p.confidenceScore * 100)).padStart(3)}%  ${p.displayName}`);
    console.log(`            ${p.reason}`);
  }

  state = await call('GET', `/api/jobs/${job.id}`);
  check('job advanced to predicted', state.status === 'predicted', state.status);

  heading('oracle: confirm and deny');
  const confirmed = await call('POST', `/api/jobs/${job.id}/oracle/confirm`, {
    predictionId: predictions[0].id,
    confirmed: true,
  });
  check('confirming pins confidence to 1', confirmed.confirmed === true && confirmed.confidenceScore === 1);

  const denied = await call('POST', `/api/jobs/${job.id}/oracle/confirm`, {
    predictionId: predictions[1].id,
    confirmed: false,
  });
  check('denying pins confidence to 0', denied.confirmed === false && denied.confidenceScore === 0);

  state = await call('GET', `/api/jobs/${job.id}`);
  check('confirmed prediction promoted to visible damage',
    state.visibleDamage.some((d) => d.partId === confirmed.partId));

  heading('oracle: re-run keeps human decisions');
  await call('POST', `/api/jobs/${job.id}/oracle/predict`, { limit: 8 });
  state = await call('GET', `/api/jobs/${job.id}`);
  const stillConfirmed = state.hiddenDamage.find((p) => p.id === confirmed.id);
  const stillDenied = state.hiddenDamage.find((p) => p.id === denied.id);
  check('confirmed survives a re-run', stillConfirmed?.confirmed === true);
  check('denied survives a re-run', stillDenied?.confirmed === false);

  heading('send to customer');
  const sent = await call('POST', `/api/jobs/${job.id}/send-to-customer`);
  check('approval link generated', sent.approvalUrl.includes(job.id), sent.approvalUrl);
  check('line items built', sent.lineItems.length > 0, `${sent.lineItems.length} parts`);
  check('each part has supply options', sent.lineItems.every((i) => i.options.length >= 1));

  const denialLeaked = sent.lineItems.some((i) => i.partId === denied.partId);
  check('denied prediction is NOT quoted to the customer', !denialLeaked);

  const hiddenQuoted = sent.lineItems.filter((i) => i.kind === 'hidden');
  check('confirmed hidden damage IS quoted', hiddenQuoted.length > 0,
    hiddenQuoted.map((i) => i.displayName).join(', '));

  console.log('    quote:');
  for (const item of sent.lineItems) {
    const prices = item.options
      .map((o) => `${o.label} $${(o.priceCents / 100).toFixed(0)}/${o.etaDays}d`)
      .join('  |  ');
    console.log(`      ${item.displayName} (${item.kind})`);
    console.log(`         ${prices}`);
  }

  heading('customer approval');
  const payload = await call('GET', `/api/approve/${job.id}`);
  check('public page can read the quote', payload.lineItems.length === sent.lineItems.length);
  check('nothing approved yet', payload.approvedOption === null);

  let rejected = false;
  try {
    await call('POST', `/api/approve/${job.id}`, { optionId: 'made-up-option' });
  } catch {
    rejected = true;
  }
  check('an option that was never offered is rejected', rejected);

  const chosen = payload.lineItems[0].options.find((o) => o.tier === 'aftermarket')
    ?? payload.lineItems[0].options[0];
  const approved = await call('POST', `/api/approve/${job.id}`, { optionId: chosen.id });
  check('customer approval recorded', approved.approvedOption === chosen.id, chosen.label);
  check('approval is timestamped', Boolean(approved.approvedAt));
  check('job status is approved', approved.status === 'approved');

  heading('dashboard');
  const jobs = await call('GET', '/api/jobs');
  const listed = jobs.find((j) => j.id === job.id);
  check('job appears on the dashboard', Boolean(listed), `${jobs.length} jobs total`);
  check('dashboard shows final status', listed?.status === 'approved');

  heading('error handling');
  let badVehicle = false;
  try {
    await call('POST', '/api/jobs', { vehicleSlug: 'not-a-real-car' });
  } catch {
    badVehicle = true;
  }
  check('unknown vehicle is rejected', badVehicle);

  let noCatalogue = false;
  try {
    const j = await call('POST', '/api/jobs', { vehicleSlug: 'toyota-prius-pkw74' });
    await call('POST', `/api/jobs/${j.id}/damage`, { partId: 'x', displayName: 'X' });
    await call('POST', `/api/jobs/${j.id}/oracle/predict`);
  } catch {
    noCatalogue = true;
  }
  check('oracle refuses a vehicle with no catalogue', noCatalogue);

  console.log(
    failures === 0
      ? '\n[32mAll checks passed.[0m'
      : `\n[31m${failures} check(s) failed.[0m`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\n[31mSmoke test crashed:[0m', error.message);
  process.exit(1);
});
