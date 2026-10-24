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
});
