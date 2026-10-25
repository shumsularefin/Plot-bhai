import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_SETTINGS, renderSvgString } from '../src/ui/plot/export';
import {
  DEFAULT_FIGURE,
  dashArray,
  labelKey,
  newAnnotation,
  resolveFigure,
  styledLabels,
  styledPeakLabels,
  styledSeries,
  styledYDomain,
  type FigureStyle,
} from '../src/ui/plot/figure';
import { pdfFromRgb } from '../src/ui/plot/pdf';
import { PlotPanel, type PlotSettings } from '../src/ui/plot/PlotPanel';
import type { PlotSeries } from '../src/ui/plot/types';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const x = Float64Array.from({ length: 101 }, (_, i) => 20 + 0.1 * i);
const curve = (centre: number, height: number) =>
  x.map((v) => 10 + height * Math.exp(-(((v - centre) / 0.5) ** 2)));
const series = (id: string, y: Float64Array, colorIndex: number): PlotSeries => ({
  id,
  name: id,
  x,
  y,
  readoutY: y,
  readoutUnit: 'counts',
  colorIndex,
});
const data = series('data', curve(25, 100), 0);
const fit = series('fit', curve(25, 90), 1);
const labels = { x: '2θ (°)', y: 'Intensity (a.u.)' };
const figure = (patch: Partial<FigureStyle>): FigureStyle => ({ ...DEFAULT_FIGURE, ...patch });
const svgOf = (f: FigureStyle | undefined, peakLabels?: Parameters<typeof renderSvgString>[6]) =>
  renderSvgString(
    [data, fit],
    [20, 30],
    labels,
    DEFAULT_EXPORT_SETTINGS,
    undefined,
    undefined,
    peakLabels,
    undefined,
    undefined,
    undefined,
    f,
  );

describe('figure style helpers', () => {
  it('fill in defaults for styles saved by older versions', () => {
    const r = resolveFigure({ axes: { grid: 'both' } as never });
    expect(r.axes.grid).toBe('both');
    expect(r.axes.ticks).toBe('in');
    expect(r.legend.show).toBe(true);
    expect(resolveFigure(undefined)).toBe(DEFAULT_FIGURE);
  });

  it('hide series, rename them, override titles and y limits, and edit peak labels', () => {
    const f = figure({
      series: { fit: { hidden: true }, data: { label: 'Sample A' } },
      axes: { ...DEFAULT_FIGURE.axes, yTitle: 'Counts', yValues: 'show', yMin: 0, yMax: 500 },
      peakLabels: { show: true, text: { [labelKey(25)]: '(101)*', [labelKey(26)]: '' } },
    });
    expect(styledSeries([data, fit], f).map((s) => s.name)).toEqual(['Sample A']);
    expect(styledLabels(labels, f)).toEqual({ x: '2θ (°)', y: 'Counts', yValues: true });
    expect(styledYDomain([3, 7], f)).toEqual([0, 500]);
    const set = {
      labels: [
        { x: 25, y: 1, text: '(101)' },
        { x: 26, y: 1, text: '(200)' },
      ],
      key: [],
    };
    expect(styledPeakLabels(set, f)?.labels).toEqual([{ x: 25, y: 1, text: '(101)*' }]);
    expect(
      styledPeakLabels(set, figure({ peakLabels: { show: false, text: {} } })),
    ).toBeUndefined();
  });

  it('give each line style its dash pattern', () => {
    expect(dashArray('solid', 1)).toBeUndefined();
    expect(dashArray('dashed', 2)).toBe('8 6');
    expect(dashArray('dotted', 1)?.split(' ')).toHaveLength(2);
    expect(dashArray('dash-dot', 1)?.split(' ')).toHaveLength(4);
  });
});

describe('exported figure with styling', () => {
  it('draws the chosen colour, width, dash, fill and opacity', () => {
    const svg = svgOf(
      figure({
        series: {
          data: { color: '#ff0000', width: 2, dash: 'dash-dot', fill: 'below', fillOpacity: 0.3 },
          fit: { fill: { between: 'data' }, opacity: 0.5 },
        },
      }),
    );
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke-dasharray="10 5 0.02 5"');
    expect(svg).toContain('fill-opacity="0.3"');
    expect(svg).toMatch(/opacity: ?0.5/);
    // Two fills: one under the data, one between the fit and the data.
    expect(svg.match(/Z" fill=/g)).toHaveLength(2);
  });

  it('draws text, arrows, markers, reference lines and regions where they were put', () => {
    const f = figure({
      annotations: [
        { ...newAnnotation('text', 22, 50), text: 'Sample note' },
        { ...newAnnotation('arrow', 25, 110, { x: 27, y: 120 }), text: 'main peak' },
        newAnnotation('marker', 24, 60),
        { ...newAnnotation('vline', 28, 0), text: 'ref' },
        newAnnotation('hline', 0, 40),
        { ...newAnnotation('region', 21, 0, { x: 23, y: 0 }), color: '#00ff00' },
      ],
    });
    const svg = svgOf(f);
    for (const text of ['Sample note', 'main peak', 'ref']) expect(svg).toContain(`>${text}<`);
    expect(svg).toContain('<circle');
    expect(svg).toContain('fill="#00ff00" fill-opacity="0.15"');
    // Exported annotations are black and use the export font.
    expect(svg).toContain('fill="#000000"');
    expect(svg).toMatch(/font-family="Arial[^"]*"[^>]*>Sample note/);
  });

  it('honours grid, outward ticks, legend placement and hiding', () => {
    const plain = svgOf(undefined);
    const styled = svgOf(
      figure({
        axes: { ...DEFAULT_FIGURE.axes, grid: 'both', ticks: 'out' },
        legend: { show: true, position: 'top-left' },
      }),
    );
    expect(styled.length).toBeGreaterThan(plain.length);
    expect(styled).toContain('stroke="#cccccc"');
    expect(styled).toContain('text-anchor="start"');
    const hidden = svgOf(figure({ legend: { show: false, position: 'top-right' } }));
    expect(hidden).not.toContain('>fit<');
    expect(plain).toContain('>fit<');
  });

  it('applies edited peak-label text in the export', () => {
    const peakLabels = { labels: [{ x: 25, y: 110, text: '(101)' }], key: [] };
    const svg = svgOf(
      figure({ peakLabels: { show: true, text: { [labelKey(25)]: 'A(101)' } } }),
      peakLabels,
    );
    expect(svg).toContain('>A(101)<');
    expect(svg).not.toContain('>(101)<');
  });
});

describe('PDF file', () => {
  it('is a well-formed one-page PDF whose cross-reference offsets point at its objects', () => {
    const rgb = new Uint8Array(2 * 2 * 3).fill(255);
    const bytes = pdfFromRgb(rgb, 2, 2, 240.945, 184.252, false);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 240.945 184.252]');
    expect(text).toContain('/Width 2 /Height 2 /ColorSpace /DeviceRGB');
    const xref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...text.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(6);
    // Byte offsets: the latin1 decoding keeps one character per byte.
    offsets.forEach((o, i) => expect(text.slice(o, o + 7)).toBe(`${i + 1} 0 obj`));
  });
});

describe('figure editor on screen', () => {
  it('stores styling per plot in the plot settings, leaving the data alone', () => {
    let settings: PlotSettings = {
      normalise: false,
      offsetPercent: 0,
      export: DEFAULT_EXPORT_SETTINGS,
    };
    const sources = [{ id: 'data', name: 'data', x, y: curve(25, 100), unit: 'counts' }];
    const before = Float64Array.from(sources[0]?.y ?? []);
    const view = render(<div />);
    const draw = () =>
      view.rerender(
        <PlotPanel
          sources={sources}
          settings={settings}
          onSettingsChange={(patch) => {
            settings = { ...settings, ...patch };
            draw();
          }}
          labels={() => labels}
          xName="2θ"
          xUnit="°"
          exportName="sample-fit"
        />,
      );
    draw();
    fireEvent.click(screen.getByText(/Edit figure/));
    fireEvent.change(screen.getByLabelText('Style'), { target: { value: 'dotted' } });
    fireEvent.input(screen.getByLabelText('y-axis title'), { target: { value: 'Counts' } });
    expect(settings.figures?.['sample-fit']?.series?.['data']?.dash).toBe('dotted');
    expect(settings.figures?.['sample-fit']?.axes?.yTitle).toBe('Counts');
    fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
    expect(screen.getByText(/Click or tap the plot to place a text.*keep clicking/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(sources[0]?.y).toEqual(before);
    fireEvent.click(screen.getByRole('button', { name: 'Reset the figure styling' }));
    expect(settings.figures?.['sample-fit']).toEqual(DEFAULT_FIGURE);
  });
});

describe('figure height check', () => {
  it('asks for more height when lanes, a residual and a legend crowd out the plot', async () => {
    const { minimumHeightMm } = await import('../src/ui/plot/export');
    const bare = minimumHeightMm(DEFAULT_EXPORT_SETTINGS, {
      residual: false,
      lanes: 0,
      legendRows: 0,
      peakLabels: false,
    });
    const crowded = minimumHeightMm(DEFAULT_EXPORT_SETTINGS, {
      residual: true,
      lanes: 3,
      legendRows: 4,
      peakLabels: false,
    });
    // A bare plot fits the 65 mm default; three lanes, a residual and a 4-row legend do not.
    expect(bare).toBeLessThan(DEFAULT_EXPORT_SETTINGS.heightMm);
    expect(crowded).toBeGreaterThan(DEFAULT_EXPORT_SETTINGS.heightMm);
  });
});
