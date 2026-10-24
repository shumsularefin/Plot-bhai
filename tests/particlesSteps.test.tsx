import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  initialParticleData,
  type ImageInfo,
  type ParticleData,
} from '../src/modules/particles/data';
import { MeasureStep } from '../src/modules/particles/MeasureStep';
import { ScaleStep } from '../src/modules/particles/ScaleStep';
import { particleSteps } from '../src/modules/particles/steps';
import { UploadStep } from '../src/modules/particles/UploadStep';

// jsdom has no canvas: pretend the image decoded, so the steps around the viewer can be tested.
vi.mock('../src/modules/particles/useImage', () => ({
  useImage: (info: ImageInfo | null) =>
    info
      ? {
          status: 'ready',
          image: {
            source: {},
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

beforeAll(() => {
  // The viewer asks for a 2D context; without a canvas it simply draws nothing.
  HTMLCanvasElement.prototype.getContext = () => null;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const image: ImageInfo = {
  id: 'img',
  name: 'example.png',
  width: 1024,
  height: 864,
  format: 'png',
  synthetic: true,
  notes: [],
};

type Step = typeof UploadStep | typeof ScaleStep | typeof MeasureStep;

function setup(Step: Step, start: Partial<ParticleData> = {}) {
  let data: ParticleData = { ...initialParticleData, image, ...start };
  const view = render(<Step data={data} update={() => {}} />);
  const update = (patch: Partial<ParticleData>) => {
    data = { ...data, ...patch };
    view.rerender(<Step data={data} update={update} />);
  };
  view.rerender(<Step data={data} update={update} />);
  return { get: () => data };
}

/** Fills the four coordinate boxes (opened first) and presses the button. */
function enterCoordinates(button: string, [x1, y1, x2, y2]: number[]) {
  for (const [label, value] of [
    ['First point x (px)', x1],
    ['First point y (px)', y1],
    ['Second point x (px)', x2],
    ['Second point y (px)', y2],
  ] as const) {
    fireEvent.input(screen.getByLabelText(label), { target: { value: String(value) } });
  }
  fireEvent.click(screen.getByRole('button', { name: button }));
}

describe('particle wizard', () => {
  it('asks for an image before step 2 and then lets the user go on', () => {
    const upload = particleSteps[0];
    expect(upload?.validate?.(initialParticleData)).toContain('Load an image');
    expect(upload?.validate?.({ ...initialParticleData, image })).toBeNull();
    expect(particleSteps.map((s) => s.title)).toEqual([
      'Upload',
      'Crop and scale',
      'Measure',
      'Distribution and export',
    ]);
  });

  it('offers the example image and says it is synthetic', () => {
    setup(UploadStep, { image: null });
    expect(screen.getByRole('button', { name: 'Try with example data' })).toBeTruthy();
    expect(screen.getByText(/not a real micrograph/)).toBeTruthy();
  });
});

describe('scale and crop step', () => {
  it('sets the scale from the example bar and reports pixels per nm', () => {
    const store = setup(ScaleStep);
    fireEvent.click(screen.getByRole('button', { name: /Use the example's scale bar/ }));
    expect(store.get().scale?.length).toBe(100);
    expect(screen.getByText(/2 pixels per nm/)).toBeTruthy();
    expect(screen.getByText(/one pixel is/)).toBeTruthy();
  });

  it('takes a typed scale bar and its length, converting micrometres', () => {
    const store = setup(ScaleStep);
    fireEvent.click(screen.getByText('Enter coordinates instead of drawing'));
    enterCoordinates('Set the scale bar', [100, 700, 600, 700]);
    expect(store.get().scale?.p2).toEqual({ x: 600, y: 700 });
    expect(screen.getByText(/Type the length of the bar/)).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Length of the bar'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'um' } });
    expect(store.get().scale).toMatchObject({ length: 1, unit: 'um' });
    // 500 px for 1 µm: 500 pixels per µm, 2 nm per pixel.
    expect(screen.getByText(/500 pixels per µm/)).toBeTruthy();
    expect(screen.getByText(/one pixel is/).textContent).toContain('2 nm');
  });

  it('warns about a very short scale bar and refuses points outside the image', () => {
    setup(ScaleStep);
    fireEvent.click(screen.getByText('Enter coordinates instead of drawing'));
    enterCoordinates('Set the scale bar', [10, 10, 30, 10]);
    expect(screen.getByText(/only 20 pixels long/)).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Second point x (px)'), { target: { value: '5000' } });
    expect(
      (screen.getByRole('button', { name: 'Set the scale bar' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('crops a strip off the bottom and goes back to the whole image', () => {
    const store = setup(ScaleStep);
    fireEvent.input(screen.getByLabelText(/Remove a strip from the bottom/), {
      target: { value: '96' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(store.get().crop).toEqual({ x: 0, y: 0, width: 1024, height: 768 });
    expect(screen.getByText(/1024 × 768 pixels/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use the whole image' }));
    expect(store.get().crop).toBeNull();
  });
});

describe('measure step', () => {
  const calibrated: Partial<ParticleData> = {
    scale: { p1: { x: 0, y: 0 }, p2: { x: 200, y: 0 }, length: 100, unit: 'nm' },
  };

  it('measures a typed circle in nm at 2 pixels per nm', () => {
    const store = setup(MeasureStep, calibrated);
    fireEvent.click(screen.getByText('Enter coordinates instead of drawing'));
    enterCoordinates('Add the measurement', [300, 300, 400, 300]);
    expect(store.get().measurements).toHaveLength(1);
    const row = screen.getByRole('row', { name: /Circle/ });
    expect(row.textContent).toContain('50 nm');
    // Area of a 50 nm circle: π · 50² / 4 = 1963.5 nm².
    expect(row.textContent).toContain('1963');
  });

  it('measures an ellipse box with its short axis and aspect ratio', () => {
    setup(MeasureStep, calibrated);
    fireEvent.click(screen.getByText('Enter coordinates instead of drawing'));
    fireEvent.change(screen.getByLabelText('Shape'), { target: { value: 'ellipse' } });
    enterCoordinates('Add the measurement', [100, 100, 200, 160]);
    const row = screen.getByRole('row', { name: /Ellipse/ });
    expect(row.textContent).toContain('50 nm');
    expect(row.textContent).toContain('30 nm');
    expect(row.textContent).toContain('1.667');
  });

  it('never reuses an ID, and undo and delete work', () => {
    const store = setup(MeasureStep, calibrated);
    fireEvent.click(screen.getByText('Enter coordinates instead of drawing'));
    enterCoordinates('Add the measurement', [0, 0, 10, 0]);
    enterCoordinates('Add the measurement', [0, 0, 20, 0]);
    fireEvent.click(screen.getByRole('button', { name: /Delete\s*measurement 1/ }));
    enterCoordinates('Add the measurement', [0, 0, 30, 0]);
    expect(store.get().measurements.map((m) => m.id)).toEqual([2, 3]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo the last' }));
    expect(store.get().measurements.map((m) => m.id)).toEqual([2]);
  });

  it('shows pixels and a warning when there is no scale', () => {
    setup(MeasureStep);
    expect(screen.getByText(/No scale yet/)).toBeTruthy();
    fireEvent.click(screen.getByText('Enter coordinates instead of drawing'));
    enterCoordinates('Add the measurement', [0, 0, 30, 40]);
    expect(screen.getByRole('row', { name: /Circle/ }).textContent).toContain('50 px');
  });
});
