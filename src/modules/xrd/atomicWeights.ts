import weightsFile from '../../../data/thermal/atomic-weights.json';

/** Standard atomic weights by element symbol, g/mol (CIAAW 2024, see the JSON file). */
export const ATOMIC_WEIGHTS: Readonly<Record<string, number>> = Object.fromEntries(
  weightsFile.elements.map((e) => [e.symbol, e.weight]),
);
