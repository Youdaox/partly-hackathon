/**
 * Cases opened on this device, newest first.
 *
 * The prediction backend has no list-cases endpoint — `GET /case/{id}` fetches one, and
 * the store is in-memory with a 24 h TTL — so the RECENT drawer cannot ask the server what
 * exists. It remembers what this device started instead.
 *
 * In-memory, so it does not survive an app restart. That is a deliberate floor rather than
 * a design: persisting it needs `expo-sqlite` or async storage, neither of which is a
 * dependency yet, and a wrong-looking list is worse than a short one. Swap `entries` for a
 * persisted store and the drawer needs no change.
 */

export interface RecentCase {
  caseId: string;
  vehicleId: string;
  /** Shown as the row title. Filled in once the vehicle resolves. */
  label: string;
  /** What the repairer typed, shown as the row subtitle. */
  said?: string;
  openedAt: string;
}

const MAX = 20;

let entries: RecentCase[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listRecentCases(): RecentCase[] {
  return entries;
}

export function rememberCase(entry: Omit<RecentCase, 'openedAt'>): void {
  entries = [
    { ...entry, openedAt: new Date().toISOString() },
    ...entries.filter((e) => e.caseId !== entry.caseId),
  ].slice(0, MAX);
  emit();
}

/** Fill in the vehicle name once Track A resolves, so the row stops saying the rego. */
export function labelCase(caseId: string, label: string): void {
  let changed = false;
  entries = entries.map((entry) => {
    if (entry.caseId !== caseId || entry.label === label) return entry;
    changed = true;
    return { ...entry, label };
  });
  if (changed) emit();
}
