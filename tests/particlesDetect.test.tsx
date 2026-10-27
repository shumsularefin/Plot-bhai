import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ellipseRuns } from '../src/core/particles/detect/manual';
import { runsArea } from '../src/core/particles/detect/regions';
import {
  initialParticleData,
  type ImageInfo,
  type ParticleData,
} from '../src/modules/particles/data';
import { DetectStep } from '../src/modules/particles/DetectStep';

const image: ImageInfo = {
  id: 'img',
  name: 'example.png',
  width: 1024,
  height: 864,
  format: 'png',
  synthetic: true,
  notes: [],
};

// jsdom has no canvas and no workers: the image decodes to a stub, and detection returns three discs.
vi.mock('../src/modules/particles/useImage', () => ({
  useImage: (info: ImageInfo | null) =>
    info
      ? {
          status: 'ready',
          image: {
            source: { width: info.width, height: info.height },
            width: info.width,
            height: info.height,
            workScale: 1,
            format: 'png',
            notes: [],
          },
        }
      : { status: 'none' },
  cacheImage: () => {},
  clearImageCache: () => {},
}));
vi.mock('../src/modules/particles/grayImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/modules/particles/grayImage')>()),
  grayOf: () => ({ gray: new Uint8Array(4), width: 2, height: 2 }),
  maskCanvas: () => document.createElement('canvas'),
}));
const detectCalls: unknown[] = [];
vi.mock('../src/modules/particles/detectClient', () => ({
  DetectClient: class {
    cancel() {}
    async detect(input: unknown) {
      detectCalls.push(input);
      return {
        particles: [
          ellipseRuns(100, 100, 20, 20, 1024, 864),
          ellipseRuns(300, 100, 40, 40, 1024, 864),
          ellipseRuns(500, 300, 10, 10, 1024, 864),
        ],
        threshold: 117,
        diameter:
          (input as { settings: { split: { method: string } } }).settings.split.method === 'clumps'
            ? 33
            : null,
      };
    }
    async mask() {
      return { mask: new Uint8Array(4), threshold: 117 };
    }
  },
}));

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function setup(start: Partial<ParticleData> = {}) {
  let data: ParticleData = { ...initialParticleData, image, ...start };
  const view = render(<DetectStep data={data} update={() => {}} />);
  const update = (patch: Partial<ParticleData>) => {
    data = { ...data, ...patch };
    view.rerender(<DetectStep data={data} update={update} />);
  };
  view.rerender(<DetectStep data={data} update={update} />);
  return { get: () => data };
}

/** Fills the four coordinate boxes (opened first) and presses the button. */
function enterLine([x1, y1, x2, y2]: number[]) {
  for (const [label, value] of [
    ['First point x (px)', x1],
    ['First point y (px)', y1],
    ['Second point x (px)', x2],
    ['Second point y (px)', y2],
  ] as const) {
    fireEvent.input(screen.getByLabelText(label), { target: { value: String(value) } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Add the line' }));
}

const calibrated: Partial<ParticleData> = {
  scale: { p1: { x: 0, y: 0 }, p2: { x: 200, y: 0 }, length: 100, unit: 'nm' },
};

async function detect(store: ReturnType<typeof setup>) {
  fireEvent.click(screen.getByRole('button', { name: 'Detect particles' }));
  await waitFor(() => expect(store.get().detect.particles).toHaveLength(3));
}

describe('detect step', () => {
  it('says to review the outlines and that detection works best on separated particles', () => {
    setup();
    expect(
      screen.getByText(
        /Automatic detection works best on well separated particles with good contrast/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Review the outlines/)).toBeTruthy();
  });

  it('detects, numbers the particles, reports the Otsu level and lists them', async () => {
    const store = setup();
    await detect(store);
    expect(store.get().detect.particles.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(store.get().detect.thresholdUsed).toBe(117);
    expect(screen.getByText(/Otsu chose grey level 117/)).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(1 + 3);
    expect(detectCalls.length).toBeGreaterThan(0);
  });

  it('passes the crop area on the working grid to the detector', async () => {
    const store = setup({ crop: { x: 0, y: 0, width: 1024, height: 768 } });
    await detect(store);
    expect(detectCalls[detectCalls.length - 1]).toMatchObject({
      area: { x: 0, y: 0, width: 1024, height: 768 },
    });
  });

  it('filters by diameter without deleting, and reports why particles are left out', async () => {
    const store = setup();
    await detect(store);
    fireEvent.input(screen.getByLabelText('Smallest diameter'), { target: { value: '30' } });
    expect(store.get().detect.filters.minDiameter).toBe(30);
    expect(store.get().detect.particles).toHaveLength(3);
    const status = screen.getByText(/particles shown/).closest('p')?.textContent ?? '';
    expect(status).toContain('2 of 3 particles shown');
    expect(status).toContain('1 too small');
  });

  it('merges two selected particles into one new ID, and undo brings them back', async () => {
    const store = setup();
    await detect(store);
    expect(
      (screen.getByRole('button', { name: /Merge selected/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByLabelText('Select particle 1'));
    fireEvent.click(screen.getByLabelText('Select particle 2'));
    fireEvent.click(screen.getByRole('button', { name: /Merge selected/ }));
    const after = store.get().detect.particles;
    expect(after.map((p) => p.id).sort()).toEqual([3, 4]);
    expect(after.find((p) => p.id === 4)?.source).toBe('merged');
    expect(store.get().detect.edited).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo the last edit' }));
    expect(
      store
        .get()
        .detect.particles.map((p) => p.id)
        .sort(),
    ).toEqual([1, 2, 3]);
  });

  it('deletes the selected particles and never reuses their IDs', async () => {
    const store = setup();
    await detect(store);
    fireEvent.click(screen.getByLabelText('Select particle 2'));
    fireEvent.click(screen.getByRole('button', { name: /Delete selected \(1\)/ }));
    expect(store.get().detect.particles.map((p) => p.id)).toEqual([1, 3]);
    expect(store.get().detect.nextParticleId).toBe(4);
    expect(screen.queryByLabelText('Select particle 2')).toBeNull();
  });

  it('keeps the area of every particle in the saved state', async () => {
    const store = setup();
    await detect(store);
    const areas = store.get().detect.particles.map((p) => runsArea(p.runs));
    expect(areas[1]).toBeGreaterThan(areas[0] ?? 0);
  });

  it('tells the user when the settings changed after the last detection', async () => {
    const store = setup();
    await detect(store);
    expect(screen.queryByText(/changed since the last detection/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/The particles are darker than the background/));
    expect(store.get().detect.settings.invert).toBe(true);
    expect(await screen.findByText(/changed since the last detection/)).toBeTruthy();
  });

  it('shows the manual threshold slider and the adaptive settings for those methods', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Manual level'));
    expect(screen.getByRole('slider', { name: /Level/ })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Adaptive (uneven background)'));
    expect(screen.getByLabelText('Neighbourhood radius (px)')).toBeTruthy();
  });

  it('offers clumps: a typical diameter (from the last line drawn), the outline share, and reports the estimate', async () => {
    const store = setup();
    expect(screen.queryByLabelText('Typical particle diameter (px)')).toBeNull();
    fireEvent.click(screen.getByLabelText('In clumps or overlapping (agglomerates)'));
    expect(store.get().detect.settings.split.method).toBe('clumps');
    expect(screen.getByText('Empty: estimated from the image when you detect.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Use the last line drawn' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await detect(store);
    expect(store.get().detect.diameterUsed).toBe(33);
    expect(screen.getByText(/The last detection used 33 px/)).toBeTruthy();
    fireEvent.click(screen.getByText('Enter coordinates instead of drawing'));
    enterLine([100, 100, 100, 141]);
    fireEvent.click(screen.getByRole('button', { name: 'Use the last line drawn' }));
    expect(store.get().detect.settings.split.diameter).toBe(41);
    fireEvent.input(screen.getByRole('slider', { name: /of a whole, clear outline/ }), {
      target: { value: '12' },
    });
    expect(store.get().detect.settings.split.outlinePercent).toBe(12);
  });

  it('suggests clumps when one outline holds most of the particle area', async () => {
    const store = setup();
    await detect(store);
    expect(screen.getByText(/one outline holds 76 % of all particle area/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('In clumps or overlapping (agglomerates)'));
    expect(screen.queryByText(/one outline holds/)).toBeNull();
  });

  it('measures a line by hand in nm at 2 pixels per nm, next to the detected particles', () => {
    const store = setup(calibrated);
    fireEvent.click(screen.getByRole('button', { name: 'Add a line' }));
    expect(screen.getByText(/measure its diameter by hand/)).toBeTruthy();
    fireEvent.click(screen.getByText('Enter coordinates instead of drawing'));
    enterLine([300, 300, 400, 300]);
    expect(store.get().measurements).toEqual([
      { id: 1, kind: 'line', a: { x: 300, y: 300 }, b: { x: 400, y: 300 } },
    ]);
    fireEvent.change(screen.getByLabelText('Show sizes in'), { target: { value: 'nm' } });
    expect(screen.getByRole('row', { name: /Line/ }).textContent).toContain('50 nm');
  });

  it('never reuses a hand measurement ID, and the step undo takes lines back too', () => {
    const store = setup();
    fireEvent.click(screen.getByText('Enter coordinates instead of drawing'));
    enterLine([0, 0, 10, 0]);
    enterLine([0, 0, 20, 0]);
    fireEvent.click(screen.getByRole('button', { name: /Delete\s*measurement 1/ }));
    enterLine([0, 0, 30, 0]);
    expect(store.get().measurements.map((m) => m.id)).toEqual([2, 3]);
    expect(screen.getAllByRole('row', { name: /Line/ })[0]?.textContent).toContain('20 px');
    fireEvent.click(screen.getByRole('button', { name: 'Undo the last edit' }));
    expect(store.get().measurements.map((m) => m.id)).toEqual([2]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo the last edit' }));
    expect(store.get().measurements.map((m) => m.id)).toEqual([1, 2]);
  });

  it('still lists circles measured in older sessions', () => {
    setup({
      ...calibrated,
      measurements: [{ id: 4, kind: 'circle', a: { x: 300, y: 300 }, b: { x: 400, y: 300 } }],
    });
    fireEvent.change(screen.getByLabelText('Show sizes in'), { target: { value: 'nm' } });
    const row = screen.getByRole('row', { name: /Circle/ });
    expect(row.textContent).toContain('50 nm');
    // Area of a 50 nm circle: π · 50² / 4 = 1963.5 nm².
    expect(row.textContent).toContain('1963');
  });

  it('selects every shown particle with Select all, and clears them again', async () => {
    const store = setup();
    await detect(store);
    fireEvent.click(screen.getByLabelText('Select all'));
    expect(screen.getByRole('button', { name: 'Delete selected (3)' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Select all'));
    expect(screen.getByRole('button', { name: 'Delete selected (0)' })).toBeTruthy();
  });
});
