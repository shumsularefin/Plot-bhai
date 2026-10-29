/*
 * Builds the polymer library the app ships: data/reference/polymers.json (line lists) and the
 * polymer entries of data/reference/index.json, from the hand-transcribed CIFs in data/polymers/
 * (see scripts/polymer-phases.ts and docs/polymer-library.md). Run with:
 *
 *   npm run build:polymers
 *
 * Nothing is downloaded: the patterns are calculated with the same code the app uses for a
 * loaded CIF, so a library phase and the same file loaded by hand give identical lines.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { phaseFromCif } from '../src/core/xrd/reference/fromCif.ts';
import type { FormFactors } from '../src/core/xrd/reference/powder.ts';
import type {
  ReferenceFamilyFile,
  ReferenceIndex,
  ReferencePhase,
} from '../src/core/xrd/reference/types.ts';
import { phaseLink, phaseReference } from '../src/core/xrd/reference/source.ts';
import { POLYMER_FAMILIES } from './polymer-phases.ts';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const factors = (
  JSON.parse(read('data/reference/scattering-factors.json')) as { factors: FormFactors }
).factors;

const phases: ReferencePhase[] = [];
const index: ReferenceIndex = {
  source:
    'Polymers not in the Crystallography Open Database: structures transcribed by hand from the cited papers (data/polymers/), patterns calculated with the kinematic model, Cu Ka1. Polymers that COD holds are found through the COD search.',
  intensityWavelength: 1.5405929,
  families: [],
};

for (const family of POLYMER_FAMILIES) {
  const entry: ReferenceIndex['families'][number] = {
    id: family.id,
    name: family.name,
    aliases: family.aliases,
    formula: '',
    file: 'polymers.json',
    phases: [],
  };
  for (const spec of family.phases) {
    const result = phaseFromCif(read(`data/polymers/${spec.file}`), spec.file, factors, spec.id);
    if (!result.ok) throw new Error(`${spec.file}: ${result.error}`);
    const rest = result.phase;
    const phase: ReferencePhase = {
      ...rest,
      name: spec.name,
      codId: null,
      origin: { kind: 'library' },
      citation: { ...rest.citation, authors: spec.authors },
    };
    phases.push(phase);
    entry.phases.push({
      id: phase.id,
      name: phase.name,
      codId: null,
      reference: phaseReference(phase),
      link: phaseLink(phase),
      spaceGroup: phase.spaceGroup.hm,
      crystalSystem: phase.crystalSystem,
      formula: phase.formula,
      spaceGroupNumber: phase.spaceGroup.number,
      elements: Object.keys(phase.cellContents ?? {}).sort(),
      cell: phase.cell,
    });
    console.log(
      `${spec.id}: ${phase.peaks.length} lines, strongest at d = ${
        [...phase.peaks].sort((a, b) => b.i - a.i)[0]?.d
      } Å`,
    );
  }
  entry.formula = entry.phases[0]?.formula ?? '';
  index.families.push(entry);
}

const file: ReferenceFamilyFile = { family: 'polymers', phases };
writeFileSync(new URL('data/reference/polymers.json', root), JSON.stringify(file) + '\n');
writeFileSync(new URL('data/reference/index.json', root), JSON.stringify(index, null, 1) + '\n');
