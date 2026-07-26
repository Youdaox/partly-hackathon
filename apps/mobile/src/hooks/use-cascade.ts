/**
 * What the last answer or confirmation did to everything else.
 *
 * The cascade is the whole proof — tell the model one part is fine, or which corner took the
 * hit, and the parts behind it move — but the arithmetic is undramatic on its own. Two things
 * make it easy to miss, and this hook exists for both:
 *
 * 1. **Movement is small.** A dependent falls five to twenty points, and only one or two
 *    cross a bucket threshold. So each report is diffed against the one before it and the
 *    rows that moved carry their own before/after.
 *
 * 2. **The biggest change is not movement at all.** Answering the side question flips the
 *    impact from right to left, and the list *swaps* parts: six leave, six arrive, and almost
 *    nothing in between moves. Diffing probabilities alone reported "nothing changed" on the
 *    single interaction that changes the most, so arrivals and departures are tracked too.
 */

import { useEffect, useRef, useState } from 'react';

import type { CaseReport } from '@/lib/backend';

/** How much a probability must move before it is worth pointing at. */
const EPSILON = 0.005;

/** How long a moved row stays marked before the screen goes quiet again. */
const HIGHLIGHT_MS = 6000;

export interface Change {
  from: number;
  to: number;
}

export interface Cascade {
  /** part_id -> what its probability was and is. */
  changes: Map<string, Change>;
  /** Parts that were not in the previous report at all. */
  arrived: Set<string>;
  /** How many parts left the report entirely. */
  departed: number;
  /** True while there is anything to point at. */
  active: boolean;
}

export function useCascade(report: CaseReport | null | undefined): Cascade {
  const previous = useRef<Map<string, number> | null>(null);
  const [changes, setChanges] = useState<Map<string, Change>>(new Map());
  const [arrived, setArrived] = useState<Set<string>>(new Set());
  const [departed, setDeparted] = useState(0);

  useEffect(() => {
    if (!report) return;

    const now = new Map<string, number>();
    for (const section of Object.values(report.sections ?? {})) {
      for (const line of section) now.set(line.part_id, line.p);
    }

    const before = previous.current;
    previous.current = now;

    // The first report has nothing to be a change from.
    if (!before) return;

    const moved = new Map<string, Change>();
    for (const [partId, to] of now) {
      const from = before.get(partId);
      if (from != null && Math.abs(to - from) >= EPSILON) moved.set(partId, { from, to });
    }
    const fresh = new Set([...now.keys()].filter((partId) => !before.has(partId)));
    const gone = [...before.keys()].filter((partId) => !now.has(partId)).length;

    setChanges(moved);
    setArrived(fresh);
    setDeparted(gone);
    if (moved.size === 0 && fresh.size === 0 && gone === 0) return;

    const timer = setTimeout(() => {
      setChanges(new Map());
      setArrived(new Set());
      setDeparted(0);
    }, HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [report]);

  return {
    changes,
    arrived,
    departed,
    active: changes.size > 0 || arrived.size > 0 || departed > 0,
  };
}
