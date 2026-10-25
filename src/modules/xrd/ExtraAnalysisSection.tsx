import { phaseReference } from '../../core/xrd/reference/source';
import { useMemo } from 'preact/hooks';
import type { CharacterHint } from '../../core/xrd/analysis/character';
import { peakTable } from '../../core/xrd/peaks/table';
import { ANODES } from '../../core/xrd/radiation';
import { formatWithSigma } from '../../ui/format';
import { HelpTip } from '../../ui/HelpTip';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { AssignmentResult } from './assignment';
import { downloadCsv } from './csv';
import {
  crystallinityFor,
  DEFAULT_CRYSTALLINITY,
  peaksFor,
  processingFor,
  type AnalysisSettings,
  type CrystallinityChoice,
  type XrdData,
} from './data';
import {
  characterFor,
  runCrystallinity,
  textureFor,
  unfittedSignal,
  type CrystallinityRun,
  type PhaseTexture,
} from './extraAnalysis';
import { xrdLabels } from './labels';
import { TableBox } from './MethodDetails';
import { NumberInput } from './NumberInput';
import { useProcessed } from './useProcessed';

interface ExtraAnalysisProps {
  data: XrdData;
  update: (patch: Partial<XrdData>) => void;
  patternId: string;
  /** Null when peaks have not been assigned (no phase chosen or no fitted peaks). */
  assignment: AssignmentResult | null;
}

/** One line of the summary table of the results added in this section. */
interface SummaryItem {
  quantity: string;
  value: string;
  note: string;
}

const ESTIMATE_ONLY =
  'Estimate only; a powder pattern cannot prove single-crystal or layered structure.';

/** Step 7: texture coefficient, crystallinity index, pattern character and a summary of them. */
export function ExtraAnalysisSection({ data, update, patternId, assignment }: ExtraAnalysisProps) {
  const pattern = data.patterns.find((p) => p.id === patternId);
  const { result: processed } = useProcessed(
    pattern,
    processingFor(data, patternId),
    data.radiation,
  );
  const analysis = data.analysis;
  const setAnalysis = (patch: Partial<AnalysisSettings>) =>
    update({ analysis: { ...analysis, ...patch } });
  const choice = crystallinityFor(data, patternId);
  const setChoice = (patch: Partial<CrystallinityChoice>) =>
    setAnalysis({
      crystallinity: { ...analysis.crystallinity, [patternId]: { ...choice, ...patch } },
    });

  const textures = useMemo(
    () =>
      assignment
        ? textureFor(data, patternId, assignment, analysis.textureBasis, processed ?? null)
        : null,
    [data, patternId, assignment, analysis.textureBasis, processed],
  );
  const fit = peaksFor(data, patternId).fit;
  const lambda = ANODES[data.radiation.anode].kAlpha1;
  const crystallinity = useMemo(
    () =>
      processed && choice.enabled
        ? runCrystallinity(
            processed.twoTheta,
            processed.intensity,
            choice,
            fit ? peakTable(fit.regions, lambda) : [],
          )
        : null,
    [processed, choice, fit, lambda],
  );
  const index = crystallinity?.outcome.ok ? crystallinity.outcome.index : null;
  const hints = assignment && textures ? characterFor(assignment, textures, index) : null;
  if (!pattern) return null;

  const summary = summaryItems(assignment, textures, crystallinity, pattern.name);

  return (
    <section class="peak-table-section" aria-labelledby="extra-title">
      <h3 id="extra-title" class="export-title">
        Texture, crystallinity and pattern character
      </h3>
      <p class="field-hint">
        Extra analyses of the same pattern. All three are estimates that depend on your choices and
        on how well the peaks were fitted in step 5.
      </p>

      <TextureBlock
        textures={textures}
        basis={analysis.textureBasis}
        onBasis={(textureBasis) => setAnalysis({ textureBasis })}
        patternName={pattern.name}
        needsAssignment={assignment === null}
      />

      <CrystallinityBlock
        choice={choice}
        onChange={setChoice}
        run={crystallinity}
        processed={processed}
        patternName={pattern.name}
        data={data}
        update={update}
        peaksFitted={Boolean(fit)}
        backgroundRemoved={processingFor(data, patternId).background.enabled}
      />

      <h4 class="export-subtitle">
        Pattern character{' '}
        <HelpTip term="pattern character">
          <p>
            Rules of thumb read from your peaks: which reflections are present, how their
            intensities compare with a random powder and how wide the peaks are. They suggest, never
            decide. {ESTIMATE_ONLY}
          </p>
        </HelpTip>
      </h4>
      <CharacterBlock hints={hints} />

      {summary.length > 0 && <SummaryBlock items={summary} patternName={pattern.name} />}
    </section>
  );
}

function TextureBlock({
  textures,
  basis,
  onBasis,
  patternName,
  needsAssignment,
}: {
  textures: readonly PhaseTexture[] | null;
  basis: 'height' | 'area';
  onBasis: (basis: 'height' | 'area') => void;
  patternName: string;
  needsAssignment: boolean;
}) {
  const exportCsv = () =>
    downloadCsv(
      `${patternName}-texture-coefficients`,
      `Harris texture coefficients, ${patternName}. Observed intensity is the fitted peak ${basis} (intensity${basis === 'area' ? ' × degrees' : ''}); I0 is the reference intensity, percent of the strongest line. TC = (I/I0) / mean(I/I0). Reflections with no fitted peak count as intensity 0.`,
      (textures ?? []).flatMap(({ phase, result }) =>
        'rows' in result ? result.rows.map((row) => ({ phase, row })) : [],
      ),
      [
        { header: 'Phase', value: (r) => r.phase.name },
        { header: 'Structure source', value: (r) => phaseReference(r.phase) },
        { header: '(hkl)', value: (r) => r.row.hklText },
        { header: '2θ observed (°)', value: (r) => r.row.peak?.peak.twoTheta ?? '' },
        { header: `Observed ${basis}`, value: (r) => r.row.observed },
        { header: 'I0 reference (%)', value: (r) => r.row.reference },
        { header: 'TC', value: (r) => r.row.tc },
      ],
    );
  return (
    <>
      <h4 class="export-subtitle">
        Texture coefficient{' '}
        <HelpTip term="texture coefficient">
          <p>
            The Harris texture coefficient TC(hkl) = [I/I₀] / mean[I/I₀] compares each peak&apos;s
            intensity with the reference intensity of a randomly oriented powder, relative to the
            other peaks. TC = 1 for every peak means no preferred orientation. TC &gt; 1 means more
            grains are oriented with this plane parallel to the surface than in a random powder. The
            coefficients always average to 1, so one very strong plane pushes the others below 1.
          </p>
        </HelpTip>
      </h4>
      <fieldset class="method-choice">
        <legend>Peak intensity measure</legend>
        {(['height', 'area'] as const).map((b) => (
          <label key={b} class="check">
            <input
              type="radio"
              name="texture-basis"
              checked={basis === b}
              onChange={() => onBasis(b)}
            />
            {b === 'height' ? 'Peak height' : 'Peak area'}
          </label>
        ))}
      </fieldset>
      {needsAssignment || !textures ? (
        <p class="message is-info" role="note">
          <strong>Note:</strong> Texture coefficients need peaks assigned to a reference phase. Fit
          the peaks (step 5) and choose a phase (steps 3 and 4).
        </p>
      ) : (
        <>
          <p class="field-hint">
            Reflections of the phase that are strong in the reference and inside the scanned range
            but have no fitted peak count as intensity 0, so fit every visible peak in step 5 first.
            With few reflections the coefficients are only a rough guide.
          </p>
          {textures.map(({ phase, result }) =>
            'reason' in result ? (
              <p key={phase.id} class="message is-warning">
                <strong>Check:</strong> {phase.name}: {result.reason}
              </p>
            ) : null,
          )}
          {textures.flatMap(({ phase, result }) =>
            'rows' in result
              ? result.rows.filter(unfittedSignal).map((row) => (
                  <p key={`${phase.id}-${row.hklText}-unfitted`} class="message is-warning">
                    <strong>Check:</strong> {phase.name} {row.hklText}: the pattern rises{' '}
                    {Number.isFinite(row.expected?.signal?.ratio)
                      ? `${row.expected?.signal?.ratio.toFixed(1)} times the local noise`
                      : 'clearly above a noise-free baseline'}{' '}
                    near {row.expected?.twoTheta.toFixed(2)}° 2θ, where this reference line is
                    expected, but no peak was fitted. It is counted as intensity 0, which lowers its
                    TC and raises the others. Fit it in step 5 for a fair coefficient.
                  </p>
                ))
              : [],
          )}
          {textures.some((t) => 'rows' in t.result) && (
            <TableBox label="Texture coefficients" onExport={exportCsv}>
              <thead>
                <tr>
                  <th scope="col">Phase</th>
                  <th scope="col">(hkl)</th>
                  <th scope="col">2θ obs (°)</th>
                  <th scope="col">Observed {basis}</th>
                  <th scope="col">I₀ ref (%)</th>
                  <th scope="col">TC</th>
                  <th scope="col">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {textures.flatMap(({ phase, result }) =>
                  'rows' in result
                    ? result.rows.map((row) => (
                        <tr key={`${phase.id}-${row.hklText}-${row.peak?.index ?? 'x'}`}>
                          <td>{phase.name}</td>
                          <td>{row.hklText}</td>
                          <td>{row.peak ? row.peak.peak.twoTheta.toFixed(3) : 'no peak'}</td>
                          <td>{row.observed.toPrecision(4)}</td>
                          <td>{row.reference.toFixed(1)}</td>
                          <td>{row.tc.toFixed(2)}</td>
                          <td class="peak-notes">
                            {tcMeaning(row.tc, row.peak === null, unfittedSignal(row))}
                          </td>
                        </tr>
                      ))
                    : [],
                )}
              </tbody>
            </TableBox>
          )}
        </>
      )}
    </>
  );
}

/** Plain-language reading of one texture coefficient. */
function tcMeaning(tc: number, missing: boolean, visible: boolean): string {
  if (visible) return 'Counted as zero, but the pattern shows a signal here: fit this peak.';
  if (missing) return 'Reference line not found; counted as zero.';
  if (tc > 1.2)
    return 'More grains with this plane parallel to the surface than in a random powder.';
  if (tc < 0.8) return 'Fewer than in a random powder.';
  return 'Close to a random powder.';
}

interface CrystallinityBlockProps {
  choice: CrystallinityChoice;
  onChange: (patch: Partial<CrystallinityChoice>) => void;
  run: CrystallinityRun | null;
  processed: ReturnType<typeof useProcessed>['result'];
  patternName: string;
  data: XrdData;
  update: (patch: Partial<XrdData>) => void;
  peaksFitted: boolean;
  /** Background removal is switched on in step 2 for this pattern. */
  backgroundRemoved: boolean;
}

function CrystallinityBlock({
  choice,
  onChange,
  run,
  processed,
  patternName,
  data,
  update,
  peaksFitted,
  backgroundRemoved,
}: CrystallinityBlockProps) {
  const outcome = run?.outcome;
  const sources = useMemo<SeriesSource[]>(() => {
    if (!processed || !outcome?.ok) return [];
    return [
      {
        id: 'data',
        name: patternName,
        x: processed.twoTheta,
        y: processed.intensity,
        unit: 'counts',
        colorIndex: 7,
      },
      {
        id: 'hump',
        name: 'Amorphous hump',
        x: outcome.x,
        y: outcome.hump,
        unit: 'counts',
        colorIndex: 1,
        dashed: true,
      },
    ];
  }, [processed, outcome, patternName]);
  const exportCsv = () => {
    if (!run || !outcome?.ok) return;
    downloadCsv(
      `${patternName}-crystallinity`,
      `Crystallinity index, ${patternName}. 2θ range ${run.from}–${run.to}°; ${choice.hump === 'gaussian' ? `Gaussian hump, centre ${run.centre}°, FWHM ${run.fwhm}°, height fitted outside ${run.excludedPeaks} fitted peaks` : `hump through anchors at ${run.anchors.join(', ')}°`}. Areas in intensity × degrees 2θ. A relative index that depends on the range, background and hump chosen.`,
      [outcome],
      [
        { header: 'Total area', value: (o) => o.totalArea },
        { header: 'Amorphous area', value: (o) => o.amorphousArea },
        { header: 'Crystalline area', value: (o) => o.crystallineArea },
        { header: 'Crystallinity index (%)', value: (o) => o.index },
      ],
    );
  };
  return (
    <>
      <h4 class="export-subtitle">
        Crystallinity index{' '}
        <HelpTip term="crystallinity index">
          <p>
            The share of the intensity in sharp peaks: crystalline area ÷ (crystalline + amorphous
            area) × 100 over the range you choose. The amorphous part is the broad hump under the
            peaks, which you describe as a Gaussian or by points on the pattern between the peaks.
            It is a relative index: a different range, background or hump gives a different number,
            so compare samples only with identical settings.
          </p>
        </HelpTip>
      </h4>
      <label class="check">
        <input
          type="checkbox"
          checked={choice.enabled}
          onChange={(e) => onChange({ enabled: e.currentTarget.checked })}
        />
        Calculate the crystallinity index
      </label>
      {choice.enabled && (
        <div class="crystallinity">
          <p class="field-hint">
            Uses the pattern as cleaned in step 2: a background you removed counts as zero, and a
            broad hump removed by a background method is not counted as amorphous. Look at the
            dashed curve: it should follow the broad hump under the peaks.
          </p>
          <div class="radiation-fields">
            <NumberInput
              label="From 2θ (°)"
              value={run?.from ?? choice.from}
              min={0}
              onChange={(from) => onChange({ from })}
            />
            <NumberInput
              label="To 2θ (°)"
              value={run?.to ?? choice.to}
              min={0}
              onChange={(to) => onChange({ to })}
            />
          </div>
          <fieldset class="method-choice">
            <legend>Amorphous hump</legend>
            <label class="check">
              <input
                type="radio"
                name="hump-kind"
                checked={choice.hump === 'gaussian'}
                onChange={() => onChange({ hump: 'gaussian' })}
              />
              Broad Gaussian
            </label>
            <label class="check">
              <input
                type="radio"
                name="hump-kind"
                checked={choice.hump === 'anchors'}
                onChange={() => onChange({ hump: 'anchors' })}
              />
              Points on the pattern (anchors)
            </label>
          </fieldset>
          {choice.hump === 'gaussian' ? (
            <>
              <div class="radiation-fields">
                <NumberInput
                  label="Hump centre 2θ (°)"
                  value={run?.centre ?? choice.centre}
                  min={0}
                  onChange={(centre) => onChange({ centre })}
                />
                <NumberInput
                  label="Hump width FWHM (°)"
                  value={run?.fwhm ?? choice.fwhm}
                  min={0}
                  onChange={(fwhm) => onChange({ fwhm })}
                />
              </div>
              <p class="field-hint">
                The hump height is fitted to the points that are not near a fitted peak
                {peaksFitted
                  ? ` (${run?.excludedPeaks ?? 0} peaks in the range are left out).`
                  : '. No peaks are fitted yet, so the whole pattern is used and the peaks inflate the hump; fit the peaks in step 5 first.'}
              </p>
            </>
          ) : (
            <label class="inline-field">
              <span>Anchor positions 2θ (°), separated by spaces or commas</span>
              <input
                type="text"
                inputMode="decimal"
                value={choice.anchors}
                placeholder="for example 12 20 32 44 60 78"
                onInput={(e) => onChange({ anchors: e.currentTarget.value })}
              />
            </label>
          )}
          {backgroundRemoved && (
            <p class="message is-warning">
              <strong>Check:</strong> Background removal is switched on in step 2. A broad amorphous
              hump is often removed together with the background, so the hump here is too small and
              the index too high. Switch background removal off for this analysis, or treat the
              number as an upper limit.
            </p>
          )}
          {outcome && !outcome.ok && (
            <p class="message is-warning">
              <strong>Check:</strong> {outcome.reason}
            </p>
          )}
          {outcome?.ok && (
            <>
              <p class="crystallinity-result">
                Crystallinity index: <strong>{outcome.index.toFixed(1)} %</strong> (estimate)
              </p>
              <p class="field-hint">
                Crystalline area {outcome.crystallineArea.toPrecision(4)}, amorphous area{' '}
                {outcome.amorphousArea.toPrecision(4)}, total {outcome.totalArea.toPrecision(4)}{' '}
                (intensity × degrees 2θ). It is a relative index that depends on the range,
                background and hump chosen.{' '}
                <button type="button" class="btn btn-quiet" onClick={exportCsv}>
                  Download CSV
                </button>
              </p>
              {processed && (
                <PlotPanel
                  sources={sources}
                  settings={data.plot}
                  onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
                  labels={xrdLabels}
                  xName="2θ"
                  xUnit="°"
                  exportName={`${patternName}-crystallinity`}
                  showOverlayOptions={false}
                />
              )}
            </>
          )}
          <p>
            <button
              type="button"
              class="btn"
              onClick={() => onChange({ ...DEFAULT_CRYSTALLINITY, enabled: true })}
            >
              Reset these settings
            </button>
          </p>
        </div>
      )}
    </>
  );
}

function CharacterBlock({ hints }: { hints: readonly CharacterHint[] | null }) {
  if (hints === null)
    return (
      <p class="message is-info" role="note">
        <strong>Note:</strong> Pattern hints need peaks assigned to a reference phase (steps 3 to
        5).
      </p>
    );
  if (hints.length === 0)
    return (
      <p class="field-hint">No hint: the peaks do not clearly point to one case. {ESTIMATE_ONLY}</p>
    );
  return (
    <ul class="character-hints">
      {hints.map((h) => (
        <li key={`${h.id}-${h.title}`} class="message is-info">
          <strong>{h.title}.</strong> {h.text} <span class="field-hint">Why: {h.reason}</span>
        </li>
      ))}
    </ul>
  );
}

/** Lattice parameters, cell volume, texture coefficients and crystallinity as table rows. */
function summaryItems(
  assignment: AssignmentResult | null,
  textures: readonly PhaseTexture[] | null,
  run: CrystallinityRun | null,
  patternName: string,
): SummaryItem[] {
  const items: SummaryItem[] = [];
  for (const { phase, lattice } of assignment?.phases ?? []) {
    const who = `${phase.name} (${phaseReference(phase)})`;
    if ('unsupported' in lattice) continue;
    if (!lattice.outcome.ok) {
      items.push({ quantity: `${who}: lattice`, value: '–', note: lattice.outcome.reason });
      continue;
    }
    const { fit } = lattice.outcome;
    const note = `Refined from ${fit.n} peaks; an estimate.`;
    fit.edges.forEach((e) =>
      items.push({
        quantity: `${who}: ${e.name} (Å)`,
        value: formatWithSigma(e.a.value, e.a.sigma),
        note,
      }),
    );
    items.push({
      quantity: `${who}: cell volume (Å³)`,
      value: formatWithSigma(fit.volume.value, fit.volume.sigma),
      note,
    });
  }
  for (const { phase, result } of textures ?? []) {
    if (!('rows' in result)) continue;
    for (const row of result.rows)
      items.push({
        quantity: `${phase.name}: TC ${row.hklText}`,
        value: row.tc.toFixed(2),
        note: row.peak
          ? 'Harris texture coefficient.'
          : 'Reference line not found; counted as zero.',
      });
  }
  if (run?.outcome.ok)
    items.push({
      quantity: 'Crystallinity index (%)',
      value: run.outcome.index.toFixed(1),
      note: `Relative index, ${run.from.toFixed(1)}–${run.to.toFixed(1)}° 2θ, ${patternName}; depends on range, background and hump.`,
    });
  return items;
}

function SummaryBlock({
  items,
  patternName,
}: {
  items: readonly SummaryItem[];
  patternName: string;
}) {
  const exportCsv = () =>
    downloadCsv(
      `${patternName}-lattice-texture-crystallinity`,
      `Lattice parameters, cell volume, texture coefficients and crystallinity index, ${patternName}. All values are estimates; ± is one standard uncertainty.`,
      items,
      [
        { header: 'Quantity', value: (r) => r.quantity },
        { header: 'Value', value: (r) => r.value },
        { header: 'Note', value: (r) => r.note },
      ],
    );
  return (
    <>
      <h4 class="export-subtitle">Summary of lattice, texture and crystallinity</h4>
      <TableBox label="Lattice, texture and crystallinity summary" onExport={exportCsv}>
        <thead>
          <tr>
            <th scope="col">Quantity</th>
            <th scope="col">Value</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.quantity}>
              <th scope="row">{r.quantity}</th>
              <td>{r.value}</td>
              <td class="peak-notes">{r.note}</td>
            </tr>
          ))}
        </tbody>
      </TableBox>
    </>
  );
}
