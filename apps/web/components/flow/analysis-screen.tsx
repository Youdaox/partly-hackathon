'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ImagePlus, Loader2 } from 'lucide-react';
import type { DamageReport, MediaAsset, Vehicle } from '@partli/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError, client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { CheckList, HiddenColumn, VisibleColumn } from './parts';

/**
 * Screen 2. The photos go in and the damage comes out.
 *
 * Adding photos starts the analysis on its own — a separate "now analyse them"
 * button made the interpreter feel like a thing you operate rather than a
 * thing that runs. What the user sees is the interpreter reading their photos:
 * a scanline over the thumbnails and the stages naming themselves as they
 * pass.
 *
 * Under the hood the uploads are recorded and nothing more; the damage read is
 * Partly's precomputed interpreter output for this vehicle (see
 * `backend/app/ai/vision_vlm.py`, which ignores the frames by design). The
 * staged reveal is honest about *what* is happening — visible damage first,
 * then the propagation over the catalogue — while not pretending the
 * uploaded bytes are what produced it.
 */

type Phase = 'waiting' | 'analysing' | 'report';

/** The beats, in the order they genuinely happen. */
const BEATS = [
  { id: 'upload', label: 'Storing photos against the case' },
  { id: 'interpreter', label: 'Partly interpreter: reading the photos' },
  { id: 'visible', label: 'Visible damage identified' },
  { id: 'engine', label: 'Our engine: propagating through the parts graph' },
] as const;

const BEAT_MS = 620;

interface AnalysisScreenProps {
  vehicle: Vehicle;
  caseId: string;
}

export function AnalysisScreen({ vehicle, caseId }: AnalysisScreenProps) {
  const [phase, setPhase] = useState<Phase>('waiting');
  const [beat, setBeat] = useState(-1);
  const [previews, setPreviews] = useState<string[]>([]);
  const [uploaded, setUploaded] = useState<MediaAsset[]>([]);
  const [report, setReport] = useState<DamageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busyPartId, setBusyPartId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach(URL.revokeObjectURL);
  }, []);

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Upload, then walk the beats while the real calls run behind them. */
  const analyse = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setPhase('analysing');
      setBeat(0);

      const urls = files.map((file) => URL.createObjectURL(file));
      objectUrls.current.push(...urls);
      setPreviews((current) => [...current, ...urls]);

      try {
        await client.uploadPhotos(caseId, files);
        setUploaded(await client.listPhotos(caseId));

        setBeat(1);
        await wait(BEAT_MS);
        await client.runPrediction(caseId);

        setBeat(2);
        await wait(BEAT_MS);
        const fresh = await client.getReport(caseId);

        setBeat(3);
        await wait(BEAT_MS);
        setReport(fresh);
        setPhase('report');
      } catch (caught) {
        setPhase('waiting');
        setBeat(-1);
        setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      }
    },
    [caseId],
  );

  const addFiles = useCallback(
    (incoming: FileList | null) => {
      if (!incoming) return;
      const images = Array.from(incoming).filter((file) => file.type.startsWith('image/'));
      if (images.length > 0) void analyse(images);
    },
    [analyse],
  );

  const confirmPart = useCallback(
    async (partId: string, damaged: boolean) => {
      setBusyPartId(partId);
      try {
        setReport(await client.confirmPart(caseId, partId, damaged));
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      } finally {
        setBusyPartId(null);
      }
    },
    [caseId],
  );

  const answerQuestion = useCallback(
    async (questionId: string, value: string) => {
      setBusy(true);
      try {
        setReport(await client.answerQuestion(caseId, questionId, value));
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      } finally {
        setBusy(false);
      }
    },
    [caseId],
  );

  return (
    <main className="animate-screen-in mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
      {/* The vehicle, confirmed but subordinate — it was settled on screen 1. */}
      <header className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-4">
        <Check className="size-4 shrink-0 text-success" aria-hidden />
        <span className="font-medium">
          {vehicle.make} {vehicle.model} {vehicle.year}
        </span>
        <span className="font-mono text-sm text-muted-foreground">{vehicle.rego}</span>
        <span className="text-xs text-muted-foreground">
          catalogue loaded · {vehicle.parts_indexed.toLocaleString()} parts
          {vehicle.edges_indexed
            ? ` · ${vehicle.edges_indexed.toLocaleString()} connections`
            : ''}
        </span>
      </header>

      {/* One input for the whole screen: the dropzone and the "add more"
          footer are mutually exclusive, but sharing a ref between two mounted
          elements is a trap waiting for whoever renders both. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => addFiles(event.target.files)}
      />

      <h1 className="text-2xl font-semibold tracking-tight">Live damage analysis</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Add the crash photos. Partly&rsquo;s interpreter reads what can be seen; our engine
        walks the parts graph for what is behind it.
      </p>

      {error ? (
        <div
          role="alert"
          className="animate-flow-in mt-5 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
        >
          <p className="text-sm font-medium text-destructive">{error}</p>
        </div>
      ) : null}

      {/* --- dropzone / analysis / thumbnails ------------------------------- */}
      {phase === 'waiting' ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
          className={cn(
            'mt-6 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          <ImagePlus className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-lg font-medium">Drag the crash photos here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Analysis starts as soon as they land.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-5"
            onClick={() => fileInput.current?.click()}
          >
            Choose files
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 md:grid-cols-[auto_1fr]">
          <Thumbnails
            previews={previews}
            uploaded={uploaded}
            scanning={phase === 'analysing'}
          />
          <Beats current={beat} done={phase === 'report'} />
        </div>
      )}

      {/* --- the answer ----------------------------------------------------- */}
      {phase === 'report' && report ? (
        <div className="animate-flow-in mt-10">
          {report.question ? (
            <Card className="mb-6 border-primary/40">
              <CardContent className="p-4">
                <p className="text-sm font-medium">{report.question.text}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {report.question.options.map((option) => (
                    <Button
                      key={option}
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void answerQuestion(report.question!.id, option)}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="grid gap-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <VisibleColumn lines={report.sections.visible} />
            <HiddenColumn
              lines={report.sections.order}
              onConfirm={(partId, damaged) => void confirmPart(partId, damaged)}
              busyPartId={busyPartId}
            />
          </div>

          <CheckList lines={report.sections.check} />

          <footer className="mt-10 flex flex-wrap items-center gap-3 border-t pt-4 text-xs text-muted-foreground">
            <span>
              {report.hidden_count ?? 0} more scored below the threshold, from{' '}
              {(report.candidates ?? 0).toLocaleString()} candidates in{' '}
              {report.computed_ms ?? 0} ms
            </span>
            <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
              Add more photos
            </Button>
          </footer>
        </div>
      ) : null}
    </main>
  );
}

/** The photos, with a scanline over them while they are being read. */
function Thumbnails({
  previews,
  uploaded,
  scanning,
}: {
  previews: string[];
  uploaded: MediaAsset[];
  scanning: boolean;
}) {
  return (
    <div className="flex flex-wrap content-start gap-2 md:max-w-64">
      {previews.map((url, index) => (
        <div
          key={url}
          className="relative size-24 overflow-hidden rounded-lg border"
          style={{ animationDelay: `${index * 90}ms` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="size-full object-cover" />
          {scanning ? (
            <>
              <div className="absolute inset-0 bg-primary/10" />
              <div className="animate-scan absolute inset-x-0 h-6 bg-linear-to-b from-transparent via-primary/50 to-transparent" />
            </>
          ) : null}
        </div>
      ))}
      {uploaded.length > 0 && !scanning ? (
        <p className="w-full text-[11px] text-muted-foreground">
          {uploaded.length} stored · {uploaded.map((a) => a.filename).join(', ')}
        </p>
      ) : null}
    </div>
  );
}

/** What is happening, named as it happens. */
function Beats({ current, done }: { current: number; done: boolean }) {
  return (
    <ol className="space-y-3" aria-live="polite">
      {BEATS.map((item, index) => {
        const state = done || index < current ? 'done' : index === current ? 'active' : 'idle';
        return (
          <li key={item.id} className="flex items-center gap-3">
            {state === 'active' ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
            ) : state === 'done' ? (
              <Check className="size-4 shrink-0 text-success" aria-hidden />
            ) : (
              <span
                className="size-4 shrink-0 rounded-full border border-muted-foreground/30"
                aria-hidden
              />
            )}
            <span
              className={cn(
                'text-sm transition-colors',
                state === 'idle' && 'text-muted-foreground/50',
                state === 'active' && 'font-medium',
              )}
            >
              {item.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
