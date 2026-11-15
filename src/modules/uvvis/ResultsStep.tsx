import { RecordSection } from '../../ui/report/RecordSection';
import { uvvisRecord } from './record';
import { useMemo, useState } from 'preact/hooks';
import { GAP_METHODS, TRANSITIONS } from '../../core/uvvis/tauc';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import { SessionSection } from '../../ui/SessionSection';
import type { StepContext } from '../../ui/wizard/types';
import { resultJobs, rowsFrom } from './analysis';
import type { BandGapAnalysis } from './bandGap';
import { useBandGaps } from './bandGapClient';
import { BAND_COLUMNS, BAND_NOTE, bandRows } from './bands';
import { ResultsFigures } from './ResultsFigures';
import type { UvvisData } from './data';
import { downloadCsv } from '../xrd/csv';
import { methodsText } from './methodsText';
import { uvvisSession } from './session';
import { gapText, powerBaselineText, RESULTS_NOTE, RESULT_COLUMNS } from './tables';

/** Index of this step in the wizard, saved in the session file as the step on screen. */
const RESULTS_STEP = 4;

const eV = (value: number, digits = 3) => formatNumber(value, digits);

/** Wizard step 5: results table, figures, methods text and the session file. */
export function ResultsStep({ data, update }: StepContext<UvvisData>) {
  const pending = useMemo(() => resultJobs(data), [data]);
  const jobs = useMemo(() => pending.map((r) => r.job), [pending]);
  const gaps = useBandGaps(jobs);
  const rows = useMemo(
    () => (gaps.analyses ? rowsFrom(pending, gaps.analyses) : null),
    [pending, gaps.analyses],
  );
  const methods = useMemo(() => (rows ? methodsText(data, rows) : ''), [data, rows]);
  const bands = useMemo(() => bandRows(data), [data]);
  const [copied, setCopied] = useState<string | null>(null);

  if (data.spectra.length === 0) {
    return <p>No spectra are loaded. Go back to Upload to add one.</p>;
  }
  if (!rows) {
    return gaps.error ? (
      <p class="message is-warning" role="alert">
        The band gaps could not be found: {gaps.error}
      </p>
    ) : (
      <p role="status">Finding the band gaps…</p>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied('Copied.');
    } catch {
      setCopied('Copying is blocked in this browser. Select the text and copy it by hand.');
    }
  };

  return (
    <div class="export-step">
      <section aria-labelledby="results-title">
        <h3 id="results-title" class="export-title">
          Results{' '}
          <HelpTip term="results table">
            <p>
              E<sub>g</sub> is the optical band gap from the straight-line fit of the Tauc plot, in
              eV, and the absorption edge is the wavelength with that photon energy. The ± is the
              uncertainty of the line fit only; it does not include the effect of choosing the fit
              region or the transition type. λmax is the highest point of the absorbance (or F(R)
              for reflectance).
            </p>
          </HelpTip>
        </h3>
        <p class="message">
          <strong>Estimates:</strong> the band gaps depend on the transition type and fit region you
          chose in step 4. Report them together. Cody and sigmoid values are cross-checks, shown
          next to the Tauc value, not in its place.
        </p>
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Results table, scrolls sideways"
        >
          <table class="peak-table">
            <thead>
              <tr>
                <th scope="col">Sample</th>
                <th scope="col">
                  λ<sub>max</sub> (nm)
                </th>
                <th scope="col">Edge (nm)</th>
                <th scope="col">
                  E<sub>g</sub> (eV)
                </th>
                <th scope="col">Transition</th>
                <th scope="col">R²</th>
                <th scope="col">Method</th>
                <th scope="col">
                  E<sub>u</sub> (meV)
                </th>
                <th scope="col">Cross-checks (eV)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fit = r.analysis.fit;
                const urbach = r.analysis.urbach?.fit;
                return (
                  <tr key={`${r.spectrum.id}-${r.choice.transition}`}>
                    <th scope="row">
                      {r.spectrum.name}
                      {r.primary ? '' : ' (also reported)'}
                    </th>
                    <td>{r.lambdaMax ? eV(r.lambdaMax.wavelengthNm, 2) : '–'}</td>
                    <td>{r.edgeNm !== null ? eV(r.edgeNm, 1) : '–'}</td>
                    <td>{fit ? gapText(fit) : 'no fit'}</td>
                    <td>
                      {TRANSITIONS[r.choice.transition].label} (n ={' '}
                      {TRANSITIONS[r.choice.transition].nText})
                    </td>
                    <td>{fit ? fit.rSquared.toFixed(4) : '–'}</td>
                    <td>
                      Tauc, {fit ? GAP_METHODS[r.analysis.method].short : 'no fit'}
                      {fit && r.analysis.powerBaseline ? `; ${powerBaselineText(r.analysis)}` : ''}
                      {r.analysis.derivative ? '; derivative' : ''}
                    </td>
                    <td>
                      {urbach
                        ? `${eV(urbach.euEv * 1000, 1)} ± ${Number.isFinite(urbach.euSigma) ? eV(urbach.euSigma * 1000, 1) : '?'}`
                        : '–'}
                    </td>
                    <td>{crossChecks(r.analysis)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.some((r) => !r.analysis.fit) && (
          <p class="message is-warning">
            <strong>Check:</strong>{' '}
            {rows
              .filter((r) => !r.analysis.fit)
              .map(
                (r) =>
                  `${r.spectrum.name} (${TRANSITIONS[r.choice.transition].label.toLowerCase()})`,
              )
              .join(', ')}{' '}
            has no band gap fit. Go back to step 4 and choose a fit region.
          </p>
        )}
        <div class="export-actions">
          <button
            type="button"
            class="btn btn-primary"
            onClick={() => downloadCsv('uvvis-results', RESULTS_NOTE, rows, RESULT_COLUMNS)}
          >
            Download results (CSV)
          </button>
        </div>
      </section>

      <section aria-labelledby="bands-title">
        <h3 id="bands-title" class="export-title">
          Absorption bands ({bands.length})
        </h3>
        <p class="field-hint">
          The band tables of step 3 for every spectrum: position in nm and eV, value, prominence and
          origin. λmax above is still the highest data point.
        </p>
        <div class="export-actions">
          <button
            type="button"
            class="btn"
            disabled={bands.length === 0}
            onClick={() => downloadCsv('uvvis-bands', BAND_NOTE, bands, BAND_COLUMNS)}
          >
            Download band table (CSV)
          </button>
        </div>
      </section>

      <section aria-labelledby="figures-title">
        <h3 id="figures-title" class="export-title">
          Figures
        </h3>
        <p class="field-hint">
          Each figure has its own export panel (SVG, and PNG at 300 or 600 dpi, in single or double
          column width). The plots of each step can be exported there too.
        </p>
        <ResultsFigures data={data} update={update} />
      </section>

      <section aria-labelledby="methods-title">
        <h3 id="methods-title" class="export-title">
          Methods text
        </h3>
        <p class="field-hint">
          Written only from the settings you used. Check it against your own experimental details
          before it goes into a paper; nothing about the spectrometer is included because the data
          files do not say.
        </p>
        <textarea
          class="methods-text"
          readOnly
          rows={10}
          value={methods}
          aria-label="Methods paragraph"
        />
        <div class="export-actions">
          <button type="button" class="btn" onClick={() => void copy()}>
            Copy text
          </button>
        </div>
        <p class="export-status" role="status">
          {copied}
        </p>
      </section>

      <RecordSection build={() => uvvisRecord(data)} stem={data.spectra[0]?.name ?? 'uvvis'} />

      <SessionSection
        codec={uvvisSession}
        data={data}
        update={update}
        step={RESULTS_STEP}
        stem={data.spectra[0]?.name ?? 'uvvis'}
      />
    </div>
  );
}

/** Cody and sigmoid band gaps of a row, for example "Cody 3.21 ± 0.01; sigmoid 3.19". */
function crossChecks(analysis: BandGapAnalysis): string {
  const parts: string[] = [];
  if (analysis.cody?.fit) parts.push(`Cody ${gapText(analysis.cody.fit)}`);
  if (analysis.sigmoid?.fit) parts.push(`sigmoid ${gapText(analysis.sigmoid.fit)}`);
  return parts.length > 0 ? parts.join('; ') : '–';
}
