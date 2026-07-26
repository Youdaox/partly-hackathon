'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Search } from 'lucide-react';
import type { AllowedVehicle, Vehicle } from '@partli/shared';

import { Button } from '@/components/ui/button';
import { ApiError, client, waitForVehicle } from '@/lib/client';
import { cn } from '@/lib/utils';

/**
 * Screen 1. One question: which vehicle?
 *
 * Deliberately the whole viewport and nothing else. The pitch turns on the
 * order of events — the vehicle's exact parts and how they connect come out of
 * the VIN, *before* a photo exists — and that only lands if the rego is the
 * first and only thing on screen.
 *
 * The VIN lookup is a real wait (the backend simulates 0.8-2.6s), so it is
 * shown as a search in progress rather than hidden behind a spinner, and its
 * result arrives a line at a time: VIN, then the vehicle, then the catalogue.
 * Each line is a separate claim and reads better as three beats than one dump.
 */

type Phase = 'idle' | 'searching' | 'found';

/** How long each revealed line waits before the next appears. */
const REVEAL_STEP_MS = 420;

interface RegoScreenProps {
  /** Called once the catalogue is loaded and a case is open. */
  onReady: (vehicle: Vehicle, caseId: string) => void;
}

export function RegoScreen({ onReady }: RegoScreenProps) {
  const [rego, setRego] = useState('');
  const [allowed, setAllowed] = useState<AllowedVehicle[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchingPlate, setSearchingPlate] = useState('');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    client.allowedVehicles().then(setAllowed).catch(() => setAllowed([]));
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const lookUp = async (plate: string) => {
    const trimmed = plate.trim().toUpperCase();
    if (!trimmed) return;

    setError(null);
    setSearchingPlate(trimmed);
    setPhase('searching');

    try {
      const registered = await client.registerVehicle(trimmed);
      const resolved = await waitForVehicle(registered.vehicle_id);
      if (resolved.status !== 'catalogue_ready') {
        throw new ApiError(409, 'That vehicle resolved without a parts catalogue.');
      }

      const opened = await client.createCase(resolved.vehicle_id);
      setVehicle(resolved);
      setPhase('found');

      // Let the three result lines land before the screen changes, so the
      // provenance is read rather than flashed.
      timers.current.push(
        setTimeout(() => onReady(resolved, opened.case_id), REVEAL_STEP_MS * 3 + 700),
      );
    } catch (caught) {
      setPhase('idle');
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <div className="animate-screen-in">
        <p className="text-lg font-medium text-primary">Partli</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Enter your rego</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Enter the registration to pull the vehicle&rsquo;s exact OEM parts — and how
          every one of them connects to the next.
        </p>

        {phase === 'idle' ? (
          <form
            className="mt-8"
            onSubmit={(event) => {
              event.preventDefault();
              void lookUp(rego);
            }}
          >
            <input
              value={rego}
              onChange={(event) => setRego(event.target.value.toUpperCase())}
              placeholder="QMN16"
              aria-label="Registration"
              autoFocus
              className="h-16 w-full rounded-xl border bg-background px-5 text-center font-mono text-3xl tracking-[0.2em] uppercase placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" size="lg" className="mt-3 w-full" disabled={!rego.trim()}>
              <Search /> Look up vehicle
            </Button>

            {error ? (
              <div
                role="alert"
                className="animate-flow-in mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
              >
                <p className="text-sm font-medium text-destructive">{error}</p>
              </div>
            ) : null}

            {allowed.length > 0 ? (
              <div className="mt-8">
                <p className="text-xs text-muted-foreground">
                  Vehicles with a full OEM catalogue:
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {allowed.map((option) => (
                    <button
                      key={option.rego}
                      type="button"
                      onClick={() => {
                        setRego(option.rego);
                        void lookUp(option.rego);
                      }}
                      className="rounded-full border px-3 py-1.5 text-xs transition-colors hover:border-primary"
                    >
                      <span className="font-mono">{option.rego}</span>{' '}
                      <span className="text-muted-foreground">
                        {option.make} {option.model}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </form>
        ) : (
          <VinSearch plate={searchingPlate} vehicle={phase === 'found' ? vehicle : null} />
        )}
      </div>
    </main>
  );
}

/** The lookup itself: a live search, then its result one line at a time. */
function VinSearch({ plate, vehicle }: { plate: string; vehicle: Vehicle | null }) {
  const searching = vehicle === null;

  return (
    <div className="mt-8">
      <div
        className={cn(
          'flex items-center gap-4 rounded-xl border px-5 py-4 transition-colors duration-500',
          searching ? 'border-primary/40 bg-primary/5' : 'border-success/40 bg-success/5',
        )}
      >
        {searching ? (
          <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden />
        ) : (
          <Check className="size-5 shrink-0 text-success" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="font-mono text-lg tracking-[0.2em]">{plate}</p>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {searching ? 'Searching for VIN…' : 'VIN found'}
          </p>
        </div>
      </div>

      {vehicle ? (
        <dl className="mt-5 space-y-3">
          <Revealed delay={0} label="VIN">
            <span className="font-mono text-sm">{vehicle.vin ?? 'not on file'}</span>
          </Revealed>
          <Revealed delay={REVEAL_STEP_MS} label="Vehicle">
            {vehicle.make} {vehicle.model} {vehicle.year}
          </Revealed>
          <Revealed delay={REVEAL_STEP_MS * 2} label="OEM catalogue">
            {vehicle.parts_indexed.toLocaleString()} parts
            {vehicle.edges_indexed
              ? ` · ${vehicle.edges_indexed.toLocaleString()} connections indexed`
              : ''}
          </Revealed>
        </dl>
      ) : (
        <p className="mt-5 text-xs text-muted-foreground">
          Resolving the plate to a VIN, then loading that exact vehicle&rsquo;s parts…
        </p>
      )}
    </div>
  );
}

function Revealed({
  delay,
  label,
  children,
}: {
  delay: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="animate-flow-in flex items-baseline justify-between gap-4 border-b pb-3"
      style={{ animationDelay: `${delay}ms` }}
    >
      <dt className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 text-right text-sm font-medium">{children}</dd>
    </div>
  );
}
