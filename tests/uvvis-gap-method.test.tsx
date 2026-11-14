import { fireEvent, render, screen } from '@testing-library/preact';
import { beforeAll, describe, expect, it } from 'vitest';
import { fitBandGap, suggestRegion, TRANSITIONS } from '../src/core/uvvis/tauc';
import { bandEdgeAbsorbance } from '../src/core/uvvis/synthetic';
import type { Spectrum } from '../src/core/uvvis/types';
import { resultRows } from '../src/modules/uvvis/analysis';
import { BandGapStep } from '../src/modules/uvvis/BandGapStep';
import {
  bandGapFor,
  DEFAULT_BAND_GAP,
  initialUvvisData,
  migrateUvvisData,
  UVVIS_STATE_VERSION,
  type UvvisData,
} from '../src/modules/uvvis/data';
import { methodsText } from '../src/modules/uvvis/methodsText';
import { RESULT_COLUMNS } from '../src/modules/uvvis/tables';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

/** The audit's spectrum with a constant level of 0.2 in absorbance. */
function withLevel(level: number, id = 's'): Spectrum {
  const s = bandEdgeAbsorbance({
    startNm: 250,
    endNm: 850,
    stepNm: 1,
    bandGapEv: 3.2,
    n: 0.5,
    strength: 1.2,
    baseline: level,
  });
  return {
    id,
    name: `level ${level}`,
    source: 'synthetic',
    wavelengthNm: s.wavelengthNm,
    values: s.values,
    kind: 'absorbance',
    scale: 'percent',
    kindOrigin: 'generated',
    synthetic: true,
    notes: [],
  };
}

const data = (spectra: Spectrum[], bandGap: UvvisData['bandGap'] = {}): UvvisData => ({
  ...initialUvvisData,
  spectra,
  bandGap,
});

const column = (header: string) => {
  const c = RESULT_COLUMNS.find((col) => col.header === header);
  if (!c) throw new Error(header);
  return c;
};

describe('band gap method in the UV-Vis tool', () => {
  it('chooses subtraction automatically for a spectrum with a sub-gap level', () => {
    const [row] = resultRows(data([withLevel(0.2)]));
    expect(row?.analysis.method).toBe('subtract-baseline');
    expect(row?.analysis.automatic).toBe(true);
    expect(Math.abs((row?.analysis.fit?.egEv ?? NaN) - 3.2)).toBeLessThan(0.002);
  });

  it('warns when the axis intercept is chosen although a level is there', () => {
    const [row] = resultRows(
      data([withLevel(0.2)], { s: { ...DEFAULT_BAND_GAP, method: 'axis' } }),
    );
    expect(row?.analysis.method).toBe('axis');
    expect(row?.analysis.subGapLevel).toBe(true);
    // The suggested edge region stays on the edge, so the axis number is the edge's own.
    expect(row?.analysis.region?.[0]).toBeLessThan(3.3);
  });

  it('states the method in the CSV columns and the methods text', () => {
    const d = data([withLevel(0.2, 'a'), withLevel(0, 'b')]);
    const rows = resultRows(d);
    expect(column('Eg read from').value(rows[0] as never)).toBe(
      'sub-gap baseline subtracted before the Tauc plot (automatic)',
    );
    expect(column('Eg read from').value(rows[1] as never)).toBe('axis intercept (automatic)');
    expect(column('Baseline from (eV)').value(rows[0] as never)).not.toBe('');
    expect(column('Baseline from (eV)').value(rows[1] as never)).toBe('');
    const text = methodsText(d);
    expect(text).toContain('was subtracted from the whole spectrum before the Tauc plot');
    expect(text).toContain('meets the energy axis (level 0)');
    const crossing = methodsText(
      data([withLevel(0.2, 'a')], { a: { ...DEFAULT_BAND_GAP, method: 'baseline-crossing' } }),
    );
    expect(crossing).toContain('Makuła, Pacia and Macyk');
  });
});

describe('sessions saved before the baseline methods (version 2)', () => {
  it('keep the same band gap until the user changes the method', () => {
    expect(UVVIS_STATE_VERSION).toBe(3);
    const spectrum = withLevel(0.2);
    const old = { ...DEFAULT_BAND_GAP } as Record<string, unknown>;
    delete old.method;
    delete old.baselineRegion;
    const v2 = { step: 2, furthest: 3, data: { ...data([spectrum]), bandGap: { s: old } } };
    const upgraded = migrateUvvisData(v2, 2);
    if (!upgraded) throw new Error('not migrated');
    const choice = bandGapFor(upgraded.data, 's');
    expect(choice.method).toBe('axis');
    expect(choice.legacySuggestion).toBe(true);
    // What version 2 computed: the straightest window of the uncorrected Tauc curve.
    const [row] = resultRows(upgraded.data);
    const signal = row?.analysis.signal;
    if (!signal) throw new Error('no signal');
    const y = row.analysis.tauc;
    const region = suggestRegion(signal.energyEv, y);
    if (!region) throw new Error('no region');
    const before = fitBandGap(signal.energyEv, y, region[0], region[1]);
    expect(row.analysis.fit?.egEv).toBe(before?.egEv);
    expect(row.analysis.fit?.egEv).toBeCloseTo(2.926, 3);
    expect(TRANSITIONS[choice.transition].exponent).toBe(2);
  });

  it('a spectrum without saved settings is also kept on the old method', () => {
    const v2 = { step: 2, furthest: 3, data: { ...data([withLevel(0.05)]), bandGap: {} } };
    const upgraded = migrateUvvisData(v2, 2);
    expect(upgraded?.data.bandGap.s?.method).toBe('axis');
    expect(migrateUvvisData(v2, 3)).toBeUndefined();
  });
});

describe('band gap step controls', () => {
  function setup(start: UvvisData) {
    let current = start;
    const view = render(<BandGapStep data={current} update={() => {}} />);
    const update = (patch: Partial<UvvisData>) => {
      current = { ...current, ...patch };
      view.rerender(<BandGapStep data={current} update={update} />);
    };
    view.rerender(<BandGapStep data={current} update={update} />);
    return { get: () => current };
  }

  it('lets the user choose the method and type the baseline region', () => {
    const store = setup(data([withLevel(0.2)]));
    expect(screen.getByText(/Sub-gap baseline subtracted first \(automatic\)/)).toBeTruthy();
    const from = screen.getByLabelText('Baseline from (eV)') as HTMLInputElement;
    fireEvent.input(from, { target: { value: '2.5' } });
    const region = store.get().bandGap.s?.baselineRegion;
    expect(region?.[0]).toBe(2.5);
    fireEvent.change(screen.getByLabelText('How Eg is read'), {
      target: { value: 'baseline-crossing' },
    });
    expect(store.get().bandGap.s?.method).toBe('baseline-crossing');
    fireEvent.change(screen.getByLabelText('How Eg is read'), { target: { value: 'axis' } });
    expect(screen.getByText(/does not fall to zero below the edge/)).toBeTruthy();
    expect(screen.queryByLabelText('Baseline from (eV)')).toBeNull();
  });

  it('clears the old suggestion of a migrated session when the method changes', () => {
    const store = setup(
      data([withLevel(0.2)], {
        s: { ...DEFAULT_BAND_GAP, method: 'axis', legacySuggestion: true },
      }),
    );
    expect(screen.getByText(/saved before the baseline methods existed/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('How Eg is read'), { target: { value: 'auto' } });
    expect(store.get().bandGap.s?.legacySuggestion).toBeUndefined();
    expect(store.get().bandGap.s?.method).toBeNull();
  });
});
