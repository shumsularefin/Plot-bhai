import { useState } from 'preact/hooks';
import type { CorrectionMethod } from '../../core/xrd/instrument/correction';
import type { Estimate } from '../../core/xrd/size/methods';
import { formatWithSigma } from '../../ui/format';
import { HelpTip } from '../../ui/HelpTip';
import { BarChart } from '../../ui/plot/BarChart';
import type { StepContext } from '../../ui/wizard/types';
import { assignmentFor } from './assignment';
import { AssignmentSection } from './AssignmentSection';
import { downloadCsv } from './csv';
import { ExtraAnalysisSection } from './ExtraAnalysisSection';
import type { PatternChoices, ResultsSettings, XrdData } from './data';
import { NumberInput } from './NumberInput';
import { LineDetails, Messages, ScherrerDetails, TableBox } from './MethodDetails';
import { useReferencePhases } from './useReferencePhases';
import {
  choicesFor,
  LINE_METHODS,
  METHOD_NAMES,
  METHOD_SHORT,
  sizeResults,
  type ResultPeak,
  type SummaryRow,
} from './sizeResults';

const CORRECTION_LABELS: Record<CorrectionMethod, string> = {
  gaussian: 'Gaussian',
  lorentzian: 'Lorentzian',
  voigt: 'Approximate Voigt',
};

/** Wizard step 7: crystallite size and microstrain by every method, with comparisons. */
export function ResultsStep({ data, update }: StepContext<XrdData>) {
  const patterns = data.patterns;
  const [selectedId, setSelectedId] = useState(patterns[0]?.id);
  const pattern = patterns.find((p) => p.id === selectedId) ?? patterns[0];
  const settings = data.results;
  const setResults = (patch: Partial<ResultsSettings>) =>
    update({ results: { ...settings, ...patch } });
  const skipped = data.instrument.source === 'skip';
  const [refineZeroShift, setRefineZeroShift] = useState(false);
  const { phases, failed } = useReferencePhases(data.material.familyId);

  if (!pattern) return <p>No patterns are loaded. Go back to Upload to add one.</p>;
  const results = sizeResults(data, pattern.id);
  const assignment = phases ? assignmentFor(data, pattern.id, phases, refineZeroShift) : null;
  const assignmentReason = !data.material.phaseIds.length
    ? 'No reference phase is chosen, so peaks are not labelled with (hkl). Choose a material in step 3 and tick "Use this phase" in step 4 to get labels, the combined table and lattice parameters.'
    : failed
      ? 'The reference lines could not be loaded. Reload the page to try again.'
      : !phases
        ? 'Loading the reference lines…'
        : 'This pattern has no fitted peaks yet. Fit them in step 5 to assign (hkl).';
  const setChoices = (fitKey: string, patch: Partial<PatternChoices>) =>
    setResults({
      patterns: {
        ...settings.patterns,
        [pattern.id]: { ...choicesFor(data, pattern.id, fitKey), ...patch },
      },
    });

  return (
    <div class="fit-step">
      {skipped && (
        <p class="message is-warning" role="note">
          <strong>Check:</strong> instrument correction was skipped (step 6). Widths include the
          instrument&apos;s own broadening, so every crystallite size in these results is smaller
          than reality.
        </p>
      )}
      <p class="field-hint">
        Every number here is an estimate from a model of peak broadening. The methods make different
        assumptions, so their answers differ; report which method you used, with K, the wavelength
        and the instrument correction.
      </p>

      {patterns.length > 1 && (
        <label class="inline-field">
          Pattern
          <select value={pattern.id} onChange={(e) => setSelectedId(e.currentTarget.value)}>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <section class="process-step is-on" aria-labelledby="settings-title">
        <h3 id="settings-title" class="process-step-title">
          Settings
        </h3>
        <div class="process-step-body">
          <div class="radiation-fields">
            <NumberInput
              label="Shape factor K"
              value={settings.k}
              min={0.5}
              max={2}
              step={0.01}
              onChange={(k) => k !== null && setResults({ k })}
              help={
                <HelpTip term="the shape factor K">
                  <p>
                    K links peak width to crystallite size and depends on the crystallite shape and
                    on how width is measured. 0.9 is the usual choice with FWHM. Use the value your
                    field or reference uses, and report it. Some papers use K = 3/4 with the
                    size–strain plot.
                  </p>
                </HelpTip>
              }
            />
            <NumberInput
              label="Young's modulus E (GPa)"
              value={settings.modulusGPa}
              min={0}
              onChange={(modulusGPa) => setResults({ modulusGPa })}
              help={
                <HelpTip term="Young's modulus">
                  <p>
                    Needed by the USDM and UDEDM Williamson–Hall models. Crystals are often stiffer
                    in some directions than others; if you know the modulus for each peak&apos;s
                    direction (E_hkl), enter it in the peak table below. Take values from a
                    reference you can cite.
                  </p>
                </HelpTip>
              }
            />
            <NumberInput
              label="Density ρ (g/cm³)"
              value={settings.densityGcm3}
              min={0}
              onChange={(densityGcm3) => setResults({ densityGcm3 })}
              help={
                <HelpTip term="density">
                  <p>
                    Used only for the specific surface area S = 6/(ρD), which assumes separate,
                    dense, spherical crystallites. Real powders are usually agglomerated, so the
                    measured (BET) surface area is normally smaller.
                  </p>
                </HelpTip>
              }
            />
          </div>
          {skipped ? (
            <p class="field-hint">Instrument correction: skipped (change it in step 6).</p>
          ) : (
            <fieldset class="method-choice">
              <legend>Instrument correction (also set in step 6)</legend>
              {(Object.keys(CORRECTION_LABELS) as CorrectionMethod[]).map((m) => (
                <label key={m} class="check">
                  <input
                    type="radio"
                    name="results-correction"
                    checked={data.instrument.method === m}
                    onChange={() => update({ instrument: { ...data.instrument, method: m } })}
                  />
                  {CORRECTION_LABELS[m]}
                </label>
              ))}
            </fieldset>
          )}
        </div>
      </section>

      <Guidance />

      <AssignmentSection
        data={data}
        update={update}
        patternId={pattern.id}
        result={assignment ?? { reason: assignmentReason }}
        refineZeroShift={refineZeroShift}
        onRefineZeroShift={setRefineZeroShift}
      />

      <ExtraAnalysisSection
        data={data}
        update={update}
        patternId={pattern.id}
        assignment={assignment}
      />

      {results.kind === 'none' ? (
        <p class="message is-warning">
          <strong>Check:</strong> {results.reason}
        </p>
      ) : (
        <>
          <PeakChoices
            peaks={results.peaks}
            patternName={pattern.name}
            skipped={results.skipped}
            hkl={assignment?.peaks.map((p) => p.hklText)}
            setUse={(index, use) => {
              const c = choicesFor(data, pattern.id, results.fitKey);
              setChoices(results.fitKey, { use: { ...c.use, [index]: use } });
            }}
            setModulus={(index, value) => {
              const c = choicesFor(data, pattern.id, results.fitKey);
              const modulus = Object.fromEntries(
                Object.entries(c.modulus).filter(([k]) => Number(k) !== index),
              );
              if (value !== null) modulus[index] = value;
              setChoices(results.fitKey, { modulus });
            }}
          />
          <Summary rows={results.summary} patternName={pattern.name} data={data} />
          <h3 class="export-title">Each method</h3>
          <ScherrerDetails
            result={results.scherrer}
            peaks={results.peaks}
            patternName={pattern.name}
            k={settings.k}
            lambdaNm={results.settings.lambdaNm}
          />
          {LINE_METHODS.map((m) => (
            <LineDetails
              key={m}
              result={results.lines[m]}
              patternName={pattern.name}
              data={data}
              update={update}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Guidance() {
  return (
    <details class="method-details">
      <summary>
        <span class="method-summary-title">Which method suits my sample?</span>
      </summary>
      <div class="method-body guidance">
        <p>
          <strong>Scherrer</strong> gives one size per peak and puts all broadening down to size.
          Use it for a quick estimate when strain is small. If strain is present it underestimates
          the size. It becomes unreliable for large crystallites (roughly above 100 nm), whose peaks
          are barely wider than the instrument&apos;s.
        </p>
        <p>
          <strong>Monshi–Scherrer</strong> fits one line through all peaks to get a single size with
          less random error. It still assumes no strain: its slope should be close to 1.
        </p>
        <p>
          <strong>Williamson–Hall UDM</strong> separates size and strain, assuming the strain is the
          same in every direction. It needs several peaks spread over a wide 2θ range (four or more
          is better).
        </p>
        <p>
          <strong>USDM and UDEDM</strong> are Williamson–Hall variants for crystals that are stiffer
          in some directions. USDM assumes the same stress in every direction, UDEDM the same stored
          energy. Both need Young&apos;s modulus, ideally for each peak&apos;s direction; with one
          modulus for all peaks they give the same size as UDM.
        </p>
        <p>
          <strong>Size–strain plot and Halder–Wagner</strong> treat size broadening as Lorentzian
          and strain broadening as Gaussian, which suits peaks between the two shapes (pseudo-Voigt
          η between 0 and 1). They are the same equation in different units, so here they give the
          same answer.
        </p>
        <p>
          When the plot methods disagree strongly, or give a negative size or strain, the sample
          probably does not follow their assumptions: for example, crystallites with different sizes
          in different directions. The app then refuses the impossible value and says why.
        </p>
      </div>
    </details>
  );
}

interface PeakChoicesProps {
  peaks: readonly ResultPeak[];
  patternName: string;
  skipped: boolean;
  /** (hkl) text of each peak by position, when peaks were assigned in the section above. */
  hkl: readonly string[] | undefined;
  setUse: (index: number, use: boolean) => void;
  setModulus: (index: number, value: number | null) => void;
}

function PeakChoices({ peaks, patternName, skipped, hkl, setUse, setModulus }: PeakChoicesProps) {
  const exportCsv = () =>
    downloadCsv(
      `${patternName}-size-peaks`,
      `Peaks used for size and strain, ${patternName}. Widths in degrees 2θ; ${skipped ? 'instrument correction skipped' : 'β is the instrument-corrected FWHM'}.`,
      peaks,
      [
        { header: '2θ (°)', value: (p) => p.twoTheta },
        ...(hkl ? [{ header: '(hkl)', value: (p: ResultPeak) => hkl[p.index] ?? '' }] : []),
        { header: 'Observed FWHM (°)', value: (p) => p.observed },
        { header: 'Corrected β (°)', value: (p) => p.corrected },
        { header: 'σ β (°)', value: (p) => p.correctedSigma },
        { header: 'Used', value: (p) => (p.used ? 'yes' : 'no') },
        { header: 'E_hkl (GPa)', value: (p) => p.modulusGPa ?? '' },
        { header: 'Notes', value: (p) => p.messages.map((m) => m.text).join(' ') },
      ],
    );
  return (
    <section class="peak-table-section" aria-labelledby="choice-title">
      <h3 id="choice-title" class="export-title">
        Peaks
      </h3>
      <p class="field-hint">
        Untick peaks to leave them out of every method. Peaks limited by instrument resolution start
        unticked; peaks with no corrected width cannot be used.
      </p>
      <TableBox label="Peaks used" onExport={exportCsv}>
        <thead>
          <tr>
            <th scope="col">Use</th>
            <th scope="col">2θ (°)</th>
            {hkl && <th scope="col">(hkl)</th>}
            <th scope="col">β (°)</th>
            <th scope="col">E_hkl (GPa)</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {peaks.map((p) => (
            <tr key={p.index} class={p.limited ? 'is-limited' : undefined}>
              <td>
                <label class="check">
                  <input
                    type="checkbox"
                    checked={p.used}
                    disabled={!p.usable}
                    onChange={(e) => setUse(p.index, e.currentTarget.checked)}
                  />
                  <span class="visually-hidden">Use the peak at {p.twoTheta.toFixed(2)}°</span>
                </label>
              </td>
              <td>{p.twoTheta.toFixed(3)}</td>
              {hkl && <td>{hkl[p.index] || '–'}</td>}
              <td>{formatWithSigma(p.corrected, p.correctedSigma)}</td>
              <td>
                <input
                  class="table-input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  aria-label={`Young's modulus for the peak at ${p.twoTheta.toFixed(2)}°, GPa`}
                  value={p.modulusGPa ?? ''}
                  onInput={(e) => {
                    const text = e.currentTarget.value.trim();
                    const v = Number(text);
                    if (text === '') setModulus(p.index, null);
                    else if (v > 0) setModulus(p.index, v);
                  }}
                />
              </td>
              <td class="peak-notes">{p.messages.map((m) => m.text).join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </TableBox>
    </section>
  );
}

const value = (e: Estimate | null, scale = 1) =>
  e ? formatWithSigma(e.value * scale, e.sigma * scale) : '';

function Summary({
  rows,
  patternName,
  data,
}: {
  rows: readonly SummaryRow[];
  patternName: string;
  data: XrdData;
}) {
  const exportCsv = () =>
    downloadCsv(
      `${patternName}-size-strain-summary`,
      `Size and strain summary for ${patternName}. K = ${data.results.k}. Scherrer: mean and standard deviation over peaks; other methods: value and standard uncertainty from the line fit. Strain in the Williamson–Hall convention (β_ε = 4ε tan θ). Empty cells: not defined by the method or not physical.`,
      rows,
      [
        { header: 'Method', value: (r) => METHOD_NAMES[r.method] },
        { header: 'D (nm)', value: (r) => r.size?.value ?? '' },
        { header: 'SD or σ D (nm)', value: (r) => r.size?.sigma ?? '' },
        { header: 'ε', value: (r) => r.strain?.value ?? '' },
        { header: 'σ ε', value: (r) => r.strain?.sigma ?? '' },
        { header: 'Stress (GPa)', value: (r) => r.stress?.value ?? '' },
        { header: 'σ stress (GPa)', value: (r) => r.stress?.sigma ?? '' },
        { header: 'u (kJ/m³)', value: (r) => r.energyDensity?.value ?? '' },
        { header: 'σ u (kJ/m³)', value: (r) => r.energyDensity?.sigma ?? '' },
        { header: 'δ (m⁻²)', value: (r) => r.dislocation?.value ?? '' },
        { header: 'σ δ (m⁻²)', value: (r) => r.dislocation?.sigma ?? '' },
        { header: 'S (m²/g)', value: (r) => r.surface?.value ?? '' },
        { header: 'σ S (m²/g)', value: (r) => r.surface?.sigma ?? '' },
        { header: 'R²', value: (r) => r.rSquared },
        { header: 'Peaks', value: (r) => r.n },
        {
          header: 'Notes',
          value: (r) => [r.unavailable ?? '', ...r.messages.map((m) => m.text)].join(' ').trim(),
        },
      ],
    );
  const problems = rows.flatMap((r) =>
    r.messages
      .filter((m) => m.level !== 'info')
      .map((m) => ({ ...m, text: `${METHOD_NAMES[r.method]}: ${m.text}` })),
  );
  const sizeBars = rows.map((r) => ({
    label: METHOD_SHORT[r.method],
    value: r.size?.value ?? NaN,
    sigma: r.size?.sigma ?? NaN,
  }));
  const strainBars = rows
    .filter((r) => r.method !== 'scherrer' && r.method !== 'monshi')
    .map((r) => ({
      label: METHOD_SHORT[r.method],
      value: (r.strain?.value ?? NaN) * 1e3,
      sigma: (r.strain?.sigma ?? NaN) * 1e3,
    }));
  return (
    <section class="peak-table-section" aria-labelledby="summary-title">
      <h3 id="summary-title" class="export-title">
        Summary
      </h3>
      <p class="field-hint">
        Scherrer: mean ± standard deviation over the peaks. Other methods: value ± standard
        uncertainty from the line fit. ε uses the Williamson–Hall convention. δ = 1/D² is the
        dislocation density as usually reported (lines crossing unit area);{' '}
        <HelpTip term="dislocation density">
          <p>
            1/D² is the common estimate. Williamson and Smallman (1956) instead give 3n/D² for the
            total dislocation length per volume, with n ≥ 1 dislocations per crystallite face, so
            their minimum is three times 1/D². Say which one you report.
          </p>
        </HelpTip>{' '}
        S = 6/(ρD) is the specific surface area. Blank: not defined by the method or not physical
        (see the method below). Problems and checks for every method are listed here too.
      </p>
      <Messages messages={problems} />
      <TableBox label="Summary" onExport={exportCsv}>
        <thead>
          <tr>
            <th scope="col">Method</th>
            <th scope="col">D (nm)</th>
            <th scope="col">ε (10⁻³)</th>
            <th scope="col">Stress (GPa)</th>
            <th scope="col">u (kJ/m³)</th>
            <th scope="col">δ (10¹⁵ m⁻²)</th>
            <th scope="col">S (m²/g)</th>
            <th scope="col">R²</th>
            <th scope="col">Peaks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.method}>
              <th scope="row">
                <a href={`#method-${r.method}`} onClick={(e) => openDetails(e, r.method)}>
                  {METHOD_NAMES[r.method]}
                </a>
              </th>
              {r.unavailable ? (
                <td colSpan={8} class="peak-notes">
                  {r.unavailable}
                </td>
              ) : (
                <>
                  <td>{value(r.size)}</td>
                  <td>{value(r.strain, 1e3)}</td>
                  <td>{value(r.stress)}</td>
                  <td>{value(r.energyDensity)}</td>
                  <td>{value(r.dislocation, 1e-15)}</td>
                  <td>
                    {r.surface ? value(r.surface) : data.results.densityGcm3 ? '' : 'needs ρ'}
                  </td>
                  <td>{Number.isFinite(r.rSquared) ? r.rSquared.toFixed(3) : ''}</td>
                  <td>{r.n}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </TableBox>
      <h3 class="export-title">Crystallite size by method</h3>
      <BarChart
        bars={sizeBars}
        yLabel="Size D (nm)"
        description="Bar chart of crystallite size by method, with error bars."
        exportSettings={data.plot.export}
        exportName={`${patternName}-size-by-method`}
      />
      <h3 class="export-title">Microstrain by method</h3>
      <BarChart
        bars={strainBars}
        yLabel="Strain ε (10⁻³)"
        description="Bar chart of microstrain by method, with error bars."
        exportSettings={data.plot.export}
        exportName={`${patternName}-strain-by-method`}
      />
    </section>
  );
}

/** Opens a method's details when its name is clicked in the summary. */
function openDetails(event: Event, method: string) {
  const details = document.getElementById(`method-${method}`);
  if (details instanceof HTMLDetailsElement) {
    event.preventDefault();
    details.open = true;
    details.scrollIntoView({ block: 'start' });
    details.querySelector('summary')?.focus();
  }
}
