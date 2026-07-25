#!/usr/bin/env node
/**
 * End-to-end smoke test against a running backend.
 *
 * Walks the whole repairer journey the way the mobile app does — register a
 * plate, wait for VIN resolution, open a case, talk to it, confirm a part, quote
 * it, approve it — then checks the failure paths.
 *
 *   node scripts/smoke.mjs                       # against http://localhost:8080
 *   node scripts/smoke.mjs http://10.0.0.5:8080  # against a LAN address
 */

const BASE = process.argv[2] ?? process.env.API_BASE_URL ?? 'http://localhost:8080';
const V1 = `${BASE}/v1`;

const REGO = process.env.REGO ?? 'QMN16';
const NO_CATALOGUE_REGO = 'NUE975';

let passed = 0;
let failed = 0;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ${green('✓')} ${label}`);
  } else {
    failed++;
    console.log(`  ${red('✗')} ${label}${detail ? dim(` — ${detail}`) : ''}`);
  }
}

async function call(method, path, body) {
  const response = await fetch(`${V1}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(parsed?.error?.message ?? `${method} ${path} → ${response.status}`);
    error.status = response.status;
    error.code = parsed?.error?.code;
    throw error;
  }
  return parsed;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Register a plate and wait out the simulated VIN latency, as the app does. */
async function startCase(rego) {
  const registered = await call('POST', '/vehicle/register', { rego });
  let vehicle = await call('GET', `/vehicle/${registered.vehicle_id}`);
  const deadline = Date.now() + 15_000;
  while (vehicle.status === 'resolving' && Date.now() < deadline) {
    await sleep(250);
    vehicle = await call('GET', `/vehicle/${registered.vehicle_id}`);
  }
  const created = await call('POST', '/case', { vehicle_id: vehicle.vehicle_id });
  return { caseId: created.case_id, vehicle };
}

async function expectError(label, code, fn) {
  try {
    await fn();
    check(label, false, 'expected an error, got success');
  } catch (error) {
    check(label, error.code === code, `got ${error.code ?? error.message}`);
  }
}

async function main() {
  console.log(`\nSmoke test against ${BASE}\n`);

  console.log('health');
  const health = await fetch(`${BASE}/healthz`).then((r) => r.json());
  check('catalogues preloaded at boot', health.vehicles_loaded >= 1, JSON.stringify(health));
  check('parts indexed', health.parts_indexed > 7000, `${health.parts_indexed}`);

  console.log('\nvehicles');
  const { vehicles } = await call('GET', '/vehicles');
  check('vehicle index is served', vehicles.length >= 8, `${vehicles.length} vehicles`);
  check(
    'some vehicles have a prediction but no catalogue',
    vehicles.some((v) => v.has_prediction && !v.has_catalogue),
  );

  console.log('\ncase');
  const { caseId, vehicle } = await startCase(REGO);
  check('rego resolves to a VIN', vehicle.vin === 'JTDKBAA3301006094', vehicle.vin);
  check('catalogue is ready', vehicle.status === 'catalogue_ready', vehicle.status);
  check('parts indexed for this vehicle', vehicle.parts_indexed === 7009, `${vehicle.parts_indexed}`);

  let report = await call('GET', `/prediction/results/${caseId}`);
  check('the first report is already populated', report.sections.visible.length > 0);
  check('a report has all three sections', Object.keys(report.sections).length === 3);
  check('check is capped at 5', report.sections.check.length <= 5);
  check('payload is under 20 KB', JSON.stringify(report).length < 20480);

  console.log('\nevidence');
  await call('POST', `/case/${caseId}/messages`, {
    text: "front right's taken a hit, the reo is bent",
  });
  report = await call('GET', `/prediction/results/${caseId}`);
  check('speech sets the side', report.impact.side === 'R', report.impact.side);
  check('a bent reo reads as structural', report.impact.severity >= 4, `${report.impact.severity}`);

  const msg = await call('POST', `/case/${caseId}/messages`, { text: 'not sure about the rail' });
  report = await call('GET', `/prediction/results/${caseId}`);
  check(
    'an unsure mention becomes the question',
    report.question?.id === 'q_raised_side_member',
    report.question?.id,
  );

  const edited = await call('PATCH', `/case/${caseId}/messages/${msg.message_id}`, {
    text: 'not sure about the grille',
  });
  check(
    'editing a transcript re-runs extraction',
    edited.question?.id === 'q_raised_grille',
    edited.question?.id,
  );

  console.log('\nconfirm loop');
  report = await call('GET', `/prediction/results/${caseId}`);
  if (report.sections.check.length > 0) {
    const target = report.sections.check[0];
    const started = Date.now();
    const after = await call('POST', '/inspection/confirm', {
      case_id: caseId,
      part_id: target.part_id,
      damaged: true,
    });
    const elapsed = Date.now() - started;
    check(`confirm round trip under 150 ms (${elapsed} ms)`, elapsed < 150, `${elapsed} ms`);
    check(
      'confirming promotes the part to visible',
      after.sections.visible.some((l) => l.part_id === target.part_id),
    );

    const denied = await call('POST', '/inspection/confirm', {
      case_id: caseId,
      part_id: target.part_id,
      damaged: false,
    });
    const everywhere = Object.values(denied.sections).flat();
    check('ruling a part out removes it', !everywhere.some((l) => l.part_id === target.part_id));
  } else {
    check('check section had something to confirm', false, 'nothing in `check`');
  }

  console.log('\nparts');
  const recommendations = await call('GET', `/parts/recommendations?case_id=${caseId}`);
  check('offers are labelled simulated', recommendations.simulated === true);
  check(
    'exactly one offer per line is recommended',
    recommendations.lines.every((l) => l.offers.filter((o) => o.recommended).length === 1),
  );

  console.log('\napproval');
  const sent = await call('POST', `/case/${caseId}/send-to-customer`);
  check('an approval link is issued', Boolean(sent.token) && sent.approval_url.endsWith(sent.token));
  check('the link is not the case id', sent.token !== caseId);

  const approval = await call('GET', `/approve/${sent.token}`);
  check('the quote loads for the customer', approval.lines.length > 0);
  check('totals are present', approval.totals.cheapest_nzd > 0);

  const optionId = approval.lines[0].options[0].id;
  const approved = await call('POST', `/approve/${sent.token}`, { option_id: optionId });
  check('the customer can approve', approved.approved_option === optionId);
  check('the case moves to approved', approved.status === 'approved');

  const { cases } = await call('GET', '/cases');
  check(
    'the front desk sees it',
    cases.some((c) => c.case_id === caseId && c.approval_token),
  );

  console.log('\nfailures');
  await expectError('unknown rego 404s', 'rego_not_found', () =>
    call('POST', '/vehicle/register', { rego: 'ZZZ999' }),
  );
  await expectError('unknown case 404s', 'case_not_found', () =>
    call('GET', '/prediction/results/case_nope'),
  );
  await expectError('a bad approval token 404s', 'case_not_found', () =>
    call('GET', '/approve/not-a-real-token'),
  );

  const degraded = await startCase(NO_CATALOGUE_REGO);
  check(
    'a make-plate-only vehicle still opens a case',
    degraded.vehicle.status === 'no_catalogue',
    degraded.vehicle.status,
  );
  await expectError('...but cannot be quoted', 'catalogue_unavailable', () =>
    call('POST', `/case/${degraded.caseId}/send-to-customer`),
  );

  console.log(
    `\n${failed === 0 ? green('all good') : red(`${failed} failed`)} — ` +
      `${passed} passed, ${failed} failed\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\n${red('smoke test could not run')}: ${error.message}`);
  console.error(dim(`Is the backend running? ${BASE}/healthz`));
  process.exit(1);
});
