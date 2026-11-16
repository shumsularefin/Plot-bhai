import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BandGapRequest, BandGapResponse } from '../../workers/bandgap.worker';
import { runBandGapJob, type BandGapAnalysis, type BandGapJob } from './bandGap';

/*
 * The band gap analysis runs in a web worker (src/workers/bandgap.worker.ts): on a spectrum of
 * 50,000 points it takes seconds (heavy work must never block the main thread).
 * Results are kept by the content of their inputs, so the Band gap step, the Results step, its
 * figures and the analysis record share them. One job runs at a time; a job nobody waits for any
 * more (the user moved on) is dropped before it starts. Where workers do not exist (unit tests in
 * jsdom), the analysis runs on this thread and the hook returns at once, as before.
 */

/** Analyses kept, newest last (each holds a few curves of the spectrum's length). */
const CACHE_SIZE = 24;
const cache = new Map<string, BandGapAnalysis>();

/** FNV-1a over the bits of the numbers, two 32-bit hashes with different seeds. */
function hashArrays(arrays: readonly Float64Array[]): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const array of arrays) {
    const words = new Uint32Array(array.buffer, array.byteOffset, array.length * 2);
    for (let i = 0; i < words.length; i++) {
      const w = words[i] as number;
      a = Math.imul(a ^ w, 0x01000193);
      b = Math.imul(b ^ w, 0x5bd1e995);
    }
    a = Math.imul(a ^ array.length, 0x01000193);
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}

/** A key that changes whenever any input of the job changes. */
export function jobKey(job: BandGapJob): string {
  const curves = (c: BandGapJob['component']) =>
    c ? [c.cleaned.wavelengthNm, c.cleaned.values] : [];
  return JSON.stringify([
    job.spectrum.kind,
    job.spectrum.scale,
    job.choice,
    [job.component, job.reflectance].map(
      (c) => c && [c.spectrum.id, c.spectrum.name, c.spectrum.kind, c.spectrum.scale],
    ),
    hashArrays([
      job.cleaned.wavelengthNm,
      job.cleaned.values,
      ...curves(job.component),
      ...curves(job.reflectance),
    ]),
  ]);
}

function remember(key: string, analysis: BandGapAnalysis): void {
  cache.delete(key);
  cache.set(key, analysis);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
}

type Listener = (result: { analysis: BandGapAnalysis } | { error: string }) => void;

interface Entry {
  job: BandGapJob;
  listeners: Set<Listener>;
  /** The request id once posted to the worker. */
  id: number | null;
}

const entries = new Map<string, Entry>();
let worker: Worker | undefined;
let nextId = 1;
let running: string | null = null;

const workersExist = () => typeof Worker !== 'undefined';

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../../workers/bandgap.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({ data }: MessageEvent<BandGapResponse>) => {
      const key = running;
      const entry = key === null ? undefined : entries.get(key);
      if (key === null || !entry || entry.id !== data.id) return;
      finish(key, data.analysis ? { analysis: data.analysis } : { error: data.error });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker?.terminate();
      worker = undefined;
      if (running !== null) finish(running, { error: event.message || 'the worker stopped' });
    };
  }
  return worker;
}

function finish(key: string, result: Parameters<Listener>[0]): void {
  const entry = entries.get(key);
  entries.delete(key);
  running = null;
  if ('analysis' in result) remember(key, result.analysis);
  for (const listener of entry?.listeners ?? []) listener(result);
  startNext();
}

function startNext(): void {
  if (running !== null) return;
  for (const [key, entry] of entries) {
    if (entry.listeners.size === 0) {
      entries.delete(key);
      continue;
    }
    running = key;
    entry.id = nextId++;
    getWorker().postMessage({ id: entry.id, job: entry.job } satisfies BandGapRequest);
    return;
  }
}

/** Asks for the analysis of a job; the listener is called once with the result. */
function request(key: string, job: BandGapJob, listener: Listener): void {
  const entry = entries.get(key) ?? { job, listeners: new Set(), id: null };
  entry.listeners.add(listener);
  entries.set(key, entry);
  startNext();
}

/** Withdraws a listener; a job left without any is dropped if it has not started. */
function release(key: string, listener: Listener): void {
  entries.get(key)?.listeners.delete(listener);
}

/** The analyses of the jobs, in the worker where there is one. */
export async function analyseJobs(jobs: readonly BandGapJob[]): Promise<BandGapAnalysis[]> {
  if (!workersExist()) return jobs.map(runBandGapJob);
  return Promise.all(
    jobs.map((job) => {
      const key = jobKey(job);
      const known = cache.get(key);
      if (known) return known;
      return new Promise<BandGapAnalysis>((resolve, reject) =>
        request(key, job, (r) =>
          'analysis' in r ? resolve(r.analysis) : reject(new Error(r.error)),
        ),
      );
    }),
  );
}

export interface BandGapState {
  /** The analyses of the jobs, in order, or null until they are all done. */
  analyses: BandGapAnalysis[] | null;
  /** The analyses of the last jobs with the same `keepKey`, shown while the new ones run. */
  previous: BandGapAnalysis[] | null;
  /** Why the analysis failed, or null. */
  error: string | null;
}

/**
 * The analyses of the jobs, done in the worker. While they run, `analyses` is null and
 * `previous` holds the last complete result for the same `keepKey` (for example the same
 * spectrum while its fit region is dragged), so the page does not jump.
 */
export function useBandGaps(jobs: readonly BandGapJob[], keepKey = ''): BandGapState {
  // Keys by content: callers may pass equal jobs as new objects on every render.
  const joined = useMemo(() => jobs.map(jobKey).join('\u0000'), [jobs]);
  const keys = useMemo(() => (joined ? joined.split('\u0000') : []), [joined]);
  // Results that arrived for this component, so that none is lost if the cache evicts it.
  const own = useRef(new Map<string, BandGapAnalysis>());
  const kept = useRef<{ keepKey: string; analyses: BandGapAnalysis[] } | null>(null);
  const [arrived, setArrived] = useState(0);
  const [error, setError] = useState<{ keys: string[]; message: string } | null>(null);

  const analyses = useMemo(() => {
    if (!workersExist()) return jobs.map(runBandGapJob);
    const found = keys.map((k) => own.current.get(k) ?? cache.get(k));
    return found.every((a) => a !== undefined) ? (found as BandGapAnalysis[]) : null;
    // `arrived` counts the results stored in `own`, which the memo reads.
  }, [jobs, keys, arrived]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const k of own.current.keys()) if (!keys.includes(k)) own.current.delete(k);
    if (analyses) return;
    const listeners = keys.map((key): Listener => (r) => {
      if ('error' in r) {
        setError({ keys, message: r.error });
        return;
      }
      own.current.set(key, r.analysis);
      setArrived((n) => n + 1);
    });
    keys.forEach((key, i) => {
      if (!own.current.has(key) && !cache.has(key))
        request(key, jobs[i] as BandGapJob, listeners[i] as Listener);
    });
    return () => keys.forEach((key, i) => release(key, listeners[i] as Listener));
    // `jobs` changes only together with `keys`.
  }, [keys, analyses]); // eslint-disable-line react-hooks/exhaustive-deps

  if (analyses) kept.current = { keepKey, analyses };
  return {
    analyses,
    previous: !analyses && kept.current?.keepKey === keepKey ? kept.current.analyses : null,
    error: error && error.keys === keys ? error.message : null,
  };
}
