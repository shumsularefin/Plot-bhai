import type {
  ReferenceFamilyFile,
  ReferenceIndex,
  ReferencePhase,
} from '../../core/xrd/reference/types';

/** One lazy chunk per file, so only the families that are looked at are downloaded. */
const files = import.meta.glob<ReferenceIndex | ReferenceFamilyFile>(
  '../../../data/reference/*.json',
  {
    import: 'default',
  },
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

/** Family names, aliases and phase lists (a few kB). */
export const loadReferenceIndex = () => load<ReferenceIndex>('index.json');

/** All phases of one family, with their reflection lists. */
export async function loadReferenceFamily(file: string): Promise<ReferencePhase[]> {
  return (await load<ReferenceFamilyFile>(file)).phases;
}

/** Link to the COD entry page of a structure. */
export const codUrl = (codId: number) => `https://www.crystallography.net/cod/${codId}.html`;
