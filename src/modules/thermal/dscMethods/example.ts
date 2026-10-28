import sapphireFile from '../../../../data/thermal/sapphire-cp.json';
import { sapphireCp, type SapphireTable } from '../../../core/thermal/heatCapacity';
import { KELVIN_OFFSET } from '../../../core/thermal/import';
import { GAS_CONSTANT } from '../../../core/thermal/kinetics';
import type { ColumnMapping } from '../../../core/thermal/types';
import type { LoadedTable } from '../data';

export const SAPPHIRE = sapphireFile as unknown as SapphireTable & {
  source: { citation: string };
  verification: string;
};

/*
 * Made-up, noise-free runs with known answers, for the example buttons and the tests. None is a
 * real measurement. Heat flow is endothermic positive (exo down) in every example.
 */

const MAPPING: ColumnMapping = {
  temperature: 0,
  temperatureUnit: 'C',
  mass: null,
  massUnit: 'mg',
  time: null,
  timeUnit: 'min',
  heatFlow: 1,
};

function loaded(name: string, names: string[], columns: Float64Array[], time = false): LoadedTable {
  return {
    name: `${name} (synthetic)`,
    table: { names, columns, headerText: '', notes: [] },
    mapping: time ? { ...MAPPING, time: 1, heatFlow: 2 } : MAPPING,
    synthetic: true,
  };
}

/** Sapphire-method example: 10 K/min, 20 to 300 °C, sapphire 25 mg, sample 10 mg. */
export const EXAMPLE_CP = {
  rateKPerMin: 10,
  sapphireMg: 25,
  sampleMg: 10,
  /** The sample's true specific heat capacity, J/(g·K). */
  sampleCp: (tC: number) => 1.2 + 0.001 * (tC - 20),
};

export function exampleCpRuns(): {
  blank: LoadedTable;
  sapphire: LoadedTable;
  sample: LoadedTable;
} {
  const T = Float64Array.from({ length: 561 }, (_, i) => 20 + 0.5 * i);
  const beta = EXAMPLE_CP.rateKPerMin / 60;
  const blank = T.map((t) => 0.5 + 0.002 * (t - 20));
  // Heat flow in mW = mass (g) · cp (J/(g·K)) · β (K/s) · 1000.
  const sapphire = T.map(
    (t, i) =>
      (blank[i] as number) +
      (EXAMPLE_CP.sapphireMg / 1000) *
        (sapphireCp(SAPPHIRE, t + KELVIN_OFFSET) as number) *
        beta *
        1000,
  );
  const sample = T.map(
    (t, i) =>
      (blank[i] as number) + (EXAMPLE_CP.sampleMg / 1000) * EXAMPLE_CP.sampleCp(t) * beta * 1000,
  );
  const names = ['Temperature (°C)', 'Heat flow (mW)'];
  return {
    blank: loaded('Empty pan', names, [T, blank]),
    sapphire: loaded('Sapphire', names, [T, sapphire]),
    sample: loaded('Sample', names, [T, sample]),
  };
}

/** Purity example: x₂ = 0.005, T₀ = 122 °C, ΔH_f = 30 kJ/mol, M = 150 g/mol, 0.5 K/min. */
export const EXAMPLE_PURITY = {
  x2: 0.005,
  t0C: 122,
  fusionKJ: 30,
  molarMass: 150,
  rateKPerMin: 0.5,
};

/**
 * An ideal van 't Hoff melting peak in W/g: F(T) = A / (T₀ − T) with A = R T₀² x₂ / ΔH_f, and the
 * heat flow ΔH (J/g) · dF/dT · β until F reaches 1, then zero. It starts where F = 0.002.
 */
export function examplePurityRun(): LoadedTable {
  const { x2, t0C, fusionKJ, molarMass, rateKPerMin } = EXAMPLE_PURITY;
  const t0K = t0C + KELVIN_OFFSET;
  const A = (GAS_CONSTANT * t0K * t0K * x2) / (fusionKJ * 1000);
  const jPerG = (fusionKJ * 1000) / molarMass;
  const beta = rateKPerMin / 60;
  const from = t0C - A / 0.002;
  const end = t0C - A;
  const T = Float64Array.from(
    { length: Math.round((t0C + 5 - from) / 0.02) },
    (_, i) => from + 0.02 * i,
  );
  const flow = T.map((t) => (t <= end ? (jPerG * A * beta) / (t0C - t) ** 2 : 0));
  return loaded('Melting peak', ['Temperature (°C)', 'Heat flow (W/g)'], [T, flow]);
}

/** OIT example: 200 °C, switch to oxygen at 5 min, oxidation onset at 32 min (OIT 27 min). */
export const EXAMPLE_OIT = { switchMin: 5, onsetMin: 32 };

export function exampleOitRun(): LoadedTable {
  const { switchMin, onsetMin } = EXAMPLE_OIT;
  const time = Float64Array.from({ length: 1201 }, (_, i) => 0.05 * i);
  const T = time.map(() => 200);
  // Endothermic positive: the exotherm goes down. Linear rise for 3 min, then an exponential fall.
  const exo = time.map((t) => {
    const base = t < switchMin ? 0.05 : 0.1;
    if (t < onsetMin) return base;
    if (t < onsetMin + 3) return base + 2 * (t - onsetMin);
    return base + 6 * Math.exp(-(t - onsetMin - 3) / 4);
  });
  return loaded(
    'Isothermal run',
    ['Temperature (°C)', 'Time (min)', 'Heat flow (mW)'],
    [T, time, exo.map((v) => -v)],
    true,
  );
}
