import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  DEFAULT_MATCH,
  matchPhase,
  referenceLines,
  searchFamilies,
} from '../../core/xrd/reference/match';
import type {
  ReferenceIndex,
  ReferenceIndexEntry,
  ReferencePhase,
} from '../../core/xrd/reference/types';
import { ANODES } from '../../core/xrd/radiation';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { DEFAULT_MATERIAL, type MaterialState, type XrdData } from './data';
import { codUrl, loadReferenceFamily, loadReferenceIndex } from './referenceLibrary';
import { useMeasured } from './useMeasured';

/** The step-4 comparison has a note on every score; this one covers the "I don't know" guide. */
const GUIDE_NOTE =
  'A guide only. Works for simple, well-separated phases; not reliable for mixtures.';

/** Wizard step 3: choose the material and the reference phases it may contain. */
export function MaterialStep({ data, update }: StepContext<XrdData>) {
  const material = data.material;
  const [index, setIndex] = useState<ReferenceIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [unknown, setUnknown] = useState(false);

  useEffect(() => {
    loadReferenceIndex().then(setIndex, () => setFailed(true));
  }, []);

  const family = index?.families.find((f) => f.id === material.familyId);

  const setMaterial = (patch: Partial<MaterialState>) =>
    update({ material: { ...material, ...patch } });
  const chooseFamily = (entry: ReferenceIndexEntry) => {
    if (entry.id === material.familyId) return;
    setMaterial({ familyId: entry.id, phaseIds: [], hidden: [] });
    setUnknown(false);
  };
  const togglePhase = (id: string, on: boolean) =>
    setMaterial({
      phaseIds: on
        ? [...material.phaseIds.filter((p) => p !== id), id]
        : material.phaseIds.filter((p) => p !== id),
    });

  const results = useMemo(
    () => (index ? searchFamilies(index.families, query) : []),
    [index, query],
  );

  if (failed)
    return (
      <p class="message is-error">
        <strong>Problem:</strong> the reference library could not be loaded. Check your connection
        and reload the page. You can continue without choosing a material.
      </p>
    );
  if (!index) return <p aria-busy="true">Loading the reference library…</p>;

  return (
    <div class="material-step">
      <p class="field-hint">
        Choosing a material lets the next step draw its reference lines under your pattern. You can
        skip this step if you do not need reference phases. Reference patterns are calculated from
        structures in the Crystallography Open Database (COD).{' '}
        <HelpTip term="reference pattern">
          <p>
            A reference pattern is the list of diffraction lines a known crystal structure should
            give: where each line is (2θ, from its d-spacing and your X-ray wavelength) and how
            strong it is. Comparing it with your pattern shows which phase you probably have.
          </p>
        </HelpTip>
      </p>

      <div class="material-search">
        <label class="inline-field">
          Material (name, formula or mineral)
          <input
            type="search"
            value={query}
            placeholder="for example titania, TiO2, quartz"
            autocomplete="off"
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          class="btn"
          aria-pressed={unknown}
          onClick={() => setUnknown(!unknown)}
          disabled={data.patterns.length === 0}
        >
          I don't know
        </button>
      </div>

      {unknown ? (
        <UnknownGuide data={data} index={index} onChoose={chooseFamily} />
      ) : (
        <>
          {results.length === 0 ? (
            <p class="field-hint">
              No material matches "{query}". Try a formula such as ZnO, or use "I don't know".
            </p>
          ) : (
            <ul class="family-list" aria-label="Materials">
              {results.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    class="family-button"
                    aria-pressed={entry.id === material.familyId}
                    onClick={() => chooseFamily(entry)}
                  >
                    <span class="family-name">{entry.name}</span>
                    <span class="family-formula">{entry.formula}</span>
                    <span class="family-count">
                      {entry.phases.length} phase{entry.phases.length === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {family && (
        <section class="phase-choice" aria-labelledby="phase-choice-title">
          <h3 id="phase-choice-title" class="export-title">
            Phases of {family.name}
          </h3>
          <p class="field-hint">Tick every phase that your sample might contain.</p>
          <ul class="phase-list">
            {family.phases.map((p) => {
              const chosen = material.phaseIds.includes(p.id);
              return (
                <li key={p.id} class="phase-row">
                  <label class="check">
                    <input
                      type="checkbox"
                      checked={chosen}
                      onChange={(e) => togglePhase(p.id, e.currentTarget.checked)}
                    />
                    <span>
                      <strong>{p.name}</strong>, {p.crystalSystem}, {p.spaceGroup}
                    </span>
                  </label>
                  <span class="phase-source">
                    <a href={codUrl(p.codId)} target="_blank" rel="noopener noreferrer">
                      COD {p.codId}
                    </a>
                  </span>
                  {chosen && (
                    <label class="inline-field phase-jcpds">
                      JCPDS/ICDD card number (typed by you, not verified)
                      <input
                        value={material.jcpds[p.id] ?? ''}
                        autocomplete="off"
                        placeholder="optional"
                        onInput={(e) =>
                          setMaterial({
                            jcpds: { ...material.jcpds, [p.id]: e.currentTarget.value },
                          })
                        }
                      />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(family || material.phaseIds.length > 0) && (
        <p>
          <button
            type="button"
            class="btn btn-quiet"
            onClick={() => update({ material: DEFAULT_MATERIAL })}
          >
            Clear material choice
          </button>
        </p>
      )}
    </div>
  );
}

/** Every family ranked by how well its best phase agrees with the measured peaks. */
function UnknownGuide({
  data,
  index,
  onChoose,
}: {
  data: XrdData;
  index: ReferenceIndex;
  onChoose: (family: ReferenceIndexEntry) => void;
}) {
  const [patternId, setPatternId] = useState(data.patterns[0]?.id);
  const { pattern, processed, detected } = useMeasured(data, patternId);
  const [library, setLibrary] = useState<Record<string, ReferencePhase[]> | null>(null);
  useEffect(() => {
    let current = true;
    Promise.all(
      index.families.map(async (f) => [f.id, await loadReferenceFamily(f.file)] as const),
    ).then(
      (all) => current && setLibrary(Object.fromEntries(all)),
      () => current && setLibrary({}),
    );
    return () => {
      current = false;
    };
  }, [index]);

  const ranking = useMemo(() => {
    if (!library || !processed || !detected) return null;
    const lambda = ANODES[data.radiation.anode].kAlpha1;
    const range = [
      processed.twoTheta[0] as number,
      processed.twoTheta[processed.twoTheta.length - 1] as number,
    ] as const;
    const peaks = detected.map((p) => p.center);
    return index.families
      .map((family) => {
        const scored = (library[family.id] ?? []).map((phase) => ({
          phase,
          match: matchPhase(referenceLines(phase, lambda), peaks, range, DEFAULT_MATCH),
        }));
        const best = scored.reduce<(typeof scored)[number] | null>(
          (b, s) => (b === null || s.match.score > b.match.score ? s : b),
          null,
        );
        return { family, best };
      })
      .filter((r) => r.best && r.best.match.score > 0)
      .sort((a, b) => (b.best?.match.score ?? 0) - (a.best?.match.score ?? 0))
      .slice(0, 8);
  }, [library, processed, detected, index, data.radiation.anode]);

  return (
    <section class="unknown-guide" aria-labelledby="unknown-title">
      <h3 id="unknown-title" class="export-title">
        Materials whose strongest lines fall near your peaks
      </h3>
      <p class="message is-info">
        <strong>Note:</strong> {GUIDE_NOTE} This is an estimate from the peaks found in your cleaned
        pattern, not an identification.
      </p>
      {data.patterns.length > 1 && (
        <label class="inline-field">
          Pattern
          <select value={pattern?.id} onChange={(e) => setPatternId(e.currentTarget.value)}>
            {data.patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!ranking ? (
        <p aria-busy="true">Comparing your peaks with the library…</p>
      ) : ranking.length === 0 ? (
        <p>No material in the library has lines near your peaks.</p>
      ) : (
        <ol class="family-list" aria-label="Likely materials, best first">
          {ranking.map(({ family, best }) => (
            <li key={family.id}>
              <button type="button" class="family-button" onClick={() => onChoose(family)}>
                <span class="family-name">{family.name}</span>
                <span class="family-formula">
                  best: {best?.phase.name} ({Math.round((best?.match.score ?? 0) * 100)} %)
                </span>
                <span class="family-count">Choose</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
