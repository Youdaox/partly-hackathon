/**
 * The app opens on the rego.
 *
 * This used to be a set of links to the dashboard and the approval page. Both
 * still exist at their own URLs, but neither is what the product is: the first
 * thing anyone should see is the one field that starts a job, because the
 * order of the flow — rego, then the vehicle's real parts, then the photos —
 * is the argument the app is making.
 */

import type { Metadata } from 'next';

import { Flow } from '@/components/flow/flow';

export const metadata: Metadata = {
  title: 'Find hidden damage — Partli',
  description: 'Enter a registration to pull the vehicle’s exact OEM parts and predict the damage behind the panels.',
};

export default function Home() {
  return <Flow />;
}
