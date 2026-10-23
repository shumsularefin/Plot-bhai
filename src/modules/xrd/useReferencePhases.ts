import { useEffect, useState } from 'preact/hooks';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import { loadReferenceFamily, loadReferenceIndex } from './referenceLibrary';

/** The phases of one library family (null while loading or when none is chosen). */
export function useReferencePhases(familyId: string | null): {
  phases: ReferencePhase[] | null;
  failed: boolean;
} {
  const [phases, setPhases] = useState<ReferencePhase[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!familyId) {
      setPhases(null);
      return;
    }
    let current = true;
    loadReferenceIndex()
      .then((index) => {
        const family = index.families.find((f) => f.id === familyId);
        return family ? loadReferenceFamily(family.file) : [];
      })
      .then(
        (loaded) => current && setPhases(loaded),
        () => current && setFailed(true),
      );
    return () => {
      current = false;
    };
  }, [familyId]);
  return { phases, failed };
}
