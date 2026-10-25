import { useMemo, useState } from 'preact/hooks';
import { displayExoUp } from '../../../core/thermal/dscClean';
import { DSC_NO_CERTAINTY_NOTE } from '../../../core/thermal/dscGuidance';
import { HelpTip } from '../../../ui/HelpTip';
import { SessionSection } from '../../../ui/SessionSection';
import type { StepContext } from '../../../ui/wizard/types';
import { downloadCsv } from '../../xrd/csv';
import { eventBands, useDscCurve, useDscView } from './analysis';
import { COMBINED_UNVERIFIED_NOTE, useCombined } from './combinedAnalysis';
import type { DscData } from './data';
import { DscPlot } from './DscPlot';
import { num } from './EventsStep';
import { dscMethodsText } from './methodsText';
import { dscSession } from './session';

/** Index of this step in the wizard, saved in the session file as the step on screen. */
const RESULTS_STEP = 5;

/** DSC wizard step 6: tables with the sign convention, CSV downloads and the figure. */
export function DscResultsStep({ data, update }: StepContext<DscData>) {
  const { cleaned } = useDscCurve(data);
  const view = useDscView(data, cleaned);
  const curve = cleaned?.ok ? cleaned.curve : null;
  const combined = useCombined(data, curve, view?.events ?? []);
  const methods = useMemo(
    () => (curve && view ? dscMethodsText(data, curve, view, combined) : ''),
    [data, curve, view, combined],
  );
  const [copied, setCopied] = useState<string | null>(null);
  if (!curve || !view) {
    return (
      <p class="message is-error" role="alert">
        There is no DSC curve yet. Go back to the earlier steps.
      </p>
    );
  }
  const { events, glass, crystallinity: cryst } = view;
  const exoUp = displayExoUp(data.setup);
  const convention = `exo ${exoUp ? 'up' : 'down'} on plots; ΔH endothermic positive`;
  const label = (id: number) => data.assignments[id]?.label ?? '';
  const g = glass?.ok ? glass.glass : null;
  const hu = curve.specific ? 'J/g' : 'mJ';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(methods);
      setCopied('Copied.');
    } catch {
      setCopied('Copying is blocked in this browser. Select the text and copy it by hand.');
    }
  };
  const combinedRows = combined.ok
    ? view.events.map((e, i) => ({
        event: e,
        correlation: combined.view.correlations[i],
        top: combined.view.eventGuidance.get(e.id)?.[0],
      }))
    : [];

  return (
    <div class="results-step">
      <p class="message is-info" role="note">
        {curve.segment.label}. Sign convention: exothermic peaks point {exoUp ? 'up' : 'down'} on
        the plot; ΔH is positive for endothermic events and negative for exothermic ones.
      </p>

      <section aria-labelledby="dsc-events-title">
        <h3 id="dsc-events-title" class="export-title">
          Events{' '}
          <HelpTip term="onset, peak and endset">
            <p>
              Onset and endset are extrapolated from the steepest flank to the baseline, so they are
              less sensitive to noise than the first visible deviation. Peak is the largest distance
              from the baseline.
            </p>
          </HelpTip>
        </h3>
        {events.length === 0 ? (
          <p class="field-hint">No events. Go back to step 3.</p>
        ) : (
          <div class="table-scroll">
            <table class="peak-table">
              <caption>
                Events of {curve.segment.label.toLowerCase()}; {convention}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Type</th>
                  <th scope="col">Onset (°C)</th>
                  <th scope="col">Peak (°C)</th>
                  <th scope="col">Endset (°C)</th>
                  <th scope="col">ΔH ({hu})</th>
                  {data.molarMassGPerMol !== null && <th scope="col">ΔH (kJ/mol)</th>}
                  <th scope="col">Interpretation (your choice)</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <th scope="row">{e.id}</th>
                    <td>{e.direction === 'endo' ? 'endothermic' : 'exothermic'}</td>
                    <td>{num(e.onsetC)}</td>
                    <td>{num(e.peakC)}</td>
                    <td>{num(e.endsetC)}</td>
                    <td>{num(e.enthalpy, 2)}</td>
                    {data.molarMassGPerMol !== null && <td>{num(e.enthalpyKJPerMol, 2)}</td>}
                    <td>{label(e.id) || 'not assigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p class="field-hint">{DSC_NO_CERTAINTY_NOTE}</p>
        <div class="export-actions">
          <button
            type="button"
            class="btn btn-primary"
            disabled={events.length === 0}
            onClick={() =>
              downloadCsv('dsc-events', `${curve.segment.label}; ${convention}`, events, [
                { header: 'Event', value: (e) => e.id },
                {
                  header: 'Type',
                  value: (e) => (e.direction === 'endo' ? 'endothermic' : 'exothermic'),
                },
                { header: 'Onset (C)', value: (e) => e.onsetC },
                { header: 'Peak (C)', value: (e) => e.peakC },
                { header: 'Endset (C)', value: (e) => e.endsetC },
                { header: `DeltaH (${hu})`, value: (e) => e.enthalpy ?? '' },
                { header: 'DeltaH (kJ/mol)', value: (e) => e.enthalpyKJPerMol ?? '' },
                { header: 'Interpretation (user)', value: (e) => label(e.id) },
              ])
            }
          >
            Download events (CSV)
          </button>
        </div>
      </section>

      {g && (
        <section aria-labelledby="dsc-glass-title">
          <h3 id="dsc-glass-title" class="export-title">
            Glass transition
          </h3>
          <div class="table-scroll">
            <table class="peak-table">
              <caption>
                Glass transition of {curve.segment.label.toLowerCase()}; {convention}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Tg midpoint (°C)</th>
                  <th scope="col">Onset (°C)</th>
                  <th scope="col">Endset (°C)</th>
                  <th scope="col">ΔCp (J/(g·K))</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{num(g.midpointC)}</td>
                  <td>{num(g.onsetC)}</td>
                  <td>{num(g.endsetC)}</td>
                  <td>{num(g.deltaCp, 3)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="export-actions">
            <button
              type="button"
              class="btn"
              onClick={() =>
                downloadCsv(
                  'dsc-glass-transition',
                  `${curve.segment.label}; ${convention}`,
                  [g],
                  [
                    { header: 'Tg midpoint (C)', value: (x) => x.midpointC },
                    { header: 'Onset (C)', value: (x) => x.onsetC },
                    { header: 'Endset (C)', value: (x) => x.endsetC },
                    { header: 'Delta Cp (J/(g K))', value: (x) => x.deltaCp ?? '' },
                  ],
                )
              }
            >
              Download glass transition (CSV)
            </button>
          </div>
        </section>
      )}

      {cryst.result?.ok && cryst.melting && (
        <section aria-labelledby="dsc-cryst-title">
          <h3 id="dsc-cryst-title" class="export-title">
            Crystallinity
          </h3>
          <p>
            Xc ≈ {num(cryst.result.percent, 1)} % (an estimate) from event {cryst.melting.id}
            {cryst.cold ? ` minus event ${cryst.cold.id}` : ''}, w ={' '}
            {data.crystallinity.weightFraction}, ΔH0 = {data.crystallinity.fullyCrystallineJPerG}{' '}
            J/g (entered by you).
          </p>
          <div class="export-actions">
            <button
              type="button"
              class="btn"
              onClick={() =>
                downloadCsv(
                  'dsc-crystallinity',
                  `${curve.segment.label}; ${convention}`,
                  [cryst],
                  [
                    { header: 'Melting event', value: (c) => c.melting?.id ?? '' },
                    { header: 'Cold crystallisation event', value: (c) => c.cold?.id ?? '' },
                    { header: 'DeltaHm (J/g)', value: (c) => c.melting?.enthalpy ?? '' },
                    { header: 'DeltaHcc (J/g)', value: (c) => c.cold?.enthalpy ?? '' },
                    { header: 'w', value: () => data.crystallinity.weightFraction },
                    {
                      header: 'DeltaH0 (J/g)',
                      value: () => data.crystallinity.fullyCrystallineJPerG ?? '',
                    },
                    { header: 'Xc (%)', value: (c) => (c.result?.ok ? c.result.percent : '') },
                  ],
                )
              }
            >
              Download crystallinity (CSV)
            </button>
          </div>
        </section>
      )}

      {combined.ok && (
        <section aria-labelledby="dsc-combined-title">
          <h3 id="dsc-combined-title" class="export-title">
            Combined TGA-DSC (guidance)
          </h3>
          <p class="field-hint">
            Mass from the {combined.view.source}. The readings and top suggestions are guidance from
            the direction of the peak and the mass change; they are not identifications.{' '}
            {COMBINED_UNVERIFIED_NOTE}
          </p>
          <div class="table-scroll">
            <table class="peak-table">
              <caption>DSC events read against the mass curve; {convention}</caption>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Peak (°C)</th>
                  <th scope="col">Type</th>
                  <th scope="col">Mass change (% points)</th>
                  <th scope="col">Top suggestion (re-ranked)</th>
                  <th scope="col">Interpretation (your choice)</th>
                </tr>
              </thead>
              <tbody>
                {combinedRows.map(({ event, correlation, top }) => (
                  <tr key={event.id}>
                    <th scope="row">{event.id}</th>
                    <td>{num(event.peakC)}</td>
                    <td>{event.direction === 'endo' ? 'endothermic' : 'exothermic'}</td>
                    <td>{num(correlation?.massChangePct, 2)}</td>
                    <td>{top ? `${top.rule.name} (${top.confidence} confidence)` : 'none'}</td>
                    <td>{label(event.id) || 'not assigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="export-actions">
            <button
              type="button"
              class="btn"
              disabled={combinedRows.length === 0}
              onClick={() =>
                downloadCsv(
                  'tga-dsc-events',
                  `Combined TGA-DSC, mass from the ${combined.view.source}; ${convention}; suggestions are guidance, not identifications`,
                  combinedRows,
                  [
                    { header: 'Event', value: (r) => r.event.id },
                    { header: 'Peak (C)', value: (r) => r.event.peakC },
                    {
                      header: 'Type',
                      value: (r) => (r.event.direction === 'endo' ? 'endothermic' : 'exothermic'),
                    },
                    {
                      header: 'Mass change (% points)',
                      value: (r) => r.correlation?.massChangePct ?? '',
                    },
                    { header: 'Reading', value: (r) => r.correlation?.text ?? '' },
                    { header: 'Top suggestion', value: (r) => r.top?.rule.name ?? '' },
                    { header: 'Confidence', value: (r) => r.top?.confidence ?? '' },
                    { header: 'Interpretation (user)', value: (r) => label(r.event.id) },
                  ],
                )
              }
            >
              Download combined events (CSV)
            </button>
          </div>
          {combined.view.marks.length > 0 && (
            <>
              <h4>Calcination: exotherms above the last mass loss step</h4>
              <ul>
                {combined.view.marks.map((m) => (
                  <li key={m.eventId}>{m.text}</li>
                ))}
              </ul>
              <div class="export-actions">
                <button
                  type="button"
                  class="btn"
                  onClick={() =>
                    downloadCsv(
                      'tga-dsc-calcination-marks',
                      'Exotherms without mass change above the last mass loss step (guidance; confirm by XRD)',
                      combined.view.marks,
                      [
                        { header: 'Event', value: (m) => m.eventId },
                        { header: 'Peak (C)', value: (m) => m.peakC },
                        {
                          header: 'Candidates below it (C)',
                          value: (m) => m.candidatesBelowC.join(' '),
                        },
                        { header: 'Note', value: (m) => m.text },
                      ],
                    )
                  }
                >
                  Download calcination marks (CSV)
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="dsc-figure-title">
        <h3 id="dsc-figure-title" class="export-title">
          Figure
        </h3>
        <DscPlot
          lines={[
            {
              id: 'curve',
              name: curve.segment.label,
              temperatureC: curve.temperatureC,
              exo: curve.exo,
            },
          ]}
          unit={curve.unit}
          setup={data.setup}
          events={events}
          bands={eventBands(events)}
          settings={data.plot}
          onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
          exportName="dsc-results"
        />
      </section>

      <section aria-labelledby="dsc-methods-title">
        <h3 id="dsc-methods-title" class="export-title">
          Methods text
        </h3>
        <p class="field-hint">
          Written only from the settings you used. Nothing about the instrument is included because
          the data files do not say; add it yourself.
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

      <SessionSection
        codec={dscSession}
        data={data}
        update={update}
        step={RESULTS_STEP}
        stem={data.file?.name ?? 'dsc'}
      />
    </div>
  );
}
