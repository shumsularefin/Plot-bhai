import { useEffect, useState } from 'preact/hooks';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import type { MaterialState } from './data';
import { familyOf, loadReferenceFamily } from './referenceLibrary';

/**
 * The candidate phases of the material choice, in the order chosen, with their line lists:
 * library phases (their family files are loaded on demand) and structures from loaded CIF
 * files. null while loading; failed when a library file could not be loaded.
 */
export function useCandidatePhases(material: Pick<MaterialState, 'candidates' | 'userPhases'>): {
  phases: ReferencePhase[] | null;
  failed: boolean;
} {
  const [library, setLibrary] = useState<Map<string, ReferencePhase> | null>(null);
  const [failed, setFailed] = useState(false);
  const libraryIds = material.candidates.filter((id) => familyOf(id) !== undefined);
  const key = libraryIds.join('|');
  useEffect(() => {
    setFailed(false);
    const files = [...new Set(libraryIds.map((id) => (familyOf(id) as { file: string }).file))];
    if (files.length === 0) {
      setLibrary(new Map());
      return;
    }
    let current = true;
    setLibrary(null);
    Promise.all(files.map(loadReferenceFamily)).then(
      (all) => current && setLibrary(new Map(all.flat().map((p) => [p.id, p]))),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- libraryIds is derived from key
  if (!library) return { phases: null, failed };
  const phases = material.candidates.flatMap((id) => {
    const phase = library.get(id) ?? material.userPhases.find((p) => p.id === id);
    return phase ? [phase] : [];
  });
  return { phases, failed };
}
