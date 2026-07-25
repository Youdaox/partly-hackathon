/**
 * Fetch-on-mount with reload, loading and error state.
 *
 * Every screen in this app loads something from the API when it opens and reloads it
 * after a mutation. This hook is that pattern in one place, so screens stay short and
 * all handle failure the same way.
 *
 * ```ts
 * const jobs = useAsyncData(() => backend.getResults(caseId), [caseId]);
 * jobs.data; jobs.error; jobs.loading; await jobs.reload();
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { BackendError } from '@/lib/backend';

export interface AsyncData<T> {
  data: T | null;
  error: { title: string; detail?: string } | null;
  /** True until the first load settles. Reloads do not flip this back on. */
  loading: boolean;
  reload: () => Promise<void>;
  /** Replace the data locally, e.g. after a mutation returns the new value. */
  setData: (value: T | null) => void;
  /** Clear the error without refetching. */
  clearError: () => void;
}

export function toErrorInfo(error: unknown): { title: string; detail?: string } {
  if (error instanceof BackendError) {
    return { title: error.message, detail: error.detail };
  }
  return { title: error instanceof Error ? error.message : 'Something went wrong' };
}

export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList = [],
): AsyncData<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Callers pass an inline arrow (`() => api.getReport(id)`), which is a new function every
  // render. Holding it in a ref keeps `run` stable so it is safe to depend on.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  // Ignore results that arrive after the screen has moved on.
  const activeRef = useRef(true);
  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    try {
      const value = await fetcherRef.current();
      if (!activeRef.current) return;
      setData(value);
      setError(null);
    } catch (err) {
      if (!activeRef.current) return;
      setError(toErrorInfo(err));
    } finally {
      if (activeRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // `run` only touches state after its first await, so this cannot cascade renders.
    void run();
    // `deps` is the caller's dependency list, which ESLint cannot statically verify.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const clearError = useCallback(() => setError(null), []);

  return { data, error, loading, reload: run, setData, clearError };
}
