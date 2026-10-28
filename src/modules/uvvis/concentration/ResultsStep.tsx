import { useMemo, useState } from 'preact/hooks';
import { concentrationFrom } from '../../../core/uvvis/concentration';
import { formatNumber } from '../../../core/xrd/parsers/numbers';
import { HelpTip } from '../../../ui/HelpTip';
import { PlotPanel } from '../../../ui/plot/PlotPanel';
import { SessionSection } from '../../../ui/SessionSection';
import type { StepContext } from '../../../ui/wizard/types';
import { downloadCsv } from '../../xrd/csv';
import { NumberInput } from '../../xrd/NumberInput';
import { analyse } from './analysis';
import type { ConcentrationData } from './data';
import { methodsText } from './methodsText';
import { concentrationSession } from './session';

/** Index of this step in the wizard, saved in the session file as the step on screen. */
const RESULTS_STEP = 2;

const num = (v: number | null | undefined, digits = 3) =>
  v === null || v === undefined || !Number.isFinite(v) ? '–' : formatNumber(v, digits);
const sig = (v: number) =>
  Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : num(v, 4);

/** Step 3: calibration line, kinetics, figures, methods text and session file. */
export function ResultsStep({ data, update }: StepContext<ConcentrationData>) {
  const outcome = useMemo(() => analyse(data), [data]);
  const methods = useMemo(() => methodsText(data, outcome), [data, outcome]);
  const [copied, setCopied] = useState<string | null>(null);
  const { calibration: cal, kinetics: kin, standards } = outcome;
  const unit = data.unit || 'your unit';
  const plotProps = {
    settings: data.plot,
    onSettingsChange: (p: Partial<ConcentrationData['plot']>) =>
      update({ plot: { ...data.plot, ...p } }),
    showOverlayOptions: false,
    dock: 'manual' as const,
  };

  const calibrationPlot = useMemo(() => {
    if (!cal) return null;
    const xs = standards.map((s) => s.sample.value as number);
    const ends = Float64Array.of(Math.min(0, ...xs), Math.max(...xs));
    return {
      line: [
        {
          id: 'fit',
          name: 'Calibration line',
          x: ends,
          y: ends.map((c) => cal.fit.intercept + cal.fit.slope * c),
          unit: '',
        },
      ],
      points: standards.map((s) => ({ x: s.sample.value as number, y: s.absorbance })),
    };
  }, [cal, standards]);

  const outside = cal
    ? outcome.timed.filter((t) => {
        const c = concentrationFrom(t.absorbance, cal);
        return c < cal.range[0] || c > cal.range[1];
      }).length
    : 0;

  const kineticPlots = useMemo(() => {
    if (!kin) return null;
    const t0 = kin.referenceTimeMin;
    const tMax = Math.max(...kin.points.map((p) => p.timeMin));
    const ts = Float64Array.from({ length: 101 }, (_, i) => t0 + ((tMax - t0) * i) / 100);
    const fitted = kin.points.filter((p) => p.timeMin >= t0 && p.lnRatio !== null);
    return {
      ratioLine: [
        {
          id: 'model',
          name: 'Pseudo-first-order fit',
          x: ts,
          y: ts.map((t) => Math.exp(-kin.kPerMin * (t - t0))),
          unit: '',
        },
      ],
      ratioPoints: kin.points.map((p) => ({ x: p.timeMin, y: p.ratio })),
      lnLine: [
        {
          id: 'fit',
          name: 'Straight line through the origin',
          x: Float64Array.of(t0, tMax),
          y: Float64Array.of(0, kin.kPerMin * (tMax - t0)),
          unit: '',
        },
      ],
      lnPoints: fitted.map((p) => ({ x: p.timeMin, y: p.lnRatio as number })),
    };
  }, [kin]);

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
      {standards.length >= 2 && (
        <section aria-labelledby="cal-title">
          <h3 id="cal-title" class="export-title">
            Calibration line (Beer–Lambert){' '}
            <HelpTip term="Beer–Lambert law">
              <p>
                A = ε b c: absorbance is proportional to concentration c and path length b. ε is the
                absorptivity. It holds only at low absorbance; check that the standards lie on a
                straight line and that samples fall inside their range.
              </p>
            </HelpTip>
          </h3>
          <div class="run-form">
            <NumberInput
              label="Path length (cm)"
              value={data.pathCm}
              min={0}
              onChange={(v) => v !== null && update({ pathCm: v })}
            />
            <label class="check">
              <input
                type="checkbox"
                checked={data.throughOrigin}
                onChange={(e) => update({ throughOrigin: e.currentTarget.checked })}
              />
              Force the line through zero (blank-corrected standards)
            </label>
          </div>
          {cal ? (
            <>
              <p class="message is-info" role="note">
                A = {data.throughOrigin ? '' : `${sig(cal.fit.intercept)} + `}
                {sig(cal.fit.slope)} · c, R² = {cal.fit.rSquared.toFixed(4)}. Absorptivity ε ={' '}
                {sig(cal.absorptivity)} ± {sig(cal.absorptivitySigma)} ({unit})⁻¹ cm⁻¹.
              </p>
              {cal.fit.rSquared < 0.99 && (
                <p class="message is-warning">
                  The standards scatter around the line (R² below 0.99). Check them, or leave out
                  the highest ones if the absorbance there is above about 1.
                </p>
              )}
              {outside > 0 && (
                <p class="message is-warning">
                  {outside} sample{outside === 1 ? '' : 's'} over time fall outside the range of the
                  standards, so their concentration is extrapolated.
                </p>
              )}
              {calibrationPlot && (
                <PlotPanel
                  {...plotProps}
                  sources={calibrationPlot.line}
                  points={calibrationPlot.points}
                  labels={() => ({ x: `Concentration (${unit})`, y: 'Absorbance', yValues: true })}
                  xName="c"
                  xUnit={` ${unit}`}
                  exportName="calibration-line"
                />
              )}
              <div class="export-actions">
                <button
                  type="button"
                  class="btn"
                  onClick={() =>
                    downloadCsv(
                      'calibration',
                      `Beer-Lambert calibration at ${num(outcome.wavelengthNm, 1)} nm; A = ${cal.fit.intercept} + ${cal.fit.slope} c; R2 ${cal.fit.rSquared}; absorptivity ${cal.absorptivity} (${unit})^-1 cm^-1, path ${data.pathCm} cm`,
                      standards,
                      [
                        { header: 'Standard', value: (s) => s.sample.name },
                        { header: `Concentration (${unit})`, value: (s) => s.sample.value ?? '' },
                        { header: 'Absorbance', value: (s) => s.absorbance },
                      ],
                    )
                  }
                >
                  Download calibration (CSV)
                </button>
              </div>
            </>
          ) : (
            <p class="message is-error">
              No line could be fitted. The standards need at least two different concentrations.
            </p>
          )}
        </section>
      )}

      {outcome.timed.length >= 2 && (
        <section aria-labelledby="kin-title">
          <h3 id="kin-title" class="export-title">
            Kinetics (pseudo-first-order){' '}
            <HelpTip term="pseudo-first-order kinetics">
              <p>
                ln(C₀/C) = k t. C/C₀ is taken as A/A₀ (same cell and wavelength). C₀ is the sample
                at t = 0, after any dark period. k is an apparent rate constant for these conditions
                (catalyst amount, light, starting concentration), not a property of the material
                alone.
              </p>
            </HelpTip>
          </h3>
          {kin ? (
            <>
              <p class="message is-info" role="note">
                k = {sig(kin.kPerMin)} ± {sig(kin.kSigma)} min⁻¹ (R² = {kin.fit.rSquared.toFixed(4)}
                ){kin.halfLifeMin !== null && `, half-life ${num(kin.halfLifeMin, 1)} min`}. Removal
                after {num(kin.points[kin.points.length - 1]?.timeMin, 0)} min:{' '}
                {num(kin.points[kin.points.length - 1]?.removalPct, 1)} %.
              </p>
              {kin.fit.rSquared < 0.95 && (
                <p class="message is-warning">
                  The points do not follow a straight line well (R² below 0.95), so a
                  pseudo-first-order model may not describe this experiment.
                </p>
              )}
              <div
                class="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Kinetics table, scrolls sideways"
              >
                <table class="peak-table">
                  <thead>
                    <tr>
                      <th scope="col">Time (min)</th>
                      <th scope="col">Absorbance</th>
                      <th scope="col">C/C₀</th>
                      <th scope="col">Removal (%)</th>
                      <th scope="col">ln(C₀/C)</th>
                      {cal && <th scope="col">C ({unit})</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {kin.points.map((p) => (
                      <tr key={p.timeMin}>
                        <th scope="row">{num(p.timeMin, 1)}</th>
                        <td>{num(p.absorbance, 4)}</td>
                        <td>{num(p.ratio, 3)}</td>
                        <td>{num(p.removalPct, 1)}</td>
                        <td>{num(p.lnRatio, 3)}</td>
                        {cal && <td>{num(concentrationFrom(p.absorbance, cal), 3)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div class="export-actions">
                <button
                  type="button"
                  class="btn"
                  onClick={() =>
                    downloadCsv(
                      'kinetics',
                      `Pseudo-first-order kinetics at ${num(outcome.wavelengthNm, 1)} nm; C/C0 = A/A0; k = ${kin.kPerMin} +- ${kin.kSigma} 1/min; R2 ${kin.fit.rSquared}`,
                      kin.points,
                      [
                        { header: 'Time (min)', value: (p) => p.timeMin },
                        { header: 'Absorbance', value: (p) => p.absorbance },
                        { header: 'C/C0', value: (p) => p.ratio },
                        { header: 'Removal (%)', value: (p) => p.removalPct },
                        { header: 'ln(C0/C)', value: (p) => p.lnRatio ?? '' },
                        {
                          header: `C (${unit})`,
                          value: (p) => (cal ? concentrationFrom(p.absorbance, cal) : ''),
                        },
                      ],
                    )
                  }
                >
                  Download kinetics (CSV)
                </button>
              </div>
              {kineticPlots && (
                <>
                  <PlotPanel
                    {...plotProps}
                    sources={kineticPlots.ratioLine}
                    points={kineticPlots.ratioPoints}
                    labels={() => ({ x: 'Time (min)', y: 'C / C₀', yValues: true })}
                    xName="t"
                    xUnit=" min"
                    exportName="kinetics-ratio"
                  />
                  <PlotPanel
                    {...plotProps}
                    sources={kineticPlots.lnLine}
                    points={kineticPlots.lnPoints}
                    labels={() => ({ x: 'Time (min)', y: 'ln(C₀ / C)', yValues: true })}
                    xName="t"
                    xUnit=" min"
                    exportName="kinetics-ln"
                  />
                </>
              )}
            </>
          ) : (
            <p class="message is-error">
              No rate constant could be found. The first sample needs an absorbance above zero and
              at least two time points from t = 0 on.
            </p>
          )}
        </section>
      )}

      <section aria-labelledby="conc-methods-title">
        <h3 id="conc-methods-title" class="export-title">
          Methods text
        </h3>
        <p class="field-hint">Written only from the settings you used and the numbers above.</p>
        <textarea
          class="methods-text"
          readOnly
          rows={8}
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
        codec={concentrationSession}
        data={data}
        update={update}
        step={RESULTS_STEP}
        stem="uvvis-concentration"
      />
    </div>
  );
}
