import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { DEFAULT_MATCH, matchPhase, referenceLines } from '../../core/xrd/reference/match';
import {
  describeQuery,
  hillFormula,
  parseFormula,
  parseQuery,
  searchPhases,
  type PhaseQuery,
} from '../../core/xrd/reference/search';
import { phaseReference } from '../../core/xrd/reference/source';
import type {
  ReferenceIndexEntry,
  ReferenceIndexPhase,
  ReferencePhase,
} from '../../core/xrd/reference/types';
import { ANODES } from '../../core/xrd/radiation';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { readCifFile } from './cifClient';
import { CodSearch } from './CodSearch';
import { DEFAULT_MATERIAL, type MaterialState, type XrdData } from './data';
import { codUrl, familyOf, libraryIndex, loadReferenceFamily } from './referenceLibrary';
import { useMeasured } from './useMeasured';

/** Search hits shown at first; more on request. */
const FIRST_HITS = 24;

const GUIDE_NOTE =
  'A guide only. Works for simple, well-separated phases; not reliable for mixtures.';

/** A phase as shown in lists: from the index (library) or a loaded CIF. */
interface ListedPhase {
  id: string;
  name: string;
  formula: string;
  crystalSystem: string;
  spaceGroup: string;
  spaceGroupNumber: number;
  cell: ReferenceIndexPhase['cell'];
  source: string;
  codId: number | null;
  notes: readonly { level: string; text: string }[];
}

const fromIndex = (phase: ReferenceIndexPhase): ListedPhase => ({
  ...phase,
  source: `COD ${phase.codId}`,
  notes: [],
});

const fromCif = (phase: ReferencePhase): ListedPhase => ({
  id: phase.id,
  name: phase.name,
  formula: phase.formula,
  crystalSystem: phase.crystalSystem,
  spaceGroup: phase.spaceGroup.hm,
  spaceGroupNumber: phase.spaceGroup.number,
  cell: phase.cell,
  source: phaseReference(phase),
  codId: phase.codId,
  notes: phase.origin?.kind === 'cif' ? (phase.origin.notes ?? []) : [],
});

/** A COD search page for what was typed (formula or elements), checked to work in October 2026. */
function codSearchUrl(query: PhaseQuery): string | null {
  const base = 'https://www.crystallography.net/cod/result';
  if (query.kind === 'formula') {
    const counts = parseFormula(query.formula);
    return counts ? `${base}?formula=${encodeURIComponent(hillFormula(counts))}` : null;
  }
  if (query.kind === 'chemicalSystem' || query.kind === 'elements') {
    const params = query.elements.map((e, i) => `el${i + 1}=${e}`).join('&');
    return query.kind === 'chemicalSystem'
      ? `${base}?${params}&nel=${query.elements.length}`
      : `${base}?${params}`;
  }
  return null;
}

function cellText(cell: ListedPhase['cell'], system: string): string {
  const len = (v: number) => formatNumber(v, 4);
  const ang = (v: number) => formatNumber(v, 3);
  switch (system) {
    case 'cubic':
      return `a = ${len(cell.a)} Å`;
    case 'tetragonal':
    case 'hexagonal':
    case 'trigonal':
      return `a = ${len(cell.a)}, c = ${len(cell.c)} Å`;
    case 'orthorhombic':
      return `a = ${len(cell.a)}, b = ${len(cell.b)}, c = ${len(cell.c)} Å`;
    default:
      return `a = ${len(cell.a)}, b = ${len(cell.b)}, c = ${len(cell.c)} Å, α = ${ang(cell.alpha)}°, β = ${ang(cell.beta)}°, γ = ${ang(cell.gamma)}°`;
  }
}

/** Wizard step 3: search for the phases the sample may contain, or load their CIF files. */
export function MaterialStep({ data, update }: StepContext<XrdData>) {
  const material = data.material;
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(FIRST_HITS);
  const [unknown, setUnknown] = useState(false);
  const setMaterial = (patch: Partial<MaterialState>) =>
    update({ material: { ...material, ...patch } });

  const parsed = useMemo(() => parseQuery(query), [query]);
  const hits = useMemo(() => searchPhases(libraryIndex.families, query), [query]);
  useEffect(() => setShown(FIRST_HITS), [query]);

  const isCandidate = (id: string) => material.candidates.includes(id);
  const add = (id: string) => {
    if (isCandidate(id)) return;
    setMaterial({ candidates: [...material.candidates, id] });
  };
  const remove = (id: string) =>
    setMaterial({
      candidates: material.candidates.filter((c) => c !== id),
      phaseIds: material.phaseIds.filter((p) => p !== id),
      hidden: material.hidden.filter((h) => h !== id),
      userPhases: material.userPhases.filter((p) => p.id !== id),
    });
  // A phase loaded again (for example a COD entry removed and added back) replaces the old copy.
  const addCifPhases = (phases: ReferencePhase[]) => {
    const ids = new Set(phases.map((p) => p.id));
    setMaterial({
      userPhases: [...material.userPhases.filter((p) => !ids.has(p.id)), ...phases],
      candidates: [...material.candidates.filter((id) => !ids.has(id)), ...ids],
    });
  };
  const candidateCodIds = new Set(
    material.userPhases
      .filter((p) => material.candidates.includes(p.id) && p.codId !== null)
      .map((p) => p.codId as number),
  );

  const candidates: ListedPhase[] = material.candidates.flatMap((id) => {
    const family = familyOf(id);
    const indexed = family?.phases.find((p) => p.id === id);
    if (indexed) return [fromIndex(indexed)];
    const loaded = material.userPhases.find((p) => p.id === id);
    return loaded ? [fromCif(loaded)] : [];
  });
  const codLink = codSearchUrl(parsed);

  return (
    <div class="material-step">
      <p class="field-hint">
        Choose every phase your sample might contain. The next step draws their calculated lines
        under your pattern and scores how well each one fits. Search the built-in library (
        {libraryIndex.families.reduce((n, f) => n + f.phases.length, 0)} phases calculated from the
        Crystallography Open Database), or load the CIF file of any other structure. You can skip
        this step if you do not need reference phases.{' '}
        <HelpTip term="reference pattern">
          <p>
            A reference pattern is the list of diffraction lines a known crystal structure should
            give: where each line is (2θ, from its d-spacing and your X-ray wavelength) and how
            strong it is. It is calculated here from the structure (cell, symmetry and atom
            positions) with the kinematic model, so it can differ from a measured card in relative
            intensities, for example when your sample has preferred orientation.
          </p>
        </HelpTip>
      </p>

      <section class="material-section" aria-labelledby="search-title">
        <h3 id="search-title" class="export-title">
          Search the library
        </h3>
        <div class="material-search">
          <label class="inline-field material-query">
            Formula, elements, name, COD ID or space group
            <input
              type="search"
              value={query}
              placeholder="for example BiVO4, Bi-V-O, anatase, 9009086, P21/c"
              autocomplete="off"
              spellcheck={false}
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
        <p class="field-hint" role="status">
          {describeQuery(parsed)} {hits.length} phase{hits.length === 1 ? '' : 's'} found.{' '}
          <HelpTip term="search">
            <p>
              A formula (BiVO4, Fe2O3, Ni(OH)2) finds phases of that composition in any element
              order. Elements joined by hyphens (Bi-V-O) find phases made of exactly those elements,
              as in the Materials Project; elements separated by spaces (Bi V) find phases that
              contain them all. A 7-digit number is a COD ID; a number up to 230 or a symbol such as
              P21/c is a space group. Anything else is matched against names and minerals.
            </p>
          </HelpTip>
        </p>

        {unknown ? (
          <UnknownGuide data={data} onAdd={add} isCandidate={isCandidate} />
        ) : hits.length === 0 ? (
          <p class="message is-info">
            <strong>Not in the library.</strong> Load the structure as a CIF file below.
            {codLink && (
              <>
                {' '}
                <a href={codLink} target="_blank" rel="noopener noreferrer">
                  Search COD for “{query.trim()}”
                </a>{' '}
                (opens a new tab) and download a CIF from the result list.
              </>
            )}
          </p>
        ) : (
          <>
            <ul class="phase-results" aria-label="Search results">
              {hits.slice(0, shown).map(({ family, phase }) => (
                <PhaseRow
                  key={phase.id}
                  phase={fromIndex(phase)}
                  family={family}
                  action={
                    <button
                      type="button"
                      class={isCandidate(phase.id) ? 'btn' : 'btn btn-primary'}
                      aria-pressed={isCandidate(phase.id)}
                      aria-label={`${isCandidate(phase.id) ? 'Remove' : 'Add'} ${phase.name}`}
                      onClick={() => (isCandidate(phase.id) ? remove(phase.id) : add(phase.id))}
                    >
                      {isCandidate(phase.id) ? 'Added ✓' : 'Add'}
                    </button>
                  }
                />
              ))}
            </ul>
            {hits.length > shown && (
              <button type="button" class="btn btn-quiet" onClick={() => setShown(shown * 2)}>
                Show more ({hits.length - shown} left)
              </button>
            )}
          </>
        )}
      </section>

      <CodSearch onLoaded={addCifPhases} loadedIds={candidateCodIds} />

      <CifLoader onLoaded={addCifPhases} codLink={codLink} query={query.trim()} />

      <section class="material-section" aria-labelledby="candidates-title">
        <h3 id="candidates-title" class="export-title">
          Your candidate phases ({candidates.length})
        </h3>
        {candidates.length === 0 ? (
          <p class="field-hint">
            None yet. Add phases from the search results or load CIF files; step 4 then compares
            them with your pattern.
          </p>
        ) : (
          <ul class="phase-results" aria-label="Candidate phases">
            {candidates.map((phase) => (
              <PhaseRow
                key={phase.id}
                phase={phase}
                action={
                  <button
                    type="button"
                    class="btn"
                    aria-label={`Remove ${phase.name}`}
                    onClick={() => remove(phase.id)}
                  >
                    Remove
                  </button>
                }
              >
                <label class="inline-field phase-jcpds">
                  JCPDS/ICDD card number (typed by you, not verified)
                  <input
                    value={material.jcpds[phase.id] ?? ''}
                    autocomplete="off"
                    placeholder="optional"
                    onInput={(e) =>
                      setMaterial({
                        jcpds: { ...material.jcpds, [phase.id]: e.currentTarget.value },
                      })
                    }
                  />
                </label>
              </PhaseRow>
            ))}
          </ul>
        )}
        {candidates.length > 0 && (
          <p>
            <button
              type="button"
              class="btn btn-quiet"
              onClick={() =>
                update({ material: { ...DEFAULT_MATERIAL, toleranceDeg: material.toleranceDeg } })
              }
            >
              Remove all candidates
            </button>
          </p>
        )}
      </section>
    </div>
  );
}

interface PhaseRowProps {
  phase: ListedPhase;
  family?: ReferenceIndexEntry;
  action: ComponentChildren;
  children?: ComponentChildren;
}

/** One phase with its structure details, source link and an action button. */
function PhaseRow({ phase, family, action, children }: PhaseRowProps) {
  return (
    <li class="phase-result">
      <div class="phase-result-text">
        <p class="phase-result-name">
          <strong>{phase.name}</strong> <span class="phase-result-formula">{phase.formula}</span>
          {family && family.phases.length > 1 && (
            <span class="phase-result-family"> · {family.name}</span>
          )}
        </p>
        <p class="phase-result-meta">
          {phase.crystalSystem}, {phase.spaceGroup}
          {phase.spaceGroupNumber > 0 && ` (No. ${phase.spaceGroupNumber})`} ·{' '}
          {cellText(phase.cell, phase.crystalSystem)} ·{' '}
          {phase.codId !== null ? (
            <a href={codUrl(phase.codId)} target="_blank" rel="noopener noreferrer">
              {phase.source}
            </a>
          ) : (
            phase.source
          )}
        </p>
        {phase.notes.map((n, i) => (
          <p key={i} class={`message is-${n.level}`}>
            {n.text}
          </p>
        ))}
        {children}
      </div>
      <div class="phase-result-action">{action}</div>
    </li>
  );
}

/** Loads CIF files and calculates their lines in a worker. */
function CifLoader({
  onLoaded,
  codLink,
  query,
}: {
  onLoaded: (phases: ReferencePhase[]) => void;
  codLink: string | null;
  query: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ name: string; error: string }[]>([]);
  const [dragging, setDragging] = useState(false);

  const load = async (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    setBusy(
      files.length === 1
        ? `Calculating ${files[0]?.name}…`
        : `Calculating ${files.length} structures…`,
    );
    const results = await Promise.all(
      files.map((file) => readCifFile(file, `cif-${crypto.randomUUID()}`)),
    );
    const loaded: ReferencePhase[] = [];
    const failed: { name: string; error: string }[] = [];
    results.forEach((r, i) => {
      if (r.ok) {
        const origin = r.phase.origin;
        loaded.push({
          ...r.phase,
          ...(origin?.kind === 'cif' && { origin: { ...origin, notes: r.notes } }),
        });
      } else failed.push({ name: files[i]?.name ?? 'file', error: r.error });
    });
    if (loaded.length > 0) onLoaded(loaded);
    setProblems(failed);
    setBusy(
      loaded.length > 0
        ? `Added ${loaded.map((p) => p.name).join(', ')} to your candidates.`
        : null,
    );
  };

  return (
    <section class="material-section" aria-labelledby="cif-title">
      <h3 id="cif-title" class="export-title">
        Load a structure (CIF){' '}
        <HelpTip term="CIF">
          <p>
            A CIF (Crystallographic Information File) holds a crystal structure: the cell, the
            symmetry and the atom positions. Its powder pattern is calculated here, in your browser,
            with the same model as the built-in library. The file never leaves your device.
          </p>
        </HelpTip>
      </h3>
      <div
        class={`drop-zone${dragging ? ' is-dragging' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void load(e.dataTransfer?.files ?? null);
        }}
      >
        <p class="field-hint">
          Drop .cif files here, from the Crystallography Open Database, the Materials Project, ICSD,
          a refinement or a paper's supporting information.
        </p>
        <button type="button" class="btn" onClick={() => input.current?.click()}>
          Choose CIF files
        </button>
        <input
          ref={input}
          type="file"
          accept=".cif,chemical/x-cif"
          multiple
          class="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void load(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </div>
      <p class="upload-status" role="status">
        {busy}
      </p>
      {problems.length > 0 && (
        <div class="import-problems" role="alert">
          <ul>
            {problems.map((p, i) => (
              <li key={i}>
                <strong>{p.name}:</strong> {p.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p class="field-hint">
        Where to find a CIF:{' '}
        {codLink ? (
          <a href={codLink} target="_blank" rel="noopener noreferrer">
            COD search for “{query}”
          </a>
        ) : (
          <a
            href="https://www.crystallography.net/cod/search.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Crystallography Open Database
          </a>
        )}{' '}
        (free, experimental structures) or{' '}
        <a
          href="https://next-gen.materialsproject.org/materials"
          target="_blank"
          rel="noopener noreferrer"
        >
          Materials Project
        </a>{' '}
        (free account; calculated structures, whose cells are often slightly larger than measured
        ones). Links open in a new tab and send nothing about your data.{' '}
        <HelpTip term="online databases">
          <p>
            This site cannot search these databases for you: they do not allow requests from other
            websites (checked in October 2026), and the site has no server to relay them, by design,
            so your data stay on your device. Search there, download the CIF, and load it here.
          </p>
        </HelpTip>
      </p>
    </section>
  );
}

/** Library phases ranked by how well their lines agree with the measured peaks. */
function UnknownGuide({
  data,
  onAdd,
  isCandidate,
}: {
  data: XrdData;
  onAdd: (id: string) => void;
  isCandidate: (id: string) => boolean;
}) {
  const [patternId, setPatternId] = useState(data.patterns[0]?.id);
  const { pattern, processed, detected } = useMeasured(data, patternId);
  const [library, setLibrary] = useState<ReferencePhase[] | null>(null);
  useEffect(() => {
    let current = true;
    Promise.all(libraryIndex.families.map((f) => loadReferenceFamily(f.file))).then(
      (all) => current && setLibrary(all.flat()),
      () => current && setLibrary([]),
    );
    return () => {
      current = false;
    };
  }, []);

  const ranking = useMemo(() => {
    if (!library || !processed || !detected) return null;
    const lambda = ANODES[data.radiation.anode].kAlpha1;
    const range = [
      processed.twoTheta[0] as number,
      processed.twoTheta[processed.twoTheta.length - 1] as number,
    ] as const;
    const peaks = detected.map((p) => p.center);
    return library
      .map((phase) => ({
        phase,
        match: matchPhase(referenceLines(phase, lambda), peaks, range, DEFAULT_MATCH),
      }))
      .filter((r) => r.match.score > 0)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, 10);
  }, [library, processed, detected, data.radiation.anode]);

  return (
    <section class="unknown-guide" aria-labelledby="unknown-title">
      <h4 id="unknown-title" class="export-title">
        Library phases whose strongest lines fall near your peaks
      </h4>
      <p class="message is-info">
        <strong>Note:</strong> {GUIDE_NOTE} This is an estimate from the peaks found in your cleaned
        pattern, not an identification, and only phases in the library can appear.
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
        <p>No phase in the library has lines near your peaks.</p>
      ) : (
        <ol class="family-list" aria-label="Likely phases, best first">
          {ranking.map(({ phase, match }) => (
            <li key={phase.id}>
              <button
                type="button"
                class="family-button"
                aria-pressed={isCandidate(phase.id)}
                onClick={() => onAdd(phase.id)}
              >
                <span class="family-name">{phase.name}</span>
                <span class="family-formula">
                  {phase.formula}, score {Math.round(match.score * 100)} %
                </span>
                <span class="family-count">{isCandidate(phase.id) ? 'Added ✓' : 'Add'}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
