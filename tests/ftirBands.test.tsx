import { fireEvent, render, screen, within } from '@testing-library/preact';
import { beforeAll, describe, expect, it } from 'vitest';
import { BandsStep } from '../src/modules/ftir/BandsStep';
import { parseTypedNumbers } from '../src/core/xrd/parsers/numbers';
import {
  DEFAULT_BAND_SETTINGS,
  exampleSpectra,
  initialFtirData,
  migrateFtirData,
  processingFor,
  type FtirData,
} from '../src/modules/ftir/data';
import { methodsText } from '../src/modules/ftir/methodsText';
import { fitBands } from '../src/core/ftir/bands';
import type { FtirSpectrum } from '../src/core/ftir/types';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function setup(start: Partial<FtirData> = {}) {
  let data: FtirData = { ...initialFtirData, ...start };
  const view = render(<BandsStep data={data} update={() => {}} />);
  const update = (patch: Partial<FtirData>) => {
    data = { ...data, ...patch };
    view.rerender(<BandsStep data={data} update={update} />);
  };
  view.rerender(<BandsStep data={data} update={update} />);
  return { get: () => data };
}

const gauss = (v: number, h: number, c: number, w: number) =>
  h * Math.exp((-4 * Math.LN2 * (v - c) ** 2) / (w * w));

function spectrum(name: string, f: (v: number) => number): FtirSpectrum {
  const wavenumber = Float64Array.from({ length: 1201 }, (_, i) => 800 + i);
  return {
    id: name,
    name,
    source: 'synthetic',
    wavenumber,
    values: wavenumber.map(f),
    kind: 'absorbance',
    scale: 'percent',
    kindOrigin: 'generated',
    synthetic: true,
    notes: [],
  };
}

describe('FTIR bands step', () => {
  it('finds the subtraction factor and adds the difference as a new spectrum', () => {
    const sample = spectrum(
      'sample',
      (v) => 0.7 * gauss(v, 0.6, 1640, 50) + gauss(v, 0.4, 1100, 30),
    );
    const water = spectrum('water', (v) => gauss(v, 0.6, 1640, 50));
    const store = setup({ spectra: [sample, water] });
    fireEvent.change(screen.getByLabelText('Reference to subtract'), {
      target: { value: 'water' },
    });
    fireEvent.input(screen.getByLabelText('Reference-only range from (cm⁻¹)'), {
      target: { value: '1560' },
    });
    fireEvent.input(screen.getAllByLabelText('to (cm⁻¹)')[0] as HTMLElement, {
      target: { value: '1720' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find k in this range' }));
    expect(store.get().bands.sample?.subtract.factor).toBeCloseTo(0.7, 4);
    fireEvent.click(screen.getByRole('button', { name: 'Add the difference as a new spectrum' }));
    const added = store.get().spectra[2];
    expect(added?.source).toBe('computed');
    expect(added?.name).toBe('sample − 0.7 × water');
    // At the water band only the sample's own (zero) absorbance is left.
    const at = added ? added.wavenumber.indexOf(1640) : -1;
    expect(Math.abs(added?.values[at] as number)).toBeLessThan(1e-3);
    expect(methodsText(store.get())).toContain('One difference spectrum was calculated');
  });

  it('measures band areas and their ratio to a reference band', () => {
    const s = spectrum('s', (v) => gauss(v, 0.8, 1200, 20) + gauss(v, 0.4, 1700, 20));
    const store = setup({ spectra: [s] });
    fireEvent.click(screen.getByRole('button', { name: 'Add a range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a range' }));
    const fill = (label: string, value: string) =>
      fireEvent.input(screen.getByLabelText(label), { target: { value } });
    fill('Range 1 from (cm⁻¹)', '1140');
    fill('Range 1 to (cm⁻¹)', '1260');
    fill('Range 2 from (cm⁻¹)', '1640');
    fill('Range 2 to (cm⁻¹)', '1760');
    fireEvent.click(screen.getByLabelText('Divide by range 2'));
    expect(store.get().bands.s?.areas.reference).toBe(1);
    // Same width, twice the height: ratio 2, and the reference's own ratio 1.
    const table = within(screen.getByRole('region', { name: 'Band areas, scrolls sideways' }));
    expect(table.getByText('2')).toBeTruthy();
    expect(table.getByText('1')).toBeTruthy();
    expect(methodsText(store.get())).toContain('trapezoid rule');
  });

  it('takes second-derivative minima as starting bands for the fit', () => {
    const s = spectrum('s', (v) => gauss(v, 0.5, 1650, 30) + gauss(v, 0.3, 1685, 25));
    const store = setup({ spectra: [s] });
    fireEvent.input(screen.getByLabelText('Fit from (cm⁻¹)'), { target: { value: '1550' } });
    fireEvent.input(screen.getAllByLabelText('to (cm⁻¹)').at(-1) as HTMLElement, {
      target: { value: '1800' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Use the minima in the fit range as starting bands' }),
    );
    const centres = store.get().bands.s?.fit.centres ?? [];
    expect(centres).toHaveLength(2);
    expect(Math.abs((centres[0] as number) - 1650)).toBeLessThan(3);
    expect(Math.abs((centres[1] as number) - 1685)).toBeLessThan(3);
    expect(store.get().bands.s?.derivative.used).toBe(true);
    // A fit saved with the current processing goes into the methods text.
    const fit = fitBands(s.wavenumber, s.values, {
      fromCm: 1550,
      toCm: 1800,
      centres,
      profile: 'pseudo-voigt',
    });
    const data = store.get();
    const settings = data.bands.s ?? DEFAULT_BAND_SETTINGS;
    const text = methodsText({
      ...data,
      bands: {
        s: {
          ...settings,
          fit: { ...settings.fit, result: { key: JSON.stringify(processingFor(data, 's')), fit } },
        },
      },
    });
    expect(text).toContain('was fitted with 2 pseudo-Voigt bands');
    expect(text).toContain('minima of the second derivative (Savitzky–Golay, 15 points');
  });

  it('parses typed starting positions', () => {
    expect(parseTypedNumbers('1650, 1685.5 1720;1730')).toEqual([1650, 1685.5, 1720, 1730]);
    expect(parseTypedNumbers('1650, abc')).toBeNull();
    expect(parseTypedNumbers('')).toEqual([]);
  });
});

describe('FTIR saved state', () => {
  it('upgrades version 1 and moves the step past the new Bands step', () => {
    const v1 = { step: 3, furthest: 4, data: { ...initialFtirData, spectra: exampleSpectra() } };
    delete (v1.data as Partial<FtirData>).bands;
    const upgraded = migrateFtirData(v1, 1);
    expect(upgraded?.step).toBe(4);
    expect(upgraded?.furthest).toBe(5);
    expect(upgraded?.data.bands).toEqual({});
    expect(migrateFtirData(v1, 3)).toBeUndefined();
  });
});
