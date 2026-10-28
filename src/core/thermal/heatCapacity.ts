import { KELVIN_OFFSET } from './import';
import { interpolate } from './process';

/** Sapphire (α-Al₂O₃) heat capacity table: temperature in K and Cp in J/(mol·K). */
export interface SapphireTable {
  molarMassGPerMol: number;
  rows: readonly (readonly [number, number])[];
}

/**
 * Specific heat capacity of sapphire in J/(g·K) at temperature tK (kelvin), linearly interpolated
 * between table rows and divided by the molar mass: cp = Cp,molar / M. Null outside the table.
 */
export function sapphireCp(table: SapphireTable, tK: number): number | null {
  const first = table.rows[0];
  const last = table.rows[table.rows.length - 1];
  if (!first || !last || tK < first[0] || tK > last[0]) return null;
  const T = table.rows.map((r) => r[0]);
  const cp = table.rows.map((r) => r[1]);
  return interpolate(T, cp, tK) / table.molarMassGPerMol;
}

/** One heating run: temperature in °C (increasing) and heat flow as recorded (mW, same sign in all runs). */
export interface HeatFlowCurve {
  temperatureC: Float64Array;
  heatFlow: Float64Array;
}

export interface CpPoint {
  temperatureC: number;
  /** Specific heat capacity of the sample, J/(g·K). */
  cp: number;
  /** Sapphire reference value used, J/(g·K). */
  sapphireCp: number;
}

export interface CpResult {
  points: CpPoint[];
  notes: string[];
}

/**
 * Specific heat capacity by the three-run sapphire (ratio) method, as in ASTM E1269:
 *
 *   cp(sample) = cp(sapphire) · (D_s / D_st) · (m_st / m_s)
 *
 * D_s and D_st are the vertical distances (heat flow, mW) between the sample curve and the empty-pan
 * (blank) curve, and between the sapphire curve and the blank, at the same temperature; m_s and m_st
 * are the masses in mg (only their ratio matters). The three runs must use the same pans, purge and
 * heating rate. Values are given every stepC from fromC to toC (°C). A point is skipped where the
 * sapphire displacement is too small to divide by (under 1 % of its largest value in the range) or
 * the sapphire table has no value.
 */
export function heatCapacityBySapphire(
  table: SapphireTable,
  blank: HeatFlowCurve,
  sapphire: HeatFlowCurve,
  sample: HeatFlowCurve,
  masses: { sapphireMg: number; sampleMg: number },
  range: { fromC: number; toC: number; stepC: number },
): CpResult {
  const notes: string[] = [];
  const lo = Math.max(
    range.fromC,
    first(blank.temperatureC),
    first(sapphire.temperatureC),
    first(sample.temperatureC),
  );
  const hi = Math.min(
    range.toC,
    last(blank.temperatureC),
    last(sapphire.temperatureC),
    last(sample.temperatureC),
  );
  if (hi < lo || !(range.stepC > 0)) {
    return { points: [], notes: ['The three runs do not share a temperature range.'] };
  }
  if (lo > range.fromC || hi < range.toC) {
    notes.push(
      `The three runs only overlap from ${lo.toFixed(1)} to ${hi.toFixed(1)} °C, so the range was cut to that.`,
    );
  }
  const at = (c: HeatFlowCurve, t: number) => interpolate(c.temperatureC, c.heatFlow, t);
  const grid: number[] = [];
  for (let t = lo; t <= hi + 1e-9; t += range.stepC) grid.push(t);
  const dst = grid.map((t) => at(sapphire, t) - at(blank, t));
  const largest = Math.max(...dst.map(Math.abs));
  const ratio = masses.sapphireMg / masses.sampleMg;
  const points: CpPoint[] = [];
  let skippedSmall = 0;
  let skippedTable = 0;
  grid.forEach((t, i) => {
    const d = dst[i] as number;
    const ref = sapphireCp(table, t + KELVIN_OFFSET);
    if (ref === null) {
      skippedTable++;
      return;
    }
    if (!(Math.abs(d) > 0.01 * largest)) {
      skippedSmall++;
      return;
    }
    const ds = at(sample, t) - at(blank, t);
    points.push({ temperatureC: t, cp: ref * (ds / d) * ratio, sapphireCp: ref });
  });
  if (skippedTable > 0) {
    notes.push(
      `${skippedTable} temperature(s) lie outside the sapphire table (${table.rows[0]?.[0]} to ${table.rows[table.rows.length - 1]?.[0]} K) and were left out.`,
    );
  }
  if (skippedSmall > 0) {
    notes.push(
      `${skippedSmall} temperature(s) were left out because the sapphire curve is almost on the blank there.`,
    );
  }
  if (points.some((p) => p.cp < 0)) {
    notes.push(
      'Some values are negative: the sample curve lies on the other side of the blank from the sapphire curve. Check that the three files use the same sign convention and the right blank.',
    );
  }
  return { points, notes };
}

const first = (x: Float64Array) => x[0] as number;
const last = (x: Float64Array) => x[x.length - 1] as number;
