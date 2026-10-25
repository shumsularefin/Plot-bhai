import { RecordSection } from '../../ui/report/RecordSection';
import { uvvisRecord } from './record';
import { useMemo, useState } from 'preact/hooks';
import { TRANSITIONS } from '../../core/uvvis/tauc';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import { SessionSection } from '../../ui/SessionSection';
import type { StepContext } from '../../ui/wizard/types';
import { resultRows } from './analysis';
import type { UvvisData } from './data';
import { downloadCsv } from '../xrd/csv';
import { methodsText } from './methodsText';
import { uvvisSession } from './session';
import { gapText, RESULTS_NOTE, RESULT_COLUMNS } from './tables';

/** Index of this step in the wizard, saved in the session file as the step on screen. */
const RESULTS_STEP = 3;

const eV = (value: number, digits = 3) => formatNumber(value, digits);

/** Wizard step 4: results table, methods text and the session file. */
export function ResultsStep({ data, update }: StepContext<UvvisData>) {
  const rows = useMemo(() => resultRows(data), [data]);
  const methods = useMemo(() => methodsText(data), [data]);
  const [copied, setCopied] = useState<string | null>(null);

  if (data.spectra.length === 0) {
    return <p>No spectra are loaded. Go back to Upload to add one.</p>;
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
          chose in step 3. Report them together.
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
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fit = r.analysis.fit;
                const urbach = r.analysis.urbach?.fit;
                return (
                  <tr key={r.spectrum.id}>
                    <th scope="row">{r.spectrum.name}</th>
                    <td>{r.lambdaMax ? eV(r.lambdaMax.wavelengthNm, 2) : '–'}</td>
                    <td>{r.edgeNm !== null ? eV(r.edgeNm, 1) : '–'}</td>
                    <td>{fit ? gapText(fit) : 'no fit'}</td>
                    <td>
                      {TRANSITIONS[r.choice.transition].label} (n ={' '}
                      {TRANSITIONS[r.choice.transition].nText})
                    </td>
                    <td>{fit ? fit.rSquared.toFixed(4) : '–'}</td>
                    <td>Tauc{r.analysis.derivative ? ', derivative' : ''}</td>
                    <td>
                      {urbach
                        ? `${eV(urbach.euEv * 1000, 1)} ± ${Number.isFinite(urbach.euSigma) ? eV(urbach.euSigma * 1000, 1) : '?'}`
                        : '–'}
                    </td>
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
              .map((r) => r.spectrum.name)
              .join(', ')}{' '}
            has no band gap fit. Go back to step 3 and choose a fit region.
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

      <section aria-labelledby="figures-title">
        <h3 id="figures-title" class="export-title">
          Figures
        </h3>
        <p class="field-hint">
          Every plot has its own export panel (SVG, and PNG at 300 or 600 dpi, in single or double
          column width): the spectra in step 2, and the Tauc plot with its fit line in step 3. Go
          back to that step to export the figure you need.
        </p>
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
