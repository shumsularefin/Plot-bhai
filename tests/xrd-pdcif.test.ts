import { describe, expect, it } from 'vitest';
import { importText } from '../src/core/xrd/import';
import { parsePdCif } from '../src/core/xrd/parsers/pdcif';

const measured = (rows: string) => `data_x_meas
loop_
_pd_meas_2theta_scan
_pd_meas_counts_total
${rows}`;

describe('powder CIF reader', () => {
  it('reads 2θ, counts and the standard uncertainty in parentheses', () => {
    const r = parsePdCif(measured('10.00 100(10)\n10.02 400(20)\n10.04 2.5(15)'));
    if (!r.ok) throw new Error(r.error);
    expect(r.scan.twoTheta).toEqual([10, 10.02, 10.04]);
    expect(r.scan.intensity).toEqual([100, 400, 2.5]);
    expect(r.scan.sigma?.[0]).toBeCloseTo(10, 12);
    expect(r.scan.sigma?.[1]).toBeCloseTo(20, 12);
    expect(r.scan.sigma?.[2]).toBeCloseTo(1.5, 12);
    expect(r.scan.unitFromFile).toBe('counts');
  });

  it('takes σ = 1/√w from _pd_proc_ls_weight and skips a "_calc" block before it', () => {
    const text = `data_p_calc
loop_
_pd_proc_2theta_corrected
_pd_proc_intensity_total
20 1
21 1
data_p_meas
loop_
_pd_proc_2theta_corrected
_pd_proc_intensity_total
_pd_proc_ls_weight
20 16 0.0625
21 25 0.04
`;
    const r = parsePdCif(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.scan.intensity).toEqual([16, 25]);
    expect(r.scan.sigma).toEqual([4, 5]);
    expect(r.scan.notes.some((n) => n.text.includes('2 patterns'))).toBe(true);
  });

  it('builds 2θ from the range when there is no 2θ column', () => {
    const r = parsePdCif(`data_g
_pd_meas_2theta_range_min 5.0
_pd_meas_2theta_range_max 5.2
_pd_meas_2theta_range_inc 0.1
loop_
_pd_meas_counts_total
1 2 3
`);
    if (!r.ok) throw new Error(r.error);
    expect(r.scan.twoTheta.map((v) => Number(v.toFixed(10)))).toEqual([5, 5.1, 5.2]);
    expect(r.scan.sigma).toBeUndefined();
  });

  it('points a structure CIF to step 3', () => {
    const r = importText('ZnO.cif', 'data_ZnO\n_cell_length_a 3.25\n', 'cif');
    expect(r.ok ? '' : r.error).toContain('Choose material');
  });

  it('is detected by content when pasted', () => {
    const rows = Array.from({ length: 200 }, (_, i) => `${(10 + i * 0.02).toFixed(2)} ${100 + i}`);
    const r = importText('pasted', measured(rows.join('\n')));
    expect(r.ok ? r.pattern.source : r.error).toBe('cif');
  });
});
