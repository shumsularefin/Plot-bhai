import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  initialParticleData,
  type ImageInfo,
  type ParticleData,
} from '../src/modules/particles/data';
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

type Step = typeof UploadStep | typeof ScaleStep;

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
      'Detect particles',
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
