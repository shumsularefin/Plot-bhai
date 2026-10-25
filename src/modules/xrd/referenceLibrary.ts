import type {
  ReferenceFamilyFile,
  ReferenceIndex,
  ReferenceIndexEntry,
  ReferencePhase,
} from '../../core/xrd/reference/types';
import index from '../../../data/reference/index.json';

/**
 * The library index (families, phase names, formulas, cells; about 25 kB before compression),
 * bundled with the XRD tool so search and saved sessions work at once. The line lists are
 * loaded per family on demand.
 */
export const libraryIndex = index as ReferenceIndex;

/** The family a library phase belongs to, or undefined for an unknown id (or a loaded CIF). */
export function familyOf(phaseId: string): ReferenceIndexEntry | undefined {
  return libraryIndex.families.find((f) => f.phases.some((p) => p.id === phaseId));
}

/** One lazy chunk per file, so only the families that are looked at are downloaded. */
const files = import.meta.glob<unknown>(
  ['../../../data/reference/*.json', '!../../../data/reference/index.json'],
  { import: 'default' },
);

const cache = new Map<string, Promise<unknown>>();

function load<T>(name: string): Promise<T> {
  const key = `../../../data/reference/${name}`;
  const loader = files[key];
  if (!loader) return Promise.reject(new Error(`Reference file ${name} is missing`));
  let promise = cache.get(key);
  if (!promise) {
    promise = loader();
    cache.set(key, promise);
  }
  return promise as Promise<T>;
}

/** All phases of one family, with their reflection lists. */
export async function loadReferenceFamily(file: string): Promise<ReferencePhase[]> {
  return (await load<ReferenceFamilyFile>(file)).phases;
}

/** Link to the COD entry page of a structure. */
export const codUrl = (codId: number) => `https://www.crystallography.net/cod/${codId}.html`;
