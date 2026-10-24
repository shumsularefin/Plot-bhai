import { linearFit } from '../math/linearFit';
import { formatNumber } from '../xrd/parsers/numbers';
import type { DataMessage } from '../xrd/types';
import { smooth } from './smooth';
import type { RunInfo, ThermalRun } from './types';

/** Unit of the heat flow column. */
export type HeatFlowUnit = 'mW' | 'mW/mg' | 'W/g';

/** Which way exothermic peaks point in the file and on the plots. Null until the user chooses. */
export interface DscSetup {
  unit: HeatFlowUnit;
  /** True when exothermic peaks point up in the file. */
  fileExoUp: boolean | null;
  /** True to draw exothermic peaks up. Null follows the file. */
  displayExoUp: boolean | null;
}

export const DEFAULT_DSC_SETUP: DscSetup = { unit: 'mW', fileExoUp: null, displayExoUp: null };

/** The convention used on plots and in tables: the display choice, else the file's. */
export const displayExoUp = (setup: DscSetup): boolean =>
  setup.displayExoUp ?? setup.fileExoUp ?? true;

/** One monotone part of the temperature program (a heating or a cooling ramp). */
export interface Segment {
  id: number;
  direction: 'heating' | 'cooling';
  /** First and last row of the run, inclusive. */
  from: number;
  to: number;
  startC: number;
  endC: number;
  /** "Heating 1", "Cooling 1", "Heating 2", … */
  label: string;
}

/** A turn in temperature smaller than this (°C) is noise, not a change of direction. */
const TURN_C = 1;
/** Points within this many °C of the extreme belong to the hold there, so a turn is placed after the hold. */
const HOLD_C = 0.1;
/** Parts of the program that cover less than this many °C (holds, small wiggles) are not segments. */
const MIN_SEGMENT_SPAN_C = 10;

/**
 * Splits a temperature program into heating and cooling ramps from the direction of the
 * temperature. A change of direction is a move of more than 1 °C against the running extreme;
 * isothermal holds keep the direction and are part of the ramp before them. Parts that span less
 * than 10 °C are dropped. Segments are numbered by kind in order of appearance.
 */
export function splitSegments(temperatureC: ArrayLike<number>): Segment[] {
  const n = temperatureC.length;
  if (n < 2) return [];
  const t = (i: number) => temperatureC[i] as number;
  const turns = [0];
  let low = 0;
  let high = 0;
  let direction = 0;
  // The running extreme: its temperature, and the last row within HOLD_C of it (the end of a hold).
  let extremeT = 0;
  let extreme = 0;
  for (let i = 1; i < n; i++) {
    if (direction === 0) {
      if (t(i) < t(low)) low = i;
      if (t(i) > t(high)) high = i;
      if (t(i) - t(low) >= TURN_C) {
        direction = 1;
        extreme = i;
        extremeT = t(i);
      } else if (t(high) - t(i) >= TURN_C) {
        direction = -1;
        extreme = i;
        extremeT = t(i);
      }
      continue;
    }
    const beyond = direction * (t(i) - extremeT);
    if (beyond > 0) {
      extremeT = t(i);
      extreme = i;
    } else if (beyond >= -HOLD_C) {
      extreme = i;
    } else if (beyond <= -TURN_C) {
      turns.push(extreme);
      direction = -direction;
      extreme = i;
      extremeT = t(i);
    }
  }
  turns.push(n - 1);
  const segments: Segment[] = [];
  const count = { heating: 0, cooling: 0 };
  for (let k = 0; k + 1 < turns.length; k++) {
    const from = turns[k] as number;
    const to = turns[k + 1] as number;
    const span = t(to) - t(from);
    if (Math.abs(span) < MIN_SEGMENT_SPAN_C) continue;
    const kind = span > 0 ? 'heating' : 'cooling';
    count[kind] += 1;
    segments.push({
      id: segments.length,
      direction: kind,
      from,
      to,
      startC: t(from),
      endC: t(to),
      label: `${kind === 'heating' ? 'Heating' : 'Cooling'} ${count[kind]}`,
    });
  }
  return segments;
}

/**
 * Heat flow as exo-positive numbers, specific when possible.
 * Units: 1 mW/mg = 1 W/g exactly (the milli cancels); mW divided by the sample mass in mg is W/g.
 * Without a mass, a heat flow in mW stays in mW and later enthalpies are in mJ.
 * Sign: if exothermic peaks point down in the file, the values are multiplied by −1, so that
 * everywhere in the analysis exothermic = positive and endothermic = negative.
 */
export function toExoPositive(
  raw: ArrayLike<number>,
  setup: Pick<DscSetup, 'unit' | 'fileExoUp'>,
  massMg: number | null,
): { exo: Float64Array; specific: boolean } {
  const sign = setup.fileExoUp === false ? -1 : 1;
  const divide = setup.unit === 'mW' && massMg !== null && massMg > 0 ? massMg : null;
  const specific = setup.unit !== 'mW' || divide !== null;
  const exo = Float64Array.from(raw, (v) => (sign * v) / (divide ?? 1));
  return { exo, specific };
}

/** Rate of change of temperature in K/min from time (min) and temperature (°C), as a least-squares slope magnitude. */
export function rateFromTime(timeMin: ArrayLike<number>, temperatureC: ArrayLike<number>) {
  const fit = linearFit(Array.from(timeMin), Array.from(temperatureC));
  return fit && Number.isFinite(fit.slope) && fit.slope !== 0 ? Math.abs(fit.slope) : null;
}

export interface DscCleanSettings {
  /** Segment to analyse; null means the first heating ramp. */
  segmentId: number | null;
  /** Keep only this temperature range (°C); null means all of the segment. */
  fromC: number | null;
  toC: number | null;
  /** Smoothing window in °C; 0 means none. */
  smoothWindowC: number;
}

export const DEFAULT_DSC_CLEAN: DscCleanSettings = {
  segmentId: null,
  fromC: null,
  toC: null,
  smoothWindowC: 0,
};

/** The cleaned DSC curve of one segment, with temperature increasing. */
export interface DscCurve {
  temperatureC: Float64Array;
  /** Exo-positive heat flow, in W/g when `specific`, else mW. */
  exo: Float64Array;
  specific: boolean;
  unit: 'W/g' | 'mW';
  /** True for a cooling segment (the arrays are reversed so the temperature still increases). */
  cooling: boolean;
  /** Scan rate in K/min, with where it came from; null if unknown. */
  rateKPerMin: number | null;
  rateSource: 'entered' | 'time column' | null;
  segment: Segment;
  notes: DataMessage[];
}

export type DscCleanResult =
  { ok: true; curve: DscCurve; segments: Segment[] } | { ok: false; error: string };

/**
 * Turns a run into the DSC curve of one segment, in this order: pick the segment (strictly
 * monotone temperature; for cooling the arrays are reversed), normalise by mass and make the
 * heat flow exo-positive (`toExoPositive`), crop to the chosen range, smooth.
 */
export function cleanDsc(
  run: ThermalRun,
  setup: DscSetup,
  info: Pick<RunInfo, 'initialMassMg' | 'heatingRate'>,
  settings: DscCleanSettings,
): DscCleanResult {
  const heatFlow = run.heatFlow;
  if (!heatFlow) {
    return { ok: false, error: 'This run has no heat flow column, so there is no DSC curve.' };
  }
  if (setup.fileExoUp === null) {
    return {
      ok: false,
      error: 'Say whether exothermic peaks point up or down in your file (step 1).',
    };
  }
  const segments = splitSegments(run.temperatureC);
  const chosen =
    segments.find((s) => s.id === settings.segmentId) ??
    segments.find((s) => s.direction === 'heating') ??
    segments[0];
  if (!chosen) {
    return { ok: false, error: 'The temperature does not change enough to find a ramp.' };
  }
  const cooling = chosen.direction === 'cooling';
  const notes: DataMessage[] = [];
  const raw: number[] = [];
  let last = cooling ? Infinity : -Infinity;
  for (let i = chosen.from; i <= chosen.to; i++) {
    const v = run.temperatureC[i] as number;
    if (cooling ? v < last : v > last) {
      raw.push(i);
      last = v;
    }
  }
  const dropped = chosen.to - chosen.from + 1 - raw.length;
  if (dropped > 0) {
    notes.push({
      level: 'info',
      text: `${dropped} points of ${chosen.label.toLowerCase()} were left out: they repeat a temperature already passed (isothermal hold).`,
    });
  }
  const order = cooling ? raw.slice().reverse() : raw;
  const indices = order.filter((i) => {
    const v = run.temperatureC[i] as number;
    return !(
      (settings.fromC !== null && v < settings.fromC) ||
      (settings.toC !== null && v > settings.toC)
    );
  });
  if (indices.length < 10) {
    return { ok: false, error: 'Fewer than 10 points are left in the chosen range.' };
  }
  const T = Float64Array.from(indices, (i) => run.temperatureC[i] as number);
  const picked = Float64Array.from(indices, (i) => heatFlow[i] as number);
  const { exo, specific } = toExoPositive(picked, setup, info.initialMassMg);
  if (!specific) {
    notes.push({
      level: 'warning',
      text: 'The heat flow is in mW and no sample mass was entered, so it cannot be divided by the mass. Enthalpies will be in mJ and the heat capacity change cannot be given. Enter the sample mass in step 1 to get J/g.',
    });
  }
  const smoothed = settings.smoothWindowC > 0 ? smooth(T, exo, settings.smoothWindowC) : exo;

  let rateKPerMin: number | null = null;
  let rateSource: DscCurve['rateSource'] = null;
  if (info.heatingRate !== null && info.heatingRate > 0) {
    rateKPerMin = info.heatingRate;
    rateSource = 'entered';
    if (cooling) {
      notes.push({
        level: 'info',
        text: `The scan rate you entered (${formatNumber(rateKPerMin, 1)} K/min) is used for the cooling ramp as well. Enter the cooling rate if it was different.`,
      });
    }
  } else if (run.timeMin) {
    const time = Float64Array.from(indices, (i) => run.timeMin?.[i] as number);
    rateKPerMin = rateFromTime(time, T);
    if (rateKPerMin !== null) rateSource = 'time column';
  }
  if (rateKPerMin === null) {
    notes.push({
      level: 'warning',
      text: 'The scan rate is unknown (no heating rate entered and no time column). Enthalpies and the heat capacity change need it: enter the rate in step 1.',
    });
  }
  return {
    ok: true,
    segments,
    curve: {
      temperatureC: T,
      exo: smoothed,
      specific,
      unit: specific ? 'W/g' : 'mW',
      cooling,
      rateKPerMin,
      rateSource,
      segment: chosen,
      notes,
    },
  };
}
