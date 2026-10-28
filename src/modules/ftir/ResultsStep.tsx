import { RecordSection } from '../../ui/report/RecordSection';
import { ftirRecord } from './record';
import { useMemo, useState } from 'preact/hooks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import { SessionSection } from '../../ui/SessionSection';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { peakRows, processAll } from './analysis';
import type { FtirData } from './data';
import { curveOf, FtirPlot } from './FtirPlot';
import { methodsText } from './methodsText';
import { QuantityChoice } from './QuantityChoice';
import { quantityHeading, shownQuantity, valueIn } from './quantity';
import { ftirSession } from './session';

/** Index of this step in the wizard, saved in the session file as the step on screen. */
const RESULTS_STEP = 5;

/** Wizard step 5: peak table with assignments, figure, processed data, methods text and session. */
export function ResultsStep({ data, update }: StepContext<FtirData>) {
  const rows = useMemo(() => peakRows(data), [data]);
  const methods = useMemo(() => methodsText(data), [data]);
  const processed = useMemo(
    () => processAll(data.spectra, data.processing),
    [data.spectra, data.processing],
  );
  const curves = useMemo(
    () =>
      data.spectra.flatMap((s, i) => {
        const p = processed[i];
        return p ? [curveOf(s.id, s.name, p, { colorIndex: i })] : [];
      }),
    [data.spectra, processed],
  );
  const [copied, setCopied] = useState<string | null>(null);
  if (data.spectra.length === 0) return <p>No spectra are loaded. Go back to Upload to add one.</p>;

  const shown = shownQuantity(data, data.spectra);
  const quantity = shown.quantity;
  const percentT = quantity === 'transmittance';
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
      <section aria-labelledby="peaks-title">
        <h3 id="peaks-title" class="export-title">
          Peaks and assignments{' '}
          <HelpTip term="results table">
            <p>
              Wavenumbers are the positions of the picked peaks, in cm⁻¹. Intensities are absorbance
              after the processing of step 2 (and, when transmittance is shown, the same point as %T
              = 100 · 10^−A). The assignment column holds only what you accepted or typed in step 4;
              the suggestions come from typical ranges and are estimates, not proof of the groups
              present.
            </p>
          </HelpTip>
        </h3>
        <QuantityChoice data={data} update={update} shown={shown} />
        <div
          class="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Peak table, scrolls sideways"
        >
          <table class="peak-table">
            <thead>
              <tr>
                <th scope="col">Sample</th>
                <th scope="col">Wavenumber (cm⁻¹)</th>
                <th scope="col">Absorbance</th>
                {percentT && <th scope="col">{quantityHeading(quantity)}</th>}
                <th scope="col">Relative (%)</th>
                <th scope="col">Assignment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.spectrum.id}-${r.peak.wavenumber}`}>
                  <th scope="row">{r.spectrum.name}</th>
                  <td>{formatNumber(r.peak.wavenumber, 1)}</td>
                  <td>{formatNumber(r.peak.height, 4)}</td>
                  {percentT && <td>{formatNumber(valueIn(quantity, r.peak.height), 2)}</td>}
                  <td>{formatNumber(r.peak.relative, 1)}</td>
                  <td>{r.assignment || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p class="message is-warning">
            <strong>Check:</strong> no peaks were picked. Go back to step 3 and lower the minimum
            prominence.
          </p>
        )}
        <div class="export-actions">
          <button
            type="button"
            class="btn btn-primary"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                'ftir-peaks',
                'FTIR peaks picked on the processed absorbance. Assignments were accepted or typed by the user from typical ranges; they are estimates.',
                rows,
                [
                  { header: 'Sample', value: (r) => r.spectrum.name },
                  { header: 'Wavenumber (cm-1)', value: (r) => r.peak.wavenumber },
                  { header: 'Absorbance (processed)', value: (r) => r.peak.height },
                  ...(percentT
                    ? [
                        {
                          header: 'Transmittance (%)',
                          value: (r: (typeof rows)[number]) => valueIn(quantity, r.peak.height),
                        },
                      ]
                    : []),
                  { header: 'Relative intensity (%)', value: (r) => r.peak.relative },
                  { header: 'Prominence', value: (r) => r.peak.prominence },
                  { header: 'Assignment', value: (r) => r.assignment },
                ],
              )
            }
          >
            Download peaks (CSV)
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => {
              const long = data.spectra.flatMap((s, i) => {
                const p = processed[i];
                return p
                  ? Array.from(p.wavenumber, (wn, k) => ({ s, wn, a: p.absorbance[k] as number }))
                  : [];
              });
              downloadCsv(
                'ftir-processed-spectra',
                `FTIR spectra after the processing of step 2. Absorbance is unitless; measured transmittance was converted with A = 2 - log10(%T) before processing.${percentT ? ' Transmittance (%) = 100 x 10^(-A) of the processed absorbance, the quantity shown in the figure.' : ''}`,
                long,
                [
                  { header: 'Sample', value: (r) => r.s.name },
                  { header: 'Wavenumber (cm-1)', value: (r) => r.wn },
                  { header: 'Absorbance (processed)', value: (r) => r.a },
                  ...(percentT
                    ? [
                        {
                          header: 'Transmittance (%) (processed)',
                          value: (r: (typeof long)[number]) => valueIn(quantity, r.a),
                        },
                      ]
                    : []),
                ],
              );
            }}
          >
            Download processed spectra (CSV)
          </button>
        </div>
      </section>

      <section aria-labelledby="figure-title">
        <h3 id="figure-title" class="export-title">
          Figure
        </h3>
        <p class="field-hint">
          All spectra together; use the vertical offset to stack them. For a figure with peak labels
          of one spectrum, export the plot in step 3 or 4.
        </p>
        <FtirPlot
          curves={curves}
          quantity={quantity}
          settings={data.plot}
          onSettingsChange={(plot) => update({ plot: { ...data.plot, ...plot } })}
          exportName="ftir-spectra"
        />
      </section>

      <section aria-labelledby="methods-title">
        <h3 id="methods-title" class="export-title">
          Methods text
        </h3>
        <p class="field-hint">
          Written only from the settings you used. Nothing about the spectrometer is included
          because the data files do not say; add it yourself.
        </p>
        <textarea
          class="methods-text"
          readOnly
          rows={9}
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

      <RecordSection build={() => ftirRecord(data)} stem={data.spectra[0]?.name ?? 'ftir'} />

      <SessionSection
        codec={ftirSession}
        data={data}
        update={update}
        step={RESULTS_STEP}
        stem={data.spectra[0]?.name ?? 'ftir'}
      />
    </div>
  );
}
