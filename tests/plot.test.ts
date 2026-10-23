import { describe, expect, it } from 'vitest';
import { niceTicks } from '../src/ui/plot/axes';
import { decimate, lowerBound, nearestIndex } from '../src/ui/plot/decimate';
import {
  DEFAULT_EXPORT_SETTINGS,
  fileStem,
  pixelSize,
  renderSvgString,
} from '../src/ui/plot/export';
import { PRINT_COLORS } from '../src/ui/plot/palette';
import { crc32, setPngDpi } from '../src/ui/plot/png';
import { prepareSeries, xExtent } from '../src/ui/plot/series';
import { clampDomain, zoomDomain } from '../src/ui/plot/view';
import tokens from '../src/ui/tokens.css?raw';

const range = (n: number, f: (i: number) => number) =>
  Float64Array.from({ length: n }, (_, i) => f(i));

describe('decimate', () => {
  it('keeps every point when there are few', () => {
    const x = range(10, (i) => i);
    const out = decimate(x, x, 2, 5, 100);
    expect(out.x).toEqual([1, 2, 3, 4, 5]);
  });

  it('reduces 50,000 points to about four per column and keeps every peak maximum', () => {
    const n = 50_000;
    const x = range(n, (i) => 10 + i * 0.0014);
    const y = range(n, (i) => (i === 31_234 ? 9999 : i % 7));
    const out = decimate(x, y, 10, 80, 1000);
    expect(out.x.length).toBeLessThanOrEqual(4 * 1000 + 2);
    expect(Math.max(...out.y)).toBe(9999);
    expect(Math.min(...out.y)).toBe(0);
    // Order is preserved.
    expect(out.x.every((v, i) => i === 0 || v > (out.x[i - 1] as number))).toBe(true);
  });

  it('finds positions by binary search', () => {
    const x = [1, 2, 4, 8];
    expect(lowerBound(x, 3)).toBe(2);
    expect(nearestIndex(x, 3.1)).toBe(2);
    expect(nearestIndex(x, 2.9)).toBe(1);
    expect(nearestIndex(x, 100)).toBe(3);
  });
});

describe('axes', () => {
  it('makes round ticks with just enough decimals', () => {
    expect(niceTicks(10, 80, 7).map((t) => t.label)).toEqual([
      '10',
      '20',
      '30',
      '40',
      '50',
      '60',
      '70',
      '80',
    ]);
    expect(niceTicks(31.2, 32.1, 4).map((t) => t.label)).toEqual([
      '31.2',
      '31.4',
      '31.6',
      '31.8',
      '32.0',
    ]);
    expect(niceTicks(-1, 1, 2).map((t) => t.label)).toEqual(['\u22121', '0', '1']);
  });
});

describe('prepareSeries', () => {
  const sources = [
    { id: 'a', name: 'A', x: range(3, (i) => i), y: Float64Array.of(1, 4, 2), unit: 'counts' },
    { id: 'b', name: 'B', x: range(3, (i) => i + 1), y: Float64Array.of(10, 20, 5), unit: 'cps' },
  ];

  it('normalises each series to its own maximum without touching the readout values', () => {
    const [a, b] = prepareSeries(sources, { normalise: true, offsetFraction: 0 });
    expect([...(a?.y ?? [])]).toEqual([0.25, 1, 0.5]);
    expect([...(b?.y ?? [])]).toEqual([0.5, 1, 0.25]);
    expect([...(b?.readoutY ?? [])]).toEqual([10, 20, 5]);
  });

  it('offsets later series upwards by a fraction of the tallest', () => {
    const [a, b] = prepareSeries(sources, { normalise: false, offsetFraction: 0.5 });
    expect([...(a?.y ?? [])]).toEqual([1, 4, 2]);
    expect([...(b?.y ?? [])]).toEqual([20, 30, 15]);
  });

  it('reports the overall x extent', () => {
    expect(xExtent(prepareSeries(sources, { normalise: false, offsetFraction: 0 }))).toEqual([
      0, 3,
    ]);
  });
});

describe('view', () => {
  it('keeps the view inside the data and above the minimum width', () => {
    expect(clampDomain([-5, 5], [0, 100], 1)).toEqual([0, 10]);
    expect(clampDomain([50, 50.1], [0, 100], 1)).toEqual([50, 51]);
    expect(clampDomain([-10, 200], [0, 100], 1)).toEqual([0, 100]);
  });

  it('zooms around an anchor', () => {
    expect(zoomDomain([0, 100], 2, 50)).toEqual([25, 75]);
    expect(zoomDomain([0, 100], 2, 0)).toEqual([0, 50]);
  });
});

describe('PNG resolution', () => {
  it('computes the standard PNG CRC-32', () => {
    // Every PNG ends with an IEND chunk whose CRC is AE 42 60 82.
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });

  it('inserts a pHYs chunk after IHDR with pixels per metre for the dpi', () => {
    const chunk = (type: string, data: number[]) => {
      const body = [...new TextEncoder().encode(type), ...data];
      const crc = crc32(Uint8Array.from(body));
      return [
        0,
        0,
        0,
        data.length,
        ...body,
        crc >>> 24,
        (crc >>> 16) & 255,
        (crc >>> 8) & 255,
        crc & 255,
      ];
    };
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    const png = Uint8Array.from([
      ...signature,
      ...chunk('IHDR', Array(13).fill(0)),
      ...chunk('IEND', []),
    ]);
    const out = setPngDpi(png, 300);
    const view = new DataView(out.buffer);
    const physAt = 8 + 25; // after the signature and the 25-byte IHDR chunk
    expect(String.fromCharCode(...out.subarray(physAt + 4, physAt + 8))).toBe('pHYs');
    // 300 / 0.0254 = 11811.02 pixels per metre.
    expect(view.getUint32(physAt + 8)).toBe(11811);
    expect(view.getUint32(physAt + 12)).toBe(11811);
    expect(out[physAt + 16]).toBe(1);
    expect(view.getUint32(physAt + 17)).toBe(crc32(out.subarray(physAt + 4, physAt + 17)));
    // Applying it twice replaces the chunk instead of adding a second one.
    expect(setPngDpi(out, 600).length).toBe(out.length);
  });

  it('sizes PNGs from millimetres and dpi', () => {
    expect(pixelSize({ widthMm: 85, heightMm: 65 }, 300)).toEqual({ width: 1004, height: 768 });
    expect(pixelSize({ widthMm: 180, heightMm: 100 }, 600)).toEqual({ width: 4252, height: 2362 });
  });
});

describe('palette', () => {
  it('matches the plot colour tokens in tokens.css', () => {
    const root = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('}'));
    const fromCss = [...root.matchAll(/--plot-\d:\s*(#[0-9a-f]{6})/g)].map((m) => m[1]);
    expect(fromCss).toEqual(PRINT_COLORS.slice(0, 7));
  });
});

describe('SVG export', () => {
  it('renders a standalone figure at the journal width with the chosen font', () => {
    const series = prepareSeries(
      [
        {
          id: 'a',
          name: 'Sample A',
          x: range(100, (i) => 20 + i * 0.1),
          y: range(100, (i) => i),
          unit: 'counts',
        },
        {
          id: 'b',
          name: 'Sample B',
          x: range(100, (i) => 20 + i * 0.1),
          y: range(100, (i) => 100 - i),
          unit: 'counts',
        },
      ],
      { normalise: false, offsetFraction: 0 },
    );
    const svg = renderSvgString(
      series,
      [20, 29.9],
      { x: '2θ (°)', y: 'Intensity (a.u.)' },
      {
        ...DEFAULT_EXPORT_SETTINGS,
        font: 'times',
      },
    );
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="85mm"');
    expect(svg).toContain('height="65mm"');
    expect(svg).toContain('Times New Roman');
    expect(svg).toContain('stroke="#0072b2"');
    expect(svg).toContain('stroke="#e69f00"');
    expect(svg).toContain('>Sample B<');
    expect(svg).not.toContain('class=');
  });

  it('makes safe file names', () => {
    expect(fileStem('ZnO / 500 °C')).toBe('ZnO-500-C');
    expect(fileStem('***')).toBe('plot');
  });
});
