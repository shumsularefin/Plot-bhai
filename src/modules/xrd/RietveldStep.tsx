import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DEFAULT_PROCESSING, type ProcessingSettings } from '../../core/xrd/process/pipeline';
import { ANODES } from '../../core/xrd/radiation';
import { formatHkl } from '../../core/xrd/reference/hkl';
import { phaseReference } from '../../core/xrd/reference/source';
import type { ReferencePhase } from '../../core/xrd/reference/types';
import type { Hkl } from '../../core/xrd/rietveld/reflections';
import {
  DEFAULT_CHOICES,
  type Estimate,
  type RefineChoices,
  type RietveldInput,
  type RietveldResult,
} from '../../core/xrd/rietveld/refine';
import { rietveldMethods, withUncertainty } from '../../core/xrd/rietveld/report';
import { Advanced } from '../../ui/Advanced';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { ReferenceLane } from '../../ui/plot/ReferenceLanes';
import type { SeriesSource } from '../../ui/plot/series';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from './csv';
import {
  DEFAULT_OPTICS,
  DEFAULT_RIETVELD,
  processingFor,
  type RietveldState,
  type XrdData,
} from './data';
import { RietveldSetup } from './RietveldSetup';
import { BondsSection } from './BondsSection';
import { SeriesSection } from './SeriesSection';
import type { SeriesPattern, SeriesRequest } from '../../workers/rietveld.worker';
import { SubstitutionPanel, validSubstitutions } from './SubstitutionPanel';
import { parseRanges, polarisationOf } from './rietveldSettings';
import { xrdLabels } from './labels';
import { NumberInput } from './NumberInput';
import { RietveldClient } from './rietveldClient';
import { useProcessed } from './useProcessed';
import { useCandidatePhases } from './useReferencePhases';
import { ATOMIC_WEIGHTS } from './atomicWeights';

const PHASE_COLORS = [0, 1, 2, 3, 4, 5, 6];

const CHOICE_LABELS: [keyof RefineChoices, string, string][] = [
  ['zero', 'Zero shift', 'A constant 2θ offset of the instrument.'],
  [
    'displacement',
    'Sample displacement',
    'A 2θ shift that falls off as cos θ, from a sample surface above or below the focusing circle. It is strongly correlated with the zero shift: refine both only with a wide 2θ range.',
  ],
  ['cell', 'Unit cells', 'Cell lengths and angles, keeping the symmetry of each phase.'],
  ['width', 'Peak width W and shape η', 'The width of every peak and its Lorentzian fraction.'],
  ['widthSlope', 'Width against angle (U, V)', 'How the width changes with 2θ (Caglioti U and V).'],
  [
    'tch',
    'GSAS-II peak shape (TCH)',
    'Thompson–Cox–Hastings pseudo-Voigt, as in GSAS-II: a Gaussian width from U, V, W and a separate Lorentzian width X/cos θ + Y tan θ, instead of one width and a mixing η. Choose it to continue the refinement in GSAS-II with exactly the same peak shape.',
  ],
  [
    'asymmetry',
    'Peak asymmetry',
    'Lopsided peaks at low angles, from the beam spreading along the sample axis (Bérar–Baldinozzi P1 and P2). Turn it on only when the difference curve shows a wave under each low-angle peak.',
  ],
  [
    'axialDivergence',
    'Axial divergence (SH/L)',
    'The same low-angle asymmetry described physically, as in GSAS-II: the Finger–Cox–Jephcoat profile with one parameter SH/L, the sum of the sample and detector heights over the goniometer radius. It is an instrument property: refine it on a standard and keep it in the fixed instrument profile. Choose this or Peak asymmetry, not both.',
  ],
  [
    'orientation',
    'Preferred orientation',
    'March–Dollase correction along the direction you type for each phase below.',
  ],
  [
    'size',
    'Crystallite size',
    'Size broadening of each phase, as in GSAS-II: an extra Lorentzian width (180/π)·λ/(D cos θ), so D uses a Scherrer constant of 1 on the full width at half maximum. Fix the instrument profile from a standard (below) so that D is the sample’s own size.',
  ],
  [
    'strain',
    'Microstrain',
    'Strain broadening of each phase, as in GSAS-II: an extra width (180/π)·10⁻⁶·μ·tan θ, with μ the microstrain in GSAS-II’s units (10⁻⁶).',
  ],
  [
    'sampleMix',
    'Lorentzian fractions of size and strain',
    'How much of the size and strain broadening is Lorentzian (1, GSAS-II’s default) rather than Gaussian. Refine only with very good data.',
  ],
  [
    'transparency',
    'Sample transparency',
    'Peaks shifted to low angle because the X-rays go deep into a weakly absorbing sample (organic materials, polymers, light oxides): Δ2θ = T·sin 2θ. Correlated with the zero shift and the sample displacement.',
  ],
  [
    'overallB',
    'Overall displacement factor B',
    'Thermal vibration on top of the values in the reference structures. Strongly correlated with the background; refine it last and only with good data to high angle.',
  ],
  [
    'roughness',
    'Surface roughness',
    'Suortti correction (as in GSAS-II) for a rough or porous sample surface, which lowers the intensity at low angle. Without it a rough sample can give negative B values. Strongly correlated with B. Flat samples only.',
  ],
  [
    'absorption',
    'Capillary absorption μR',
    'Refines μR of a capillary sample (set the geometry under “Instrument, sample and quantification”). μR is strongly correlated with the displacement parameters B: prefer typing the value calculated from the composition, packing and capillary radius and keeping it fixed.',
  ],
  [
    'berarLelann',
    'Apply the Bérar–Lelann factor to the ±',
    'Not a refined parameter: every standard uncertainty (±), also those of bond lengths, weight fractions and series lines, is multiplied by the Bérar–Lelann factor of the fit, which allows for neighbouring points of the difference curve being correlated. Leave it off to compare the ± with GSAS-II, which reports them unmultiplied. Only meaningful when the intensities are raw counts.',
  ],
];

/** The cleaning steps switched on, in words, for the plot legend and the methods text. */
function cleaningNames(p: ProcessingSettings): string[] {
  return [
    p.zeroShift.enabled && `zero shift ${p.zeroShift.shiftDeg}°`,
    p.smoothing.enabled && 'smoothing',
    p.background.enabled && 'background removed',
    p.kAlpha2.enabled && 'Kα2 stripped',
  ].filter((s): s is string => typeof s === 'string');
}

/** "0 0 1", "001" or "1,0,0" as (h k l); null when empty or not three integers. */
function parseDirection(text: string): Hkl | null {
  const parts =
    text.trim().includes(' ') || text.includes(',')
      ? text.trim().split(/[\s,]+/)
      : [...text.trim()];
  if (parts.length !== 3) return null;
  const values = parts.map(Number);
  if (!values.every(Number.isInteger) || values.every((v) => v === 0)) return null;
  return values as Hkl;
}

const pct = (e: Estimate | null) => (e ? withUncertainty(100 * e.value, 100 * e.esd, 2) : '–');
type StructureChoice = 'positions' | 'occupancy' | 'biso' | 'aniso' | 'restraints';
const STRUCTURE_LABELS: [StructureChoice, string, string][] = [
  [
    'positions',
    'Atom positions',
    'Moves each atom only along the directions its site symmetry allows (an atom on a centre of symmetry does not move). Needs good data to high angle.',
  ],
  [
    'restraints',
    'Keep bond lengths (restraints)',
    'Adds each starting bond as an extra observation with σ = 0.02 Å, so the atoms cannot drift into unphysical positions. Recommended with lab data.',
  ],
  [
    'occupancy',
    'Site occupancies',
    'The fraction of each site that is filled. Only sites the file gives as partly filled (below 1) are refined; full sites stay at 1. Strongly correlated with B.',
  ],
  [
    'biso',
    'Atomic displacement B',
    'Thermal vibration of each atom (isotropic B = 8π²U). Atoms with anisotropic values in the file keep them. Replaces the overall B.',
  ],
  [
    'aniso',
    'Anisotropic displacement U_ij',
    'Direction-dependent vibration of every atom (isotropic atoms are converted), only in the directions the site symmetry allows. Needs excellent data to high angle; with lab data it is usually not justified.',
  ],
];

const num = (e: Estimate, fixed = 5) => withUncertainty(e.value, e.esd, fixed);

/** Crystallite size in nm, or a plain note when no size broadening was found. */
const sizeText = (e: Estimate | null) =>
  !e ? '–' : Number.isFinite(e.value) ? withUncertainty(e.value, e.esd, 1) : 'too large to measure';

/** Wizard step 5: basic Rietveld refinement of the candidate phases (optional). */
export function RietveldStep({ data, update }: StepContext<XrdData>) {
  const settings = data.rietveld ?? DEFAULT_RIETVELD;
  const set = (patch: Partial<RietveldState>) => update({ rietveld: { ...settings, ...patch } });
  const { phases, failed } = useCandidatePhases(data.material);
  const pattern = data.patterns.find((p) => p.id === settings.patternId) ?? data.patterns[0];
  const included = (phases ?? []).filter((p) => !settings.excluded.includes(p.id));
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = useRef<RietveldClient | null>(null);
  useEffect(() => {
    client.current = new RietveldClient();
    return () => client.current?.dispose();
  }, []);

  // The cleaned data without normalisation: scaling to 1 or 100 would spoil the 1/counts weights.
  const useCleaned = settings.useCleaned ?? true;
  const stored = pattern ? processingFor(data, pattern.id) : null;
  const cleaning = useMemo(
    () => stored && { ...stored, normalise: { ...stored.normalise, enabled: false } },
    [stored],
  );
  const { result: processed } = useProcessed(
    useCleaned && cleaning ? pattern : undefined,
    cleaning ?? DEFAULT_PROCESSING,
    data.radiation,
  );
  const measured = useMemo(
    () =>
      pattern && !useCleaned
        ? { x: pattern.twoTheta, y: pattern.intensity }
        : processed && { x: processed.twoTheta, y: processed.intensity },
    [pattern, useCleaned, processed],
  );
  const cleaningSteps = cleaning ? cleaningNames(cleaning) : [];

  const lines = ANODES[data.radiation.anode];
  // Kα2 stripped from the data must not be put back by the model.
  const ratio =
    data.radiation.kAlpha1Only || (useCleaned && cleaning?.kAlpha2.enabled)
      ? 0
      : data.radiation.kAlpha2Ratio;
  const textureOf = (phase: ReferencePhase) =>
    settings.choices.orientation ? (settings.texture?.[phase.id] ?? 0) : 0;
  const orientationOf = (phase: ReferencePhase) =>
    textureOf(phase) > 0 ? null : parseDirection(settings.orientation[phase.id] ?? '');
  const axisOf = (phase: ReferencePhase): Hkl =>
    parseDirection(settings.axes?.[phase.id] ?? '') ?? [0, 0, 1];
  const uniaxial = Boolean(
    (settings.choices.size && settings.choices.sizeModel === 'uniaxial') ||
    (settings.choices.strain && settings.choices.strainModel === 'uniaxial'),
  );
  const optics = settings.optics ?? DEFAULT_OPTICS;
  const capillary = optics.capillary === true;
  const anomalous = optics.anomalous === true;
  const polarisation = polarisationOf(optics, lines.kAlpha1);
  const ranges = parseRanges(settings.excludedRanges ?? '');
  // A cell from indexing has no structure and equal starting intensities: always Le Bail.
  const isIndexed = (phase: ReferencePhase) => phase.origin?.kind === 'indexed';
  const leBail = [
    ...(settings.leBail ?? []).filter((id) => !included.some((p) => p.id === id && isIndexed(p))),
    ...included.filter(isIndexed).map((p) => p.id),
  ];
  const instrument = settings.instrument ?? null;
  const standard = settings.standard ?? null;
  const standardPhase = standard && included.find((p) => p.id === standard.phaseId);
  // The TCH profile is needed for a fixed instrument and for size and strain broadening.
  const tchForced = Boolean(instrument || settings.choices.size || settings.choices.strain);
  const sharedParts = [
    included.map((p) => [p.id, orientationOf(p), textureOf(p), uniaxial && axisOf(p)]),
    settings.choices,
    settings.backgroundTerms,
    settings.from,
    settings.to,
    data.radiation,
    polarisation,
    optics.variableSlit,
    capillary && optics.muR,
    anomalous,
    ranges,
    instrument?.profile,
    leBail.filter((id) => included.some((p) => p.id === id)),
    standardPhase && standard?.percent,
    included.map((p) => validSubstitutions(p, settings.substitutions?.[p.id])),
  ];
  // The single refinement's key keeps its order from before the series existed (saved results).
  const key = JSON.stringify([
    pattern?.id,
    ...sharedParts.slice(0, 6),
    useCleaned && cleaning,
    ...sharedParts.slice(6),
  ]);
  const seriesKey = JSON.stringify([
    sharedParts,
    useCleaned,
    data.patterns.map((p) => useCleaned && processingFor(data, p.id)),
  ]);
  const result: RietveldResult | null =
    settings.result?.outcome.ok === true ? settings.result.outcome : null;
  const stale = settings.result !== null && settings.result.key !== key;

  const methodsOf = (outcome: RietveldResult) =>
    `${rietveldMethods({
      result: outcome,
      choices: settings.choices,
      backgroundTerms: settings.backgroundTerms,
      phases: outcome.phases.map((r) => {
        const phase = included.find((p) => p.id === r.id);
        return { name: r.name, reference: phase ? phaseReference(phase) : 'reference structure' };
      }),
      radiation:
        ratio > 0
          ? `${data.radiation.anode} Kα1/Kα2 radiation (λ = ${lines.kAlpha1}, ${lines.kAlpha2} Å, intensity ratio ${ratio})`
          : `${data.radiation.anode} Kα1 radiation (λ = ${lines.kAlpha1} Å)`,
      ...(optics.monochromator === 'graphite' && {
        monochromator: 'a graphite (002) diffracted-beam monochromator',
      }),
      ...(optics.monochromator === 'germanium' && {
        monochromator: 'a germanium (111) incident-beam monochromator',
      }),
      variableSlit: optics.variableSlit,
      capillary,
      ...(instrument && { instrumentSource: instrument.source }),
    })} ${
      useCleaned && cleaningSteps.length > 0
        ? `The refinement was made on the cleaned data (${cleaningSteps.join(', ')}), so R_exp and χ² do not follow counting statistics exactly.`
        : 'The refinement was made on the unprocessed data.'
    }`;

  /** Everything but the data: the same for the single refinement and every pattern of a series. */
  const sharedInput = (): Omit<RietveldInput, 'x' | 'y'> => ({
    wavelengths: {
      kAlpha1: lines.kAlpha1,
      kAlpha2: lines.kAlpha2,
      ratio,
      polarisation,
      variableSlit: optics.variableSlit,
      ...(capillary && { capillary: true }),
    },
    ...(capillary && { muR: optics.muR ?? 0 }),
    phases: included.map((p) => ({
      id: p.id,
      name: p.name,
      crystalSystem: p.crystalSystem,
      cell: p.cell,
      peaks: p.peaks,
      ...(p.cellContents && { cellContents: p.cellContents }),
      ...(p.structure && { structure: p.structure }),
      orientation: settings.choices.orientation ? orientationOf(p) : null,
      ...(textureOf(p) > 0 && { textureOrder: textureOf(p) }),
      spaceGroupNumber: p.spaceGroup.number,
      sizeAxis: axisOf(p),
      strainAxis: axisOf(p),
      ...(leBail.includes(p.id) && { leBail: true }),
      ...(!leBail.includes(p.id) && {
        substitutions: validSubstitutions(p, settings.substitutions?.[p.id]),
      }),
    })),
    choices: settings.choices,
    backgroundTerms: settings.backgroundTerms,
    atomicWeights: ATOMIC_WEIGHTS,
    ...(instrument && { instrument: instrument.profile }),
    ...(ranges && ranges.length > 0 && { excluded: ranges }),
    ...(standardPhase &&
      standard?.percent != null && {
        standard: { phaseId: standardPhase.id, fraction: standard.percent / 100 },
      }),
  });

  /** One pattern of a series, with its own cleaning and the Kα2 ratio that goes with it. */
  const seriesPattern = (id: string, value: number): SeriesPattern | null => {
    const p = data.patterns.find((q) => q.id === id);
    if (!p) return null;
    const own = processingFor(data, id);
    const stripped = useCleaned && own.kAlpha2.enabled;
    return {
      id,
      name: p.name,
      value,
      twoTheta: p.twoTheta,
      intensity: p.intensity,
      cleaning: useCleaned ? { ...own, normalise: { ...own.normalise, enabled: false } } : null,
      ratio: data.radiation.kAlpha1Only || stripped ? 0 : data.radiation.kAlpha2Ratio,
    };
  };
  const seriesRequest = (patterns: SeriesPattern[], copyForward: boolean): SeriesRequest | null =>
    included.length === 0
      ? null
      : {
          base: sharedInput(),
          patterns,
          radiation: data.radiation,
          from: settings.from ?? -Infinity,
          to: settings.to ?? Infinity,
          copyForward,
        };

  const run = async () => {
    if (!measured || included.length === 0 || !client.current) return;
    const lo = settings.from ?? -Infinity;
    const hi = settings.to ?? Infinity;
    const keep: number[] = [];
    measured.x.forEach((x, i) => {
      if (x >= lo && x <= hi) keep.push(i);
    });
    const input: RietveldInput = {
      x: Float64Array.from(keep, (i) => measured.x[i] as number),
      y: Float64Array.from(keep, (i) => measured.y[i] as number),
      ...sharedInput(),
    };
    setError(null);
    setStage('Starting');
    const outcome = await client.current.refine(
      input,
      setStage,
      anomalous ? data.radiation.anode : undefined,
    );
    setStage(null);
    if (!outcome) return;
    if (!outcome.ok) setError(outcome.error);
    else set({ result: { key, outcome, methods: methodsOf(outcome) } });
  };

  const colorOf = (id: string) =>
    PHASE_COLORS[
      Math.max(
        0,
        included.findIndex((p) => p.id === id),
      ) % PHASE_COLORS.length
    ] as number;
  const unit = pattern?.intensityUnit === 'counts' ? 'counts' : 'cps';
  const sources = useMemo<SeriesSource[]>(() => {
    if (!pattern) return [];
    if (!result)
      return measured
        ? [
            {
              id: 'obs',
              name: useCleaned ? `${pattern.name} (cleaned)` : pattern.name,
              x: measured.x,
              y: measured.y,
              unit,
              colorIndex: 7,
            },
          ]
        : [];
    const x = Float64Array.from(result.x);
    return [
      {
        id: 'obs',
        name: 'Measured',
        x,
        y: Float64Array.from(result.observed),
        unit,
        colorIndex: 7,
      },
      {
        id: 'calc',
        name: 'Calculated',
        x,
        y: Float64Array.from(result.calculated),
        unit,
        colorIndex: 1,
      },
      {
        id: 'bg',
        name: 'Background',
        x,
        y: Float64Array.from(result.background),
        unit,
        colorIndex: 6,
        dashed: true,
      },
    ];
  }, [pattern, result, unit, measured, useCleaned]);
  const residual = useMemo<SeriesSource | undefined>(
    () =>
      result
        ? {
            id: 'diff',
            name: 'Measured − calculated',
            x: Float64Array.from(result.x),
            y: Float64Array.from(result.observed, (v, i) => v - (result.calculated[i] as number)),
            unit,
            colorIndex: 7,
          }
        : undefined,
    [result, unit],
  );
  const lanes = useMemo<ReferenceLane[]>(
    () =>
      (result?.phases ?? []).map((phase) => ({
        id: phase.id,
        name: `${phase.name} (refined positions)`,
        colorIndex: colorOf(phase.id),
        lines: phase.ticks.map((t) => ({ x: t.twoTheta, height: 0.6 })),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- colours follow the result's phases
    [result],
  );

  if (!pattern) return <p>No patterns are loaded. Go back to Upload to add one.</p>;
  if (data.material.candidates.length === 0)
    return (
      <p class="message is-info">
        <strong>Note:</strong> no candidate phase is chosen, so there is nothing to refine. Choose
        phases in step 3, or skip this optional step with Next.
      </p>
    );
  if (failed)
    return (
      <p class="message is-error">
        <strong>Problem:</strong> the reference phases could not be loaded. Reload the page, or skip
        this optional step.
      </p>
    );

  return (
    <div class="rietveld-step">
      <p class="message is-info">
        <strong>Optional.</strong> Fits the whole calculated pattern of your phases to the measured
        one: scale, background, zero shift, cell and peak shape, and weight fractions for mixtures.
        Atom positions stay as in the reference unless you turn on structure refinement under What
        to refine. Skip it with Next if you only need peak fitting.{' '}
        <HelpTip term="Rietveld refinement">
          <p>
            Every reflection of every phase is drawn with a peak shape whose width follows FWHM² = U
            tan²θ + V tanθ + W, and its intensity comes from the reference structure. The parameters
            are refined in stages by weighted least squares (weights 1/counts). By default it uses
            your cleaned data from step 2 (without normalisation), so the plot matches what you
            prepared; a background and zero shift are still refined on top. Smoothing and background
            removal change the counting statistics, so R_exp and χ² are then only indicative; for
            strict statistics refine the uploaded data instead.
          </p>
        </HelpTip>
      </p>

      {pattern.synthetic && (
        <p class="field-hint">
          The example patterns are calculated from the zinc oxide structure (COD 1577381), so that
          phase fits them. A measured pattern never fits this cleanly.
        </p>
      )}

      {data.patterns.length > 1 && (
        <label class="inline-field">
          Pattern
          <select
            value={pattern.id}
            onChange={(e) => set({ patternId: e.currentTarget.value, result: null })}
          >
            {data.patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset class="method-choice">
        <legend>Data to refine</legend>
        <label class="check">
          <input
            type="radio"
            name="rietveld-data"
            checked={useCleaned}
            onChange={() => set({ useCleaned: true })}
          />
          Cleaned data from step 2
          {cleaningSteps.length > 0
            ? ` (${cleaningSteps.join(', ')})`
            : ' (no cleaning switched on)'}
        </label>
        <label class="check">
          <input
            type="radio"
            name="rietveld-data"
            checked={!useCleaned}
            onChange={() => set({ useCleaned: false })}
          />
          Uploaded data, unprocessed (strict counting statistics)
        </label>
      </fieldset>

      <fieldset class="rietveld-phases">
        <legend>Phases to refine</legend>
        {!phases && <p aria-busy="true">Loading the reference phases…</p>}
        {(phases ?? []).map((phase) => (
          <label key={phase.id} class="check">
            <input
              type="checkbox"
              checked={!settings.excluded.includes(phase.id)}
              onChange={(e) =>
                set({
                  excluded: e.currentTarget.checked
                    ? settings.excluded.filter((id) => id !== phase.id)
                    : [...settings.excluded, phase.id],
                })
              }
            />
            {phase.name} <span class="field-hint">({phaseReference(phase)})</span>
          </label>
        ))}
        {(phases ?? []).length > 0 && (
          <Advanced id="rietveld-lebail" title="Le Bail fit (no structure)">
            <p class="field-hint">
              In a Le Bail fit the peak intensities are taken from your data instead of the
              reference structure, so only the cell and the peak shape are refined. Use it for the
              lattice parameters of a doped or substituted material whose intensities no longer
              match the reference, or for a phase with no reliable structure. It gives no weight
              fraction.{' '}
              <HelpTip term="Le Bail fit">
                <p>
                  A. Le Bail, H. Duroy and J. L. Fourquet, Mat. Res. Bull. 23 (1988) 447. The
                  intensities are extracted again after every refinement stage until R_wp stops
                  falling. A good Le Bail fit shows that the cell and the peak positions agree with
                  the data; it does not prove that the phase is right.
                </p>
              </HelpTip>
            </p>
            {included.map((phase) => (
              <label key={phase.id} class="check">
                <input
                  type="checkbox"
                  checked={leBail.includes(phase.id)}
                  disabled={isIndexed(phase)}
                  onChange={(e) =>
                    set({
                      leBail: e.currentTarget.checked
                        ? [...(settings.leBail ?? []), phase.id]
                        : (settings.leBail ?? []).filter((id) => id !== phase.id),
                    })
                  }
                />
                {phase.name}: Le Bail
                {isIndexed(phase) && (
                  <span class="field-hint"> (always, for a cell from indexing)</span>
                )}
              </label>
            ))}
          </Advanced>
        )}
      </fieldset>

      <div class="export-actions">
        {stage === null ? (
          <button
            type="button"
            class="btn btn-primary"
            disabled={included.length === 0 || !measured}
            onClick={() => void run()}
          >
            {result ? 'Refine again' : 'Refine'}
          </button>
        ) : (
          <button type="button" class="btn" onClick={() => client.current?.cancel()}>
            Cancel
          </button>
        )}
        <p class="export-status" role="status" aria-live="polite">
          {stage !== null
            ? `${stage}…`
            : stale
              ? 'Settings changed since the last refinement. Refine again to update the results.'
              : ''}
        </p>
      </div>
      {error && <p class="message is-warning">{error}</p>}

      <Advanced id="rietveld-choices" title="What to refine">
        <p class="field-hint">
          Scale factors and background are always refined. Parameters are released in the order
          listed.
        </p>
        <div class="rietveld-choices">
          {CHOICE_LABELS.map(([choice, label, help]) => (
            <label key={choice} class="check">
              <input
                type="checkbox"
                checked={settings.choices[choice] === true || (choice === 'tch' && tchForced)}
                disabled={
                  (choice === 'tch' && tchForced) ||
                  (choice === 'sampleMix' && !settings.choices.size && !settings.choices.strain) ||
                  (choice === 'axialDivergence' && (instrument?.profile.shl ?? 0) > 0) ||
                  (choice === 'absorption' && !capillary) ||
                  (choice === 'roughness' && capillary) ||
                  (instrument !== null && (choice === 'width' || choice === 'widthSlope'))
                }
                onChange={(e) =>
                  set({ choices: { ...settings.choices, [choice]: e.currentTarget.checked } })
                }
              />
              {label}{' '}
              <HelpTip term={label.toLowerCase()}>
                <p>{help}</p>
              </HelpTip>
            </label>
          ))}
        </div>
        {(settings.choices.size || settings.choices.strain) && (
          <div class="radiation-fields">
            {settings.choices.size && (
              <label class="inline-field">
                <span>
                  Size model{' '}
                  <HelpTip term="uniaxial size">
                    <p>
                      Isotropic: one crystallite size for every direction. Uniaxial (GSAS-II’s): one
                      size along an axis you choose (for example 0 0 1 for platelets or needles of a
                      hexagonal phase) and one across it; each reflection gets the size for its
                      direction.
                    </p>
                  </HelpTip>
                </span>
                <select
                  aria-label="Size model"
                  value={settings.choices.sizeModel ?? 'isotropic'}
                  onChange={(e) =>
                    set({
                      choices: {
                        ...settings.choices,
                        sizeModel: e.currentTarget.value as 'isotropic' | 'uniaxial',
                      },
                    })
                  }
                >
                  <option value="isotropic">Isotropic</option>
                  <option value="uniaxial">Uniaxial (along an axis)</option>
                </select>
              </label>
            )}
            {settings.choices.strain && (
              <label class="inline-field">
                <span>
                  Microstrain model{' '}
                  <HelpTip term="generalized microstrain">
                    <p>
                      Isotropic: one microstrain. Uniaxial: one along an axis, one across it.
                      Generalized (Stephens, as in GSAS-II): the strain may differ in every
                      direction the crystal symmetry allows, with 2 (cubic) to 15 (triclinic)
                      coefficients S_hkl. It starts from the isotropic result. Use it only when the
                      difference curve shows widths that do not follow 2θ smoothly, and with good
                      data.
                    </p>
                  </HelpTip>
                </span>
                <select
                  aria-label="Microstrain model"
                  value={settings.choices.strainModel ?? 'isotropic'}
                  onChange={(e) =>
                    set({
                      choices: {
                        ...settings.choices,
                        strainModel: e.currentTarget.value as
                          'isotropic' | 'uniaxial' | 'generalized',
                      },
                    })
                  }
                >
                  <option value="isotropic">Isotropic</option>
                  <option value="uniaxial">Uniaxial (along an axis)</option>
                  <option value="generalized">Generalized (Stephens)</option>
                </select>
              </label>
            )}
          </div>
        )}
        {uniaxial &&
          included.map((phase) => (
            <label key={phase.id} class="inline-field">
              {phase.name}: axis of the uniaxial model (h k l)
              <input
                value={settings.axes?.[phase.id] ?? ''}
                placeholder="0 0 1"
                aria-invalid={
                  (settings.axes?.[phase.id] ?? '').trim() !== '' &&
                  !parseDirection(settings.axes?.[phase.id] ?? '')
                }
                onInput={(e) =>
                  set({ axes: { ...settings.axes, [phase.id]: e.currentTarget.value } })
                }
              />
            </label>
          ))}
        <fieldset class="method-choice">
          <legend>Structure refinement (advanced)</legend>
          <p class="message is-warning">
            <strong>Check:</strong> a laboratory powder pattern rarely has enough information to
            refine a structure. These are released only after the basic refinement has converged.
            Treat the results as estimates and check the bond lengths.
          </p>
          {STRUCTURE_LABELS.map(([choice, label, help]) => (
            <label key={choice} class="check">
              <input
                type="checkbox"
                checked={settings.choices[choice] === true}
                disabled={choice === 'restraints' && !settings.choices.positions}
                onChange={(e) =>
                  set({ choices: { ...settings.choices, [choice]: e.currentTarget.checked } })
                }
              />
              {label}{' '}
              <HelpTip term={label.toLowerCase()}>
                <p>{help}</p>
              </HelpTip>
            </label>
          ))}
        </fieldset>
        {settings.choices.orientation &&
          included.map((phase) => (
            <div key={phase.id} class="radiation-fields">
              <label class="inline-field">
                <span>
                  {phase.name}: orientation model{' '}
                  <HelpTip term="preferred orientation model">
                    <p>
                      March–Dollase needs one direction (h k l) along which the crystallites line
                      up, for example 0 0 1 for platelets of a hexagonal phase. Spherical harmonics
                      (GSAS-II's model, cylindrical sample symmetry) needs no direction: it fits a
                      smooth correction over all directions the crystal symmetry allows. A higher
                      order follows a stronger texture with more coefficients; start at 4 and go up
                      only if the fit improves clearly. A lab pattern rarely supports more than
                      order 8.
                    </p>
                  </HelpTip>
                </span>
                <select
                  aria-label={`${phase.name}: orientation model`}
                  value={String(settings.texture?.[phase.id] ?? 0)}
                  onChange={(e) =>
                    set({
                      texture: { ...settings.texture, [phase.id]: Number(e.currentTarget.value) },
                    })
                  }
                >
                  <option value="0">March–Dollase</option>
                  {[2, 4, 6, 8, 10, 12, 14, 16].map((order) => (
                    <option key={order} value={String(order)}>
                      Spherical harmonics, order {order}
                    </option>
                  ))}
                </select>
              </label>
              {textureOf(phase) === 0 && (
                <label class="inline-field">
                  {phase.name}: preferred direction (h k l)
                  <input
                    value={settings.orientation[phase.id] ?? ''}
                    placeholder="for example 0 0 1; empty for none"
                    aria-invalid={
                      (settings.orientation[phase.id] ?? '').trim() !== '' && !orientationOf(phase)
                    }
                    onInput={(e) =>
                      set({
                        orientation: { ...settings.orientation, [phase.id]: e.currentTarget.value },
                      })
                    }
                  />
                </label>
              )}
            </div>
          ))}
        <div class="radiation-fields">
          <NumberInput
            label="Background terms"
            value={settings.backgroundTerms}
            min={2}
            max={12}
            step={1}
            onChange={(v) => v !== null && set({ backgroundTerms: Math.round(v) })}
          />
          <NumberInput
            label="From 2θ (°)"
            value={settings.from}
            onChange={(v) => set({ from: v })}
          />
          <NumberInput label="To 2θ (°)" value={settings.to} onChange={(v) => set({ to: v })} />
        </div>
        <button
          type="button"
          class="btn btn-quiet"
          onClick={() =>
            set({
              choices: DEFAULT_CHOICES,
              backgroundTerms: DEFAULT_RIETVELD.backgroundTerms,
              from: null,
              to: null,
            })
          }
        >
          Reset to defaults
        </button>
        {tchForced && (
          <p class="field-hint">
            The GSAS-II peak shape (TCH) is used because a fixed instrument profile or size and
            strain need its separate Gaussian and Lorentzian widths.
            {instrument && ' The instrument widths are fixed, so W, η, U and V are not refined.'}
          </p>
        )}
      </Advanced>

      <SubstitutionPanel settings={settings} set={set} phases={included} />

      <RietveldSetup
        settings={settings}
        set={set}
        phases={included}
        lambda={lines.kAlpha1}
        result={result}
        patternName={pattern.name}
      />

      <PlotPanel
        sources={sources}
        settings={data.plot}
        onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
        labels={xrdLabels}
        xName="2θ"
        xUnit="°"
        exportName={`${pattern.name}-rietveld`}
        showOverlayOptions={false}
        lanes={lanes}
        {...(residual && {
          residual,
          lowerAxis: { y: 'Meas. − calc.', description: 'Measured minus calculated pattern.' },
        })}
      />

      {result && (
        <Results result={result} methods={settings.result?.methods ?? ''} name={pattern.name} />
      )}

      {result && <BondsSection result={result} name={pattern.name} settings={settings} set={set} />}

      {data.patterns.length > 1 && (
        <SeriesSection
          data={data}
          update={update}
          settings={settings}
          set={set}
          client={client.current}
          request={seriesRequest}
          pattern={seriesPattern}
          settingsKey={seriesKey}
          {...(anomalous && { anomalous: data.radiation.anode })}
        />
      )}
    </div>
  );
}

function Results({
  result,
  methods,
  name,
}: {
  result: RietveldResult;
  methods: string;
  name: string;
}) {
  const { stats } = result;
  const [copied, setCopied] = useState('');
  const fractions = result.phases.some((p) => p.weightFraction) && result.phases.length > 1;
  const sized = result.phases.some((p) => p.size);
  const strained = result.phases.some((p) => p.microstrain || p.stephens);
  const sizeAxial = result.phases.some((p) => p.sizeAxial);
  const strainAxial = result.phases.some((p) => p.microstrainAxial);
  const hklText = (h: Hkl | null) => (h ? `[${h.join(' ')}]` : '');
  // Results saved by older versions lack the newer fields.
  const correlations = result.correlations ?? [];
  const standard = result.standard ?? null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied('Copied.');
    } catch {
      setCopied('Copying was not allowed here. Select the text and copy it by hand.');
    }
  };
  return (
    <section class="rietveld-results" aria-labelledby="rietveld-results-title">
      <h3 id="rietveld-results-title" class="export-title">
        Refinement results (estimates)
      </h3>
      <dl class="result-summary">
        <div>
          <dt>
            R<sub>wp</sub>{' '}
            <HelpTip term="R_wp">
              <p>
                Weighted profile R-factor: how far the calculated pattern is from the measured one,
                weighting each point by 1/counts. Lower is better; compare it with R_exp.
              </p>
            </HelpTip>
          </dt>
          <dd>{(100 * stats.rwp).toFixed(2)} %</dd>
        </div>
        <div>
          <dt>
            R<sub>exp</sub>{' '}
            <HelpTip term="R_exp">
              <p>
                Expected R-factor: the best R_wp the counting noise allows. An R_wp close to R_exp
                means the model explains the data down to the noise.
              </p>
            </HelpTip>
          </dt>
          <dd>{(100 * stats.rexp).toFixed(2)} %</dd>
        </div>
        <div>
          <dt>
            R<sub>p</sub>
          </dt>
          <dd>{(100 * stats.rp).toFixed(2)} %</dd>
        </div>
        <div>
          <dt>
            χ² (GOF = {stats.gof.toFixed(2)}){' '}
            <HelpTip term="χ² and GOF">
              <p>
                χ² = (R_wp / R_exp)². Near 1 is ideal; well above 1 means the model misses
                something; well below 1 usually means the intensities are not raw counts.
              </p>
            </HelpTip>
          </dt>
          <dd>{stats.chi2.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Zero shift (° 2θ)</dt>
          <dd>{num(result.zero, 4)}</dd>
        </div>
        {Number.isFinite(stats.durbinWatson) && (
          <div>
            <dt>
              Durbin–Watson d{' '}
              <HelpTip term="Durbin–Watson d">
                <p>
                  Tests whether neighbouring points of the difference curve go up and down together.
                  About 2 means they are independent (the fit is down to the noise); well below 2
                  means the peak shape or positions are systematically off, and the standard
                  uncertainties are then too small (Hill and Flack, J. Appl. Cryst. 20 (1987) 356).
                </p>
              </HelpTip>
            </dt>
            <dd>{stats.durbinWatson.toFixed(2)}</dd>
          </div>
        )}
        {Number.isFinite(stats.berarLelann) && (
          <div>
            <dt>
              Bérar–Lelann factor{' '}
              <HelpTip term="Bérar–Lelann factor">
                <p>
                  How much larger the standard uncertainties (±) should be because neighbouring
                  points of the difference curve are correlated. About 1.13 means the residuals are
                  pure noise; larger values mean the profile is systematically misfitted (Bérar and
                  Lelann, J. Appl. Cryst. 24 (1991) 1–5). Tick “Apply the Bérar–Lelann factor to the
                  ±” under “What to refine” to have every ± multiplied by it; otherwise multiply
                  them yourself. It is only right when the intensities are raw counts.
                </p>
              </HelpTip>
            </dt>
            <dd>
              ×{stats.berarLelann.toFixed(2)}
              {stats.berarLelannApplied ? ' (applied to the ±)' : ' (not applied)'}
            </dd>
          </div>
        )}
        {result.transparency?.refined && (
          <div>
            <dt>
              {result.absorption ? 'Capillary displacement Dy (° 2θ)' : 'Transparency T (° 2θ)'}
            </dt>
            <dd>{num(result.transparency, 4)}</dd>
          </div>
        )}
        {result.absorption && (
          <div>
            <dt>Capillary μR{result.absorption.refined ? '' : ' (fixed)'}</dt>
            <dd>{num(result.absorption, 3)}</dd>
          </div>
        )}
        {result.roughness?.[1].refined && (
          <div>
            <dt>Surface roughness A, B</dt>
            <dd>
              {num(result.roughness[0], 3)}, {num(result.roughness[1], 3)}
            </dd>
          </div>
        )}
      </dl>

      {(stats.gof > 3 || stats.rwp > 0.25) && (
        <p class="message is-warning">
          <strong>Poor fit:</strong> the calculated pattern does not match the measured one, so the
          numbers below are not reliable. Check that the phases are right (step 3) and look at the
          difference curve under the plot.
        </p>
      )}
      {result.warnings.map((w) => (
        <p key={w} class="message is-warning">
          {w}
        </p>
      ))}

      <div
        class="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Refined phases, scrolls sideways"
      >
        <table class="peak-table">
          <thead>
            <tr>
              <th scope="col">Phase</th>
              <th scope="col">a (Å)</th>
              <th scope="col">b (Å)</th>
              <th scope="col">c (Å)</th>
              <th scope="col">α (°)</th>
              <th scope="col">β (°)</th>
              <th scope="col">γ (°)</th>
              <th scope="col">V (Å³)</th>
              {fractions && <th scope="col">Weight %</th>}
              {sized && <th scope="col">Size (nm){sizeAxial && ', across the axis'}</th>}
              {sizeAxial && <th scope="col">Size along the axis (nm)</th>}
              {strained && (
                <th scope="col">Microstrain (10⁻⁶){strainAxial && ', across the axis'}</th>
              )}
              {strainAxial && <th scope="col">Microstrain along the axis (10⁻⁶)</th>}
              <th scope="col">
                R<sub>Bragg</sub> (%)
              </th>
            </tr>
          </thead>
          <tbody>
            {result.phases.map((p) => (
              <tr key={p.id}>
                <th scope="row">{p.name}</th>
                <td>{num(p.cell.a)}</td>
                <td>{num(p.cell.b)}</td>
                <td>{num(p.cell.c)}</td>
                <td>{num(p.cell.alpha, 3)}</td>
                <td>{num(p.cell.beta, 3)}</td>
                <td>{num(p.cell.gamma, 3)}</td>
                <td>{num(p.volume, 3)}</td>
                {fractions && <td>{pct(p.weightFraction)}</td>}
                {sized && <td>{sizeText(p.size)}</td>}
                {sizeAxial && (
                  <td>{p.sizeAxial ? `${sizeText(p.sizeAxial)} ${hklText(p.sizeAxis)}` : '–'}</td>
                )}
                {strained && (
                  <td>
                    {p.microstrain
                      ? num(p.microstrain, 0)
                      : p.strainRange
                        ? `${p.strainRange[0].toFixed(0)}–${p.strainRange[1].toFixed(0)} (Stephens)`
                        : '–'}
                  </td>
                )}
                {strainAxial && (
                  <td>
                    {p.microstrainAxial
                      ? `${num(p.microstrainAxial, 0)} ${hklText(p.strainAxis)}`
                      : '–'}
                  </td>
                )}
                <td>
                  {p.leBail
                    ? 'Le Bail'
                    : Number.isFinite(p.rBragg)
                      ? (100 * p.rBragg).toFixed(2)
                      : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="field-hint">
        Numbers in brackets are standard uncertainties in the last digits. They come from the
        least-squares fit and usually underestimate the real uncertainty.
        {(sized || strained) &&
          ' Size and microstrain follow GSAS-II’s definitions (size with a Scherrer constant of 1 on the FWHM; microstrain as the FWHM of the 2θ broadening in radians divided by 10⁻⁶ tan θ).'}
        {result.phases.some((p) => p.stephens) &&
          ' For the generalized (Stephens) model the table shows the range of the microstrain over the reflections; the coefficients are listed below.'}
        {result.axial?.refined &&
          ` Axial divergence SH/L = ${withUncertainty(result.axial.value, result.axial.esd, 4)} (Finger–Cox–Jephcoat, as in GSAS-II).`}
      </p>
      {result.phases
        .filter((p) => p.stephens)
        .map((p) => (
          <p key={p.id} class="field-hint">
            {p.name}, Stephens coefficients S<sub>hkl</sub> (GSAS-II units):{' '}
            {(p.stephens ?? [])
              .map((s) => `${s.name} = ${withUncertainty(s.value.value, s.value.esd, 3)}`)
              .join(', ')}
          </p>
        ))}
      {result.phases.map((p) => {
        const t = p.texture;
        if (!t) return null;
        return (
          <p key={`texture-${p.id}`} class="field-hint">
            {p.name}, spherical-harmonic texture of order {t.order} (Laue class {t.laue}):{' '}
            {t.coefficients
              .map((c) => `${c.name} = ${withUncertainty(c.value.value, c.value.esd, 3)}`)
              .join(', ')}
            . Texture index J = {withUncertainty(t.index.value, t.index.esd, 3)}{' '}
            <HelpTip term="texture index">
              <p>
                J = 1 + Σ C²/(2l + 1) is 1 for a random powder and grows with the strength of the
                texture. The correction multiplies each reflection's intensity; here it runs from{' '}
                {t.range[0].toFixed(2)} to {t.range[1].toFixed(2)}. It is an estimate from one
                pattern: a lab scan sees each crystal direction only at one sample angle.
              </p>
            </HelpTip>
          </p>
        );
      })}
      {standard && (
        <p class="message is-info">
          <strong>Amorphous and unidentified content (estimate):</strong>{' '}
          {withUncertainty(100 * standard.amorphous.value, 100 * standard.amorphous.esd, 1)} wt% of
          the original sample, from{' '}
          {result.phases.find((p) => p.id === standard.phaseId)?.name ?? 'the standard'} weighed in
          at {(100 * standard.fraction).toFixed(2)} wt%. Crystalline phases in the original sample:{' '}
          {result.phases
            .map((p, k) => ({ p, w: standard.phases[k] }))
            .filter((r) => r.w)
            .map(
              ({ p, w }) =>
                `${p.name} ${withUncertainty(100 * (w?.value ?? 0), 100 * (w?.esd ?? 0), 1)} wt%`,
            )
            .join(', ')}
          . The uncertainty does not include the weighing or microabsorption.
        </p>
      )}
      {result.phases.some((p) => p.atoms) && <AtomsTable result={result} name={name} />}

      <Advanced id="rietveld-details" title="Peak shape, orientation and refinement stages">
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Profile parameters, scrolls sideways"
        >
          <table class="peak-table">
            <thead>
              <tr>
                <th scope="col">Phase</th>
                <th scope="col">U (deg²)</th>
                <th scope="col">V (deg²)</th>
                <th scope="col">W (deg²)</th>
                <th scope="col">η</th>
                <th scope="col">X, Y (deg)</th>
                <th scope="col">Preferred orientation</th>
                <th scope="col">B (Å²)</th>
                <th scope="col">Asymmetry P1, P2</th>
                <th scope="col">Scale</th>
              </tr>
            </thead>
            <tbody>
              {result.phases.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.name}</th>
                  <td>{num(p.u)}</td>
                  <td>{num(p.v)}</td>
                  <td>{num(p.w)}</td>
                  <td>{p.tch ? 'from TCH' : num(p.eta, 3)}</td>
                  <td>{p.tch ? `${num(p.x, 4)}, ${num(p.y, 4)}` : '–'}</td>
                  <td>
                    {p.orientation && p.orientationDirection
                      ? `${num(p.orientation, 3)} along ${formatHkl([p.orientationDirection])}`
                      : p.texture
                        ? `spherical harmonics, J = ${withUncertainty(p.texture.index.value, p.texture.index.esd, 3)}`
                        : '–'}
                  </td>
                  <td>{num(p.overallB, 3)}</td>
                  <td>
                    {p.asymmetry[0].refined
                      ? `${num(p.asymmetry[0], 4)}, ${num(p.asymmetry[1], 4)}`
                      : '–'}
                  </td>
                  <td>{p.scale.value.toExponential(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {correlations.length > 0 && (
          <>
            <h4 class="export-title">Strongly correlated parameters (|r| ≥ 0.9)</h4>
            <div
              class="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Correlated parameters, scrolls sideways"
            >
              <table class="peak-table">
                <thead>
                  <tr>
                    <th scope="col">Parameter</th>
                    <th scope="col">Parameter</th>
                    <th scope="col">r</th>
                  </tr>
                </thead>
                <tbody>
                  {correlations.map((c) => (
                    <tr key={`${c.a}|${c.b}`}>
                      <td>{c.a}</td>
                      <td>{c.b}</td>
                      <td>{c.r.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p class="field-hint">
              Pairs near ±1 cannot be told apart by the data; fixing one of them usually makes the
              other better defined. Background terms among themselves are not listed.
            </p>
          </>
        )}
        <p>
          Polarisation coefficient P: {(result.polarisation ?? 0.5).toFixed(4)}
          {result.instrument && '; instrument profile fixed'}
          {(result.excluded ?? []).length > 0 &&
            `; left out: ${(result.excluded ?? []).map(([a, b]) => `${a}–${b}°`).join(', ')}`}
        </p>
        <ol class="rietveld-stages">
          {result.stages.map((s) => (
            <li key={s.name}>
              {s.name}: R<sub>wp</sub> {(100 * s.rwp).toFixed(2)} %
            </li>
          ))}
        </ol>
        {result.displacement.refined && (
          <p>
            {result.absorption
              ? 'Capillary displacement Dx, perpendicular to the beam (° 2θ): '
              : 'Sample displacement coefficient D (° 2θ): '}
            {num(result.displacement, 4)}
          </p>
        )}
      </Advanced>

      <div class="export-actions">
        <button
          type="button"
          class="btn"
          onClick={() =>
            downloadCsv(
              `${name}-rietveld-phases`,
              `Basic Rietveld refinement (estimates). Rwp ${(100 * stats.rwp).toFixed(3)} %, Rexp ${(100 * stats.rexp).toFixed(3)} %, chi2 ${stats.chi2.toFixed(3)}, zero shift ${result.zero.value} deg (s.u. ${result.zero.esd}).`,
              result.phases,
              [
                { header: 'Phase', value: (p) => p.name },
                ...(['a', 'b', 'c', 'alpha', 'beta', 'gamma'] as const).flatMap((k) => [
                  {
                    header: `${k}${k.length === 1 ? ' (A)' : ' (deg)'}`,
                    value: (p: (typeof result.phases)[number]) => p.cell[k].value,
                  },
                  {
                    header: `s.u. ${k}`,
                    value: (p: (typeof result.phases)[number]) => p.cell[k].esd,
                  },
                ]),
                { header: 'V (A^3)', value: (p) => p.volume.value },
                { header: 's.u. V', value: (p) => p.volume.esd },
                { header: 'Weight fraction', value: (p) => p.weightFraction?.value ?? '' },
                { header: 's.u. weight fraction', value: (p) => p.weightFraction?.esd ?? '' },
                { header: 'R_Bragg', value: (p) => (p.leBail ? 'Le Bail' : p.rBragg) },
                {
                  header: 'Size (nm)',
                  value: (p) => (p.size && Number.isFinite(p.size.value) ? p.size.value : ''),
                },
                { header: 's.u. size', value: (p) => p.size?.esd ?? '' },
                { header: 'Microstrain (1e-6)', value: (p) => p.microstrain?.value ?? '' },
                { header: 's.u. microstrain', value: (p) => p.microstrain?.esd ?? '' },
                { header: 'Size model', value: (p) => p.sizeModel ?? 'isotropic' },
                { header: 'Size along axis (nm)', value: (p) => p.sizeAxial?.value ?? '' },
                { header: 's.u. size along axis', value: (p) => p.sizeAxial?.esd ?? '' },
                { header: 'Size axis', value: (p) => hklText(p.sizeAxis ?? null) },
                { header: 'Microstrain model', value: (p) => p.strainModel ?? 'isotropic' },
                {
                  header: 'Microstrain along axis (1e-6)',
                  value: (p) => p.microstrainAxial?.value ?? '',
                },
                {
                  header: 's.u. microstrain along axis',
                  value: (p) => p.microstrainAxial?.esd ?? '',
                },
                { header: 'Microstrain axis', value: (p) => hklText(p.strainAxis ?? null) },
                {
                  header: 'Stephens S_hkl',
                  value: (p) =>
                    (p.stephens ?? [])
                      .map((s) => `${s.name}=${s.value.value}(${s.value.esd})`)
                      .join('; '),
                },
                {
                  header: 'Microstrain range (1e-6)',
                  value: (p) => (p.strainRange ? p.strainRange.join(' to ') : ''),
                },
                { header: 'U (deg^2)', value: (p) => p.u.value },
                { header: 'V (deg^2)', value: (p) => p.v.value },
                { header: 'W (deg^2)', value: (p) => p.w.value },
                { header: 'eta', value: (p) => (p.tch ? '' : p.eta.value) },
                { header: 'TCH X (deg)', value: (p) => (p.tch ? p.x.value : '') },
                { header: 'TCH Y (deg)', value: (p) => (p.tch ? p.y.value : '') },
                { header: 'March-Dollase r', value: (p) => p.orientation?.value ?? '' },
                {
                  header: 'Texture (spherical harmonics)',
                  value: (p) =>
                    p.texture
                      ? `order ${p.texture.order} ${p.texture.laue}: ${p.texture.coefficients
                          .map((c) => `${c.name}=${c.value.value}(${c.value.esd})`)
                          .join('; ')}`
                      : '',
                },
                { header: 'Texture index J', value: (p) => p.texture?.index.value ?? '' },
                { header: 's.u. J', value: (p) => p.texture?.index.esd ?? '' },
                { header: 'B (A^2)', value: (p) => p.overallB.value },
                { header: 'Asymmetry P1', value: (p) => p.asymmetry[0].value },
                { header: 's.u. P1', value: (p) => p.asymmetry[0].esd },
                { header: 'Asymmetry P2', value: (p) => p.asymmetry[1].value },
                { header: 's.u. P2', value: (p) => p.asymmetry[1].esd },
                { header: 'Scale', value: (p) => p.scale.value },
              ],
            )
          }
        >
          Download results CSV
        </button>
        <button
          type="button"
          class="btn"
          onClick={() =>
            downloadCsv(
              `${name}-rietveld-pattern`,
              'Basic Rietveld refinement: measured, calculated and background intensity.',
              result.x.map((_, i) => i),
              [
                { header: '2theta (deg)', value: (i) => result.x[i] as number },
                { header: 'Measured', value: (i) => result.observed[i] as number },
                { header: 'Calculated', value: (i) => result.calculated[i] as number },
                { header: 'Background', value: (i) => result.background[i] as number },
                {
                  header: 'Difference',
                  value: (i) => (result.observed[i] as number) - (result.calculated[i] as number),
                },
              ],
            )
          }
        >
          Download pattern CSV
        </button>
        {result.phases.some((p) => p.reflections) && (
          <button
            type="button"
            class="btn"
            onClick={() => {
              const rows = result.phases.flatMap((p) =>
                (p.reflections ?? []).map((r) => ({ phase: p.name, leBail: p.leBail, r })),
              );
              downloadCsv(
                `${name}-rietveld-reflections`,
                'Rietveld refinement: reflections in the data range. I_obs is the observed intensity shared out in proportion to each calculated profile (Rietveld); intensities are integrated counts x degrees, Ka1 and Ka2 together. |F|^2 per reflection in electron units^2 (extracted from the data for Le Bail phases).',
                rows,
                [
                  { header: 'Phase', value: (x) => x.phase },
                  { header: 'h', value: (x) => x.r.hkl[0] },
                  { header: 'k', value: (x) => x.r.hkl[1] },
                  { header: 'l', value: (x) => x.r.hkl[2] },
                  { header: 'Multiplicity', value: (x) => x.r.multiplicity },
                  { header: 'd (A)', value: (x) => x.r.d },
                  { header: '2theta Ka1 (deg)', value: (x) => x.r.twoTheta },
                  { header: '|F|^2', value: (x) => x.r.f2 },
                  { header: 'I_obs', value: (x) => x.r.iObs },
                  { header: 'I_calc', value: (x) => x.r.iCalc },
                  { header: 'Orientation factor', value: (x) => x.r.orientation },
                  { header: 'Le Bail', value: (x) => (x.leBail ? 'yes' : 'no') },
                ],
              );
            }}
          >
            Download reflections CSV
          </button>
        )}
      </div>

      <h4 class="export-title">Methods text</h4>
      <p class="methods-text">{methods}</p>
      <div class="export-actions">
        <button type="button" class="btn" onClick={() => void copy()}>
          Copy text
        </button>
        <p class="export-status" role="status">
          {copied}
        </p>
      </div>
    </section>
  );
}

/** Refined atoms of each phase (structure refinement), with a CSV download. */
function AtomsTable({ result, name }: { result: RietveldResult; name: string }) {
  const hasU = result.phases.some((p) => p.atoms?.some((a) => a.u));
  // Results saved before stage 17b have no substitute field.
  const hasDopant = result.phases.some((p) => p.atoms?.some((a) => a.substitute));
  const rows = result.phases.flatMap((p) =>
    (p.atoms ?? []).map((atom) => ({ phase: p.name, atom })),
  );
  return (
    <>
      <h4 class="export-title">Refined atoms (estimates)</h4>
      <div
        class="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Refined atoms, scrolls sideways"
      >
        <table class="peak-table">
          <thead>
            <tr>
              <th scope="col">Phase</th>
              <th scope="col">Atom</th>
              <th scope="col">x</th>
              <th scope="col">y</th>
              <th scope="col">z</th>
              <th scope="col">Occupancy</th>
              <th scope="col">B (Å²)</th>
              {hasU && <th scope="col">U11, U22, U33, U12, U13, U23 (Å²)</th>}
              {hasDopant && <th scope="col">Dopant, fraction x</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ phase, atom }) => (
              <tr key={`${phase}-${atom.label}`}>
                <td>{phase}</td>
                <th scope="row">{atom.label}</th>
                {atom.x.map((c, i) => (
                  <td key={i}>{num(c)}</td>
                ))}
                <td>{num(atom.occupancy, 3)}</td>
                <td>{Number.isFinite(atom.b.value) ? num(atom.b, 3) : 'anisotropic'}</td>
                {hasU && (
                  <td>
                    {atom.u ? atom.u.map((c) => num(c, 4)).join(', ') : '–'}
                    {!atom.positiveDefinite && ' (not positive definite)'}
                  </td>
                )}
                {hasDopant && (
                  <td>
                    {atom.substitute
                      ? `${atom.substitute.element} ${num(atom.substitute.fraction, 3)}`
                      : '–'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="field-hint">
        Coordinates without brackets are fixed by the site symmetry or were not refined.
      </p>
      <button
        type="button"
        class="btn"
        onClick={() =>
          downloadCsv(
            `${name}-rietveld-atoms`,
            'Rietveld structure refinement (estimates): fractional coordinates, occupancies and isotropic B. s.u. 0 means fixed.',
            rows,
            [
              { header: 'Phase', value: (r) => r.phase },
              { header: 'Atom', value: (r) => r.atom.label },
              { header: 'Element', value: (r) => r.atom.element },
              ...(['x', 'y', 'z'] as const).flatMap((k, i) => [
                { header: k, value: (r: (typeof rows)[number]) => r.atom.x[i]?.value ?? '' },
                {
                  header: `s.u. ${k}`,
                  value: (r: (typeof rows)[number]) => r.atom.x[i]?.esd ?? '',
                },
              ]),
              { header: 'Dopant', value: (r) => r.atom.substitute?.element ?? '' },
              {
                header: 'Dopant fraction x',
                value: (r) => r.atom.substitute?.fraction.value ?? '',
              },
              { header: 's.u. x', value: (r) => r.atom.substitute?.fraction.esd ?? '' },
              { header: 'Occupancy', value: (r) => r.atom.occupancy.value },
              { header: 's.u. occupancy', value: (r) => r.atom.occupancy.esd },
              {
                header: 'B (A^2)',
                value: (r) => (Number.isFinite(r.atom.b.value) ? r.atom.b.value : ''),
              },
              { header: 's.u. B', value: (r) => r.atom.b.esd },
              ...(['U11', 'U22', 'U33', 'U12', 'U13', 'U23'] as const).flatMap((k, i) => [
                {
                  header: `${k} (A^2)`,
                  value: (r: (typeof rows)[number]) => r.atom.u?.[i]?.value ?? '',
                },
                {
                  header: `s.u. ${k}`,
                  value: (r: (typeof rows)[number]) => r.atom.u?.[i]?.esd ?? '',
                },
              ]),
            ],
          )
        }
      >
        Download atoms CSV
      </button>
    </>
  );
}
