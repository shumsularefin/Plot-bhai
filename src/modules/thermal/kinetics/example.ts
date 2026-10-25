import { GAS_CONSTANT } from '../../../core/thermal/kinetics';
import { syntheticFirstOrderMass, type KineticModel } from '../../../core/thermal/synthetic';
import type { ThermalTable } from '../../../core/thermal/types';
import type { LoadedTable } from '../data';

/** The made-up reaction behind the example runs: Ea = 150 kJ/mol. Not a real material. */
export const EXAMPLE_MODEL: KineticModel = { eaKJ: 150, aPerMin: 1e14, lossPct: 40 };
export const EXAMPLE_RATES = [2, 5, 10, 20, 40];

/** A noise-free synthetic TGA run (temperature °C, mass %) of the example reaction at one heating rate. */
export function exampleKineticRun(rate: number): LoadedTable {
  const { temperatureC, massPct } = syntheticFirstOrderMass(
    EXAMPLE_MODEL,
    rate,
    GAS_CONSTANT,
    100,
    600,
    0.5,
  );
  const table: ThermalTable = {
    names: ['Temperature (°C)', 'Mass (%)'],
    columns: [temperatureC, massPct],
    headerText: '',
    notes: [],
  };
  return {
    name: `Example ${rate} K/min (synthetic)`,
    table,
    mapping: {
      temperature: 0,
      temperatureUnit: 'C',
      mass: 1,
      massUnit: 'percent',
      time: null,
      timeUnit: 'min',
      heatFlow: null,
    },
    synthetic: true,
  };
}
