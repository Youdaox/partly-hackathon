'use client';

import { useState } from 'react';
import type { Vehicle } from '@partli/shared';

import { AnalysisScreen } from './analysis-screen';
import { RegoScreen } from './rego-screen';

/**
 * Two screens, and the handover between them.
 *
 * They are separate components rather than two branches of one page on
 * purpose: screen 1 is calm, centred and asks one question; screen 2 is a
 * working view. Keeping them apart is what stops the second one growing back
 * into a sidebar and a stack of cards around the first.
 *
 * Everything screen 2 needs — the resolved vehicle and an open case — is
 * settled before it mounts, so it never renders a half-known vehicle.
 */

interface Resolved {
  vehicle: Vehicle;
  caseId: string;
}

export function Flow() {
  const [resolved, setResolved] = useState<Resolved | null>(null);

  if (resolved === null) {
    return (
      <RegoScreen
        onReady={(vehicle, caseId) => setResolved({ vehicle, caseId })}
      />
    );
  }

  return <AnalysisScreen vehicle={resolved.vehicle} caseId={resolved.caseId} />;
}
