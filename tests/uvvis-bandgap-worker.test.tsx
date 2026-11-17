import { act, renderHook, waitFor } from '@testing-library/preact';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bandEdgeAbsorbance } from '../src/core/uvvis/synthetic';
import { runBandGapJob, type BandGapJob } from '../src/modules/uvvis/bandGap';
import { analyseJobs, jobKey, useBandGaps } from '../src/modules/uvvis/bandGapClient';
import { DEFAULT_BAND_GAP } from '../src/modules/uvvis/data';

// The band gap analysis in a web worker (src/workers/bandgap.worker.ts, bandGapClient.ts).
// jsdom has no Worker, so a stand-in runs the real worker module on this thread, a message at a
// time, with structured cloning as between threads.

type Scope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
};
const scope: Scope = { onmessage: null, postMessage: () => {} };
const posted: unknown[] = [];

class StandInWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor() {
    scope.postMessage = (message) =>
      setTimeout(() => this.onmessage?.({ data: structuredClone(message) }), 0);
  }
  postMessage(message: unknown) {
    posted.push(message);
    setTimeout(() => scope.onmessage?.({ data: structuredClone(message) }), 0);
  }
  terminate() {}
}

beforeAll(async () => {
  vi.stubGlobal('self', scope);
  await import('../src/workers/bandgap.worker');
  vi.unstubAllGlobals();
  vi.stubGlobal('Worker', StandInWorker);
});
afterAll(() => vi.unstubAllGlobals());

const { wavelengthNm, values } = bandEdgeAbsorbance({
  startNm: 250,
  endNm: 600,
  stepNm: 1,
  bandGapEv: 3.2,
  baseline: 0.05,
  noiseSeed: 4,
  noiseSd: 0.002,
});
const job = (patch: Partial<BandGapJob['choice']> = {}): BandGapJob => ({
  spectrum: { kind: 'absorbance', scale: 'fraction' },
  cleaned: { wavelengthNm, values },
  choice: { ...DEFAULT_BAND_GAP, ...patch },
  component: null,
  reflectance: null,
});

describe('band gap worker', () => {
  it('gives the same analysis as on this thread', async () => {
    const [inWorker] = await analyseJobs([job()]);
    const here = runBandGapJob(job());
    expect(inWorker?.fit).toEqual(here.fit);
    expect(inWorker?.method).toBe(here.method);
    // Compared as plain arrays: the clone is a Float64Array of another realm in jsdom.
    expect(Array.from(inWorker?.tauc ?? [])).toEqual(Array.from(here.tauc));
    expect(inWorker?.comparison).toEqual(here.comparison);
    expect(Math.abs((inWorker?.fit?.egEv ?? 0) - 3.2)).toBeLessThan(0.02);
  });

  it('keys jobs by content, not by object', () => {
    expect(jobKey(job())).toBe(
      jobKey({ ...job(), cleaned: { wavelengthNm, values: values.slice() } }),
    );
    const changed = values.slice();
    changed[100] = (changed[100] as number) + 1e-12;
    expect(jobKey({ ...job(), cleaned: { wavelengthNm, values: changed } })).not.toBe(
      jobKey(job()),
    );
    expect(jobKey(job({ thicknessNm: 300 }))).not.toBe(jobKey(job()));
  });

  it('shows nothing, then the result, and keeps the last one while new settings run', async () => {
    const first = [job({ thicknessNm: 100 })];
    const { result, rerender } = renderHook(({ jobs }) => useBandGaps(jobs, 'one'), {
      initialProps: { jobs: first },
    });
    expect(result.current.analyses).toBeNull();
    expect(result.current.previous).toBeNull();
    await waitFor(() => expect(result.current.analyses).not.toBeNull());
    const shown = result.current.analyses?.[0];
    expect(shown?.fit).toEqual(runBandGapJob(first[0] as BandGapJob).fit);

    rerender({ jobs: [job({ thicknessNm: 200 })] });
    expect(result.current.analyses).toBeNull();
    expect(result.current.previous?.[0]).toBe(shown);
    await waitFor(() => expect(result.current.analyses).not.toBeNull());
    expect(result.current.analyses?.[0]?.fit).toEqual(runBandGapJob(job({ thicknessNm: 200 })).fit);
  });

  it('drops a job that nobody waits for before it starts', async () => {
    posted.length = 0;
    const { result, rerender } = renderHook(({ jobs }) => useBandGaps(jobs), {
      initialProps: { jobs: [job({ thicknessNm: 400 })] },
    });
    // The first job is running; the second is queued and then replaced by the third.
    act(() => rerender({ jobs: [job({ thicknessNm: 500 })] }));
    act(() => rerender({ jobs: [job({ thicknessNm: 600 })] }));
    await waitFor(() => expect(result.current.analyses).not.toBeNull());
    const thicknesses = posted.map((m) => (m as { job: BandGapJob }).job.choice.thicknessNm);
    expect(thicknesses).toEqual([400, 600]);
    expect(result.current.analyses?.[0]?.fit).toEqual(runBandGapJob(job({ thicknessNm: 600 })).fit);
  });

  it('runs on this thread where there are no workers, with no waiting', () => {
    vi.stubGlobal('Worker', undefined);
    try {
      const { result } = renderHook(() => useBandGaps([job({ thicknessNm: 700 })]));
      expect(result.current.analyses?.[0]?.fit).toEqual(
        runBandGapJob(job({ thicknessNm: 700 })).fit,
      );
    } finally {
      vi.stubGlobal('Worker', StandInWorker);
    }
  });
});
