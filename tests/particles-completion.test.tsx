import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ellipseRuns } from '../src/core/particles/detect/manual';
import {
  initialParticleData,
  migrateParticleData,
  PARTICLE_STATE_VERSION,
  type ImageInfo,
  type Particle,
  type ParticleData,
  type PoolEntry,
} from '../src/modules/particles/data';
import { DistributionStep } from '../src/modules/particles/DistributionStep';
import { particleSession } from '../src/modules/particles/session';
import { collectShapes } from '../src/modules/particles/sizes';
import { UploadStep } from '../src/modules/particles/UploadStep';
import { particlesPart } from '../src/modules/report/particlesPart';

/* Sub-stage 19f: statistics on screen, shape distributions, histogram height, session file, report. */

const csv = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('../src/modules/xrd/csv', () => ({
  downloadCsv: (...args: unknown[]) => csv.calls.push(args),
}));

const imageState = vi.hoisted(() => ({ value: { status: 'none' } as Record<string, unknown> }));
vi.mock('../src/modules/particles/useImage', () => ({
  useImage: () => imageState.value,
  cacheImage: () => {},
  clearImageCache: () => {},
}));
vi.mock('../src/modules/particles/imageStore', () => ({
  saveImage: async () => {},
  removeImage: async () => {},
  loadStoredImage: async () => undefined,
}));
vi.mock('../src/modules/particles/decode', () => ({
  decodeImage: async () => ({
    ok: true,
    image: { width: 1000, height: 800, format: 'png', notes: [], workScale: 1, source: null },
  }),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  csv.calls.length = 0;
  imageState.value = { status: 'none' };
});

const image: ImageInfo = {
  id: 'img',
  name: 'sample-a.png',
  width: 1000,
  height: 800,
  format: 'png',
  synthetic: false,
  notes: [],
  bytes: 3,
  // SHA-256 of the three bytes 1, 2, 3.
  sha256: '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
};

function discs(diameters: number[]): Particle[] {
  return diameters.map((d, i) => ({
    id: i + 1,
    source: 'auto',
    runs: ellipseRuns(60 + 90 * (i % 10), 60 + 90 * Math.floor(i / 10), d / 2, d / 2, 1000, 800),
  }));
}

const scaled = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, length: 50, unit: 'nm' as const };
const many = Array.from({ length: 12 }, (_, i) => 30 + 4 * i);
const withParticles = (diameters: number[], patch: Partial<ParticleData> = {}): ParticleData => ({
  ...initialParticleData,
  image,
  scale: scaled,
  detect: { ...initialParticleData.detect, particles: discs(diameters), nextParticleId: 99 },
  ...patch,
});

function setup(start: ParticleData) {
  let data = start;
  const view = render(<DistributionStep data={data} update={() => {}} />);
  const update = (patch: Partial<ParticleData>) => {
    data = { ...data, ...patch };
    view.rerender(<DistributionStep data={data} update={update} />);
  };
  view.rerender(<DistributionStep data={data} update={update} />);
  return { get: () => data };
}

describe('saved sessions of version 6', () => {
  const v6Pool = {
    id: 'p',
    name: 'old.png',
    unit: 'nm',
    equalArea: [1],
    longest: [1],
    shortest: [1],
  };
  const v6Image: Partial<ImageInfo> = { ...image };
  delete v6Image.bytes;
  delete v6Image.sha256;
  const v6Distribution: Partial<ParticleData['distribution']> = {
    ...initialParticleData.distribution,
  };
  delete v6Distribution.shape;
  const v6 = {
    step: 4,
    furthest: 4,
    data: { ...initialParticleData, image: v6Image, pool: [v6Pool], distribution: v6Distribution },
  };

  it('gain an unknown file fingerprint, pooled entries without shapes and the shape choice', () => {
    const upgraded = migrateParticleData(v6, 6);
    expect(upgraded?.step).toBe(4);
    expect(upgraded?.data.image).toMatchObject({ bytes: null, sha256: null });
    expect(upgraded?.data.pool[0]).toMatchObject({
      aspectRatio: null,
      circularity: null,
      solidity: null,
    });
    expect(upgraded?.data.distribution.shape).toBe('aspectRatio');
  });

  it('open as a session file of version 6', () => {
    // Take the app id from a file this codec wrote, then give it the version 6 state.
    const file = JSON.parse(particleSession.serialise(v6 as never)) as Record<string, unknown>;
    const parsed = particleSession.parse(JSON.stringify({ ...file, version: 6, state: v6 }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.state.data.pool[0]?.solidity).toBeNull();
  });
});

describe('particle session file', () => {
  const data = withParticles(many, { measurements: [] });

  it('round-trips the particles as Int32Array runs and keeps the fingerprint', () => {
    const text = particleSession.serialise({ step: 4, furthest: 4, data });
    expect(text).toContain('"$i32"');
    const parsed = particleSession.parse(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const back = parsed.state.data;
    expect(back.detect.particles).toHaveLength(12);
    const runs = back.detect.particles[0]?.runs;
    expect(runs).toBeInstanceOf(Int32Array);
    expect(Array.from(runs ?? [])).toEqual(Array.from(data.detect.particles[0]?.runs ?? []));
    expect(back.image?.sha256).toBe(image.sha256);
    expect(back.scale).toEqual(scaled);
    expect(JSON.parse(text).version).toBe(PARTICLE_STATE_VERSION);
  });

  it('refuses a damaged outline and a file of another tool', () => {
    const text = particleSession.serialise({ step: 4, furthest: 4, data });
    const damaged = text.replace(/"\$i32":\[(\d+),/, '"$i32":[');
    const parsed = particleSession.parse(damaged);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/particle outline/);
    const other = particleSession.parse(text.replace('"particles-session"', '"ftir-session"'));
    expect(other.ok).toBe(false);
  });

  it('gives the distribution and report without the image', () => {
    const part = particlesPart(data);
    expect(part?.tool).toBe('Particle size (SEM/TEM)');
    const lines = part?.results.flatMap((r) => r.lines).join('\n') ?? '';
    expect(lines).toMatch(/12 particles from 1 image/);
    expect(lines).toMatch(/95 % confidence interval of the mean/);
    expect(lines).toMatch(/D\[3,2\] \(Sauter\)/);
    expect(lines).toMatch(/Dv50/);
    expect(part?.results.map((r) => r.title).join(' ')).toMatch(/assuming spheres/);
    expect(part?.methods).toMatch(/D\[4,3\]/);
    expect(particlesPart(initialParticleData)).toBeNull();
  });
});

describe('distribution step, 19f additions', () => {
  it('shows the further statistics with their weighting, and A² for both fits', () => {
    setup(withParticles(many));
    expect(screen.getByText('95 % confidence interval of the mean')).toBeTruthy();
    expect(screen.getByText('D[3,2], Sauter mean')).toBeTruthy();
    expect(screen.getAllByText('volume (assumes spheres)').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^A² .*consistent$/).length).toBe(2);
    const methods = (screen.getByLabelText('Methods paragraph') as HTMLTextAreaElement).value;
    expect(methods).toMatch(/number-based mean/);
    expect(methods).toMatch(/Treating each particle as a sphere/);
    expect(methods).toMatch(/Anderson–Darling/);
  });

  it('writes the weighting of every number into the summary CSV', () => {
    setup(withParticles(many));
    fireEvent.click(screen.getByRole('button', { name: 'Summary (CSV)' }));
    const [, note, rows, columns] = csv.calls[0] as [
      string,
      string,
      [string, number, string, string][],
      { header: string }[],
    ];
    expect(columns.map((c) => c.header)).toEqual(['Quantity', 'Value', 'Unit', 'Weighting']);
    expect(note).toMatch(/sphere/);
    const byName = new Map(rows.map((r) => [r[0], r]));
    expect(byName.get('D[4,3] (De Brouckere mean)')?.[3]).toBe('volume, assumes spheres');
    expect(byName.get('Mean')?.[3]).toBe('number');
    expect(byName.get('Normal fit: Anderson-Darling A2')).toBeTruthy();
  });

  it('shows shape distributions of the detected particles', () => {
    const { get } = setup(withParticles(many));
    expect(screen.getByRole('heading', { name: /Shape distributions/ })).toBeTruthy();
    const table = screen.getByRole('region', { name: 'Shape numbers, scrolls sideways' });
    expect(table.textContent).toMatch(/Aspect ratio/);
    expect(table.textContent).toMatch(/Solidity/);
    fireEvent.change(screen.getByRole('combobox', { name: 'Histogram of' }), {
      target: { value: 'circularity' },
    });
    expect(get().distribution.shape).toBe('circularity');
    fireEvent.click(screen.getByRole('button', { name: 'Shape summary (CSV)' }));
    expect(String(csv.calls[0]?.[1])).toMatch(/about 0.9/);
  });

  it('lets the exported histogram have a free height', () => {
    setup(withParticles(many));
    const height = screen.getAllByLabelText('Height (mm)')[0] as HTMLInputElement;
    expect(height.value).toBe('65');
    fireEvent.change(height, { target: { value: '120' } });
    expect(screen.getAllByText(/85 × 120 mm/).length).toBeGreaterThan(0);
    fireEvent.change(height, { target: { value: '5' } });
    expect((screen.getAllByLabelText('Height (mm)')[0] as HTMLInputElement).value).toBe('30');
  });

  it('offers the session file', () => {
    setup(withParticles(many));
    expect(screen.getByRole('button', { name: 'Download session (JSON)' })).toBeTruthy();
    expect(screen.getByText(/not the image itself/)).toBeTruthy();
  });
});

describe('shape numbers', () => {
  it('pool images saved before version 7 are named, discs read as round', () => {
    const old: PoolEntry = {
      id: 'o',
      name: 'old.png',
      unit: 'nm',
      equalArea: [1],
      longest: [1],
      shortest: [1],
      aspectRatio: null,
      circularity: null,
      solidity: null,
    };
    const data = withParticles([40, 60, 80], { pool: [old] });
    const aspect = collectShapes(data, 'aspectRatio');
    expect(aspect.missing).toEqual(['old.png']);
    expect(aspect.values).toHaveLength(3);
    for (const v of aspect.values) expect(v).toBeLessThan(1.1);
    for (const v of collectShapes(data, 'solidity').values) expect(v).toBeGreaterThan(0.95);
    for (const v of collectShapes(data, 'circularity').values) {
      expect(v).toBeGreaterThan(0.8);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('loading the image of an opened session', () => {
  const sessionData = withParticles(many);

  function renderUpload() {
    let data = sessionData;
    const update = vi.fn((patch: Partial<ParticleData>) => {
      data = { ...data, ...patch };
    });
    render(<UploadStep data={data} update={update} />);
    return { update, get: () => data };
  }

  const choose = (bytes: number[]) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array(bytes)], 'sample-a.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
  };

  it('puts the particles back on the same file and keeps the work', async () => {
    imageState.value = { status: 'error', error: 'not stored' };
    const confirm = vi.spyOn(window, 'confirm');
    const { update, get } = renderUpload();
    expect(screen.getByText(/Image needed:/)).toBeTruthy();
    choose([1, 2, 3]);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
    expect(get().detect.particles).toHaveLength(12);
    expect(get().scale).toEqual(scaled);
    expect(get().image?.id).not.toBe('img');
    confirm.mockRestore();
  });

  it('says plainly when a different file is loaded, and keeps the work if refused', async () => {
    imageState.value = { status: 'error', error: 'not stored' };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { update } = renderUpload();
    choose([9, 9, 9]);
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(String(confirm.mock.calls[0]?.[0])).toMatch(
      /not the image the session was made with \(sample-a.png\): the file contents differ/,
    );
    expect(update).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
