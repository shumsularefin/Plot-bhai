import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it } from 'vitest';
import { processSpectrum, DEFAULT_FTIR_PROCESSING, toAbsorbance } from '../src/core/ftir/process';
import { importFtirText } from '../src/core/ftir/import';
import { exampleSpectra, initialFtirData, newId, type FtirData } from '../src/modules/ftir/data';
import { peakLabelsFor, ftirSources } from '../src/modules/ftir/FtirPlot';
import { methodsText } from '../src/modules/ftir/methodsText';
import { PeaksStep } from '../src/modules/ftir/PeaksStep';
import { defaultQuantity, shownQuantity, valueIn } from '../src/modules/ftir/quantity';
import { ResultsStep } from '../src/modules/ftir/ResultsStep';
import { AssignStep } from '../src/modules/ftir/AssignStep';
import { UploadStep } from '../src/modules/ftir/UploadStep';
import type { FtirSpectrum } from '../src/core/ftir/types';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // jsdom has no layout; give the plots a width so they draw their axes.
  Element.prototype.getBoundingClientRect = function () {
    return {
      width: 600,
      height: 400,
      top: 0,
      left: 0,
      right: 600,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON() {},
    };
  };
});

/** A %T spectrum with two bands (minima) at 1600 and 1000 cm⁻¹. */
function percentTSpectrum(): FtirSpectrum {
  const wavenumber = Float64Array.from({ length: 1801 }, (_, i) => 400 + 2 * i);
  const absorbance = wavenumber.map(
    (w) =>
      0.05 + 0.6 * Math.exp(-(((w - 1600) / 20) ** 2)) + 0.3 * Math.exp(-(((w - 1000) / 25) ** 2)),
  );
  return {
    id: newId(),
    name: 'film',
    source: 'csv',
    wavenumber,
    values: absorbance.map((a) => 100 * 10 ** -a),
    kind: 'transmittance',
    scale: 'percent',
    kindOrigin: 'header',
    synthetic: false,
    notes: [],
  };
}

type Step = typeof UploadStep | typeof PeaksStep | typeof AssignStep | typeof ResultsStep;
function setup(Step: Step, start: Partial<FtirData> = {}) {
  let data: FtirData = { ...initialFtirData, ...start };
  const view = render(<Step data={data} update={() => {}} />);
  const update = (patch: Partial<FtirData>) => {
    data = { ...data, ...patch };
    view.rerender(<Step data={data} update={update} />);
  };
  view.rerender(<Step data={data} update={update} />);
  return { get: () => data, view };
}

/** The y-axis title of the first plot on screen. */
const yAxisTitle = (container: Element) =>
  [...container.querySelectorAll('svg text[transform]')].map((t) => t.textContent)[0];

describe('FTIR absorbance and transmittance conversion', () => {
  it('uses A = −log10(T), with %T divided by 100 first', () => {
    const t = Float64Array.of(100, 50, 10, 1);
    const a = toAbsorbance(t, 'transmittance', 'percent');
    expect(Array.from(a, (v) => Number(v.toFixed(6)))).toEqual([0, 0.30103, 1, 2]);
    const fraction = toAbsorbance(Float64Array.of(1, 0.5, 0.1), 'transmittance', 'fraction');
    expect(Array.from(fraction, (v) => Number(v.toFixed(6)))).toEqual([0, 0.30103, 1]);
    // Absorbance data are passed through untouched, never converted.
    const raw = Float64Array.of(0.2, 0.4);
    expect(toAbsorbance(raw, 'absorbance', 'percent')).toBe(raw);
  });

  it('converts back exactly, so a transmittance view shows the measured %T', () => {
    const s = percentTSpectrum();
    const p = processSpectrum(s, DEFAULT_FTIR_PROCESSING);
    const [shown] = ftirSources([{ id: 'a', name: 'a', ...p }], 'transmittance');
    if (!shown) throw new Error('missing');
    // Sources are reversed for the high-wavenumber-on-the-left axis.
    const back = Array.from(shown.y).reverse();
    back.forEach((v, i) => expect(v).toBeCloseTo(s.values[i] as number, 9));
    expect(shown.unit).toBe('%');
  });

  it('never changes the stored measurement', () => {
    const s = percentTSpectrum();
    const before = Float64Array.from(s.values);
    processSpectrum(s, {
      ...DEFAULT_FTIR_PROCESSING,
      baseline: { ...DEFAULT_FTIR_PROCESSING.baseline, enabled: true },
      smoothing: { ...DEFAULT_FTIR_PROCESSING.smoothing, enabled: true },
    });
    expect(s.values).toEqual(before);
  });
});

describe('FTIR display quantity', () => {
  it('defaults to transmittance only when every loaded spectrum is transmittance', () => {
    expect(defaultQuantity([percentTSpectrum()])).toBe('transmittance');
    expect(defaultQuantity(exampleSpectra())).toBe('absorbance');
    expect(defaultQuantity([])).toBe('absorbance');
  });

  it('shows absorbance, with a reason, only while a spectrum is normalised', () => {
    const s = percentTSpectrum();
    const data = { view: { quantity: 'transmittance' as const }, processing: {} };
    expect(shownQuantity(data, [s])).toEqual({ quantity: 'transmittance', reason: null });
    const normalised = {
      ...data,
      processing: {
        [s.id]: {
          ...DEFAULT_FTIR_PROCESSING,
          normalise: { enabled: true, method: 'max' as const },
        },
      },
    };
    const shown = shownQuantity(normalised, [s]);
    expect(shown.quantity).toBe('absorbance');
    expect(shown.reason).toContain('film is normalised');
  });

  it('puts peak labels under transmittance minima and above absorbance maxima', () => {
    const peaks = [{ wavenumber: 1600, height: 1, prominence: 1, relative: 100 }];
    expect(peakLabelsFor(peaks, 'absorbance')).toMatchObject({ labels: [{ y: 1 }] });
    expect(peakLabelsFor(peaks, 'absorbance').below).toBeUndefined();
    const t = peakLabelsFor(peaks, 'transmittance');
    expect(t.below).toBe(true);
    expect(t.labels[0]?.y).toBeCloseTo(10, 12);
    expect(valueIn('transmittance', 2)).toBeCloseTo(1, 12);
  });

  it('loads a %T file and shows it as transmittance from the first step', async () => {
    const rows = Array.from({ length: 400 }, (_, i) => {
      const w = 4000 - 9 * i;
      return `${w},${(90 - 40 * Math.exp(-(((w - 1700) / 30) ** 2))).toFixed(3)}`;
    });
    const text = `Wavenumber (cm-1),Sample (%T)\n${rows.join('\n')}`;
    const parsed = importFtirText('film.csv', text, 'csv');
    expect(parsed.ok ? parsed.spectra[0]?.kind : parsed.error).toBe('transmittance');
    const store = setup(UploadStep);
    fireEvent.click(screen.getByText('Paste data instead'));
    fireEvent.input(screen.getByLabelText(/Two columns/), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Load pasted data' }));
    await screen.findByText(/Pasted data 1/);
    expect(store.get().view.quantity).toBe('transmittance');
    expect(yAxisTitle(store.view.container)).toBe('Transmittance (%)');
  });

  it('draws, tabulates and labels the peaks step in the chosen quantity', () => {
    const s = percentTSpectrum();
    const store = setup(PeaksStep, { spectra: [s], view: { quantity: 'transmittance' } });
    expect(yAxisTitle(store.view.container)).toBe('Transmittance (%)');
    expect(screen.getByRole('columnheader', { name: 'Transmittance (%)' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Absorbance'));
    expect(store.get().view.quantity).toBe('absorbance');
    expect(yAxisTitle(store.view.container)).toBe('Absorbance (a.u.)');
    expect(screen.queryByRole('columnheader', { name: 'Transmittance (%)' })).toBeNull();
  });

  it('keeps the final figure in transmittance when it is chosen (the reported bug)', () => {
    const s = percentTSpectrum();
    const data: FtirData = {
      ...initialFtirData,
      spectra: [s],
      view: { quantity: 'transmittance' },
    };
    const store = setup(ResultsStep, data);
    expect(yAxisTitle(store.view.container)).toBe('Transmittance (%)');
    expect(methodsText(data)).toContain('presented as transmittance');
    // The assignment step agrees.
    const assign = setup(AssignStep, data);
    expect(yAxisTitle(assign.view.container)).toBe('Transmittance (%)');
  });
});
