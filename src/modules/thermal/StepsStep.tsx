import { useMemo, useState } from 'preact/hooks';
import { deconvolveSteps, type DtgDeconvolution } from '../../core/thermal/deconvolve';
import type { StepLimit, StepResult } from '../../core/thermal/steps';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { PlotMarker } from '../../ui/plot/types';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { NumberInput } from '../xrd/NumberInput';
import { useCleaned, useStepsView } from './analysis';
import { DEFAULT_STEP_SETTINGS, type StepSettings, type ThermalData } from './data';
import { ThermalPlot } from './ThermalPlot';

/** Closest allowed distance between the two limits of one step, °C. */
const MIN_STEP_WIDTH = 1;

const num = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value) ? '–' : formatNumber(value, digits);

/** Wizard step 3: DTG, mass loss steps with draggable limits, T5/T10/T50 and the residue. */
export function StepsStep({ data, update }: StepContext<ThermalData>) {
  const { cleaned } = useCleaned(data);
  const view = useStepsView(data, cleaned);
  const settings = data.steps;
  const curve = cleaned?.ok ? cleaned.curve : null;
  const [fits, setFits] = useState<Record<string, DtgDeconvolution | null>>({});

  const rate = data.info.heatingRate;
  const perMinute = settings.dtgUnit === 'per-minute' && rate !== null && rate > 0;
  const dtgScaled = useMemo(
    () => (view ? (perMinute ? view.dtg.map((v) => v * (rate as number)) : view.dtg) : null),
    [view, perMinute, rate],
  );

  const markers = useMemo<PlotMarker[]>(() => {
    if (!view || !curve) return [];
    return view.analysis.steps.flatMap((s) => [
      { x: s.fromC, y: s.massBeforePct },
      { x: s.toC, y: s.massAfterPct },
    ]);
  }, [view, curve]);

  if (!curve || !view || !dtgScaled) {
    return (
      <p class="message is-error" role="alert">
        There is no cleaned TGA curve yet.{' '}
        {cleaned && !cleaned.ok
          ? cleaned.error
          : 'Go back to Upload and load a run with a mass column.'}
      </p>
    );
  }

  const setSteps = (patch: Partial<StepSettings>) => update({ steps: { ...settings, ...patch } });
  const T = curve.temperatureC;
  const lo = T[0] as number;
  const hi = T[T.length - 1] as number;
  const sorted = view.analysis.steps;

  const writeLimits = (next: StepLimit[]) => {
    setFits({});
    setSteps({ limits: next });
  };
  const currentLimits = (): StepLimit[] =>
    sorted.map((s) => ({ id: s.id, fromC: s.fromC, toC: s.toC }));
  const moveLimit = (id: number, which: 'fromC' | 'toC', value: number) => {
    const limits = currentLimits().map((l) => {
      if (l.id !== id) return l;
      const clamped = Math.min(hi, Math.max(lo, value));
      return which === 'fromC'
        ? { ...l, fromC: Math.min(clamped, l.toC - MIN_STEP_WIDTH) }
        : { ...l, toC: Math.max(clamped, l.fromC + MIN_STEP_WIDTH) };
    });
    writeLimits(limits);
  };
  const drag = (index: number, x: number) => {
    const step = sorted[Math.floor(index / 2)];
    if (step) moveLimit(step.id, index % 2 === 0 ? 'fromC' : 'toC', Number(x.toFixed(2)));
  };
  const remove = (id: number) => writeLimits(currentLimits().filter((l) => l.id !== id));
  const add = () => {
    const limits = currentLimits();
    let best = -1;
    for (let i = 0; i < T.length; i++) {
      const t = T[i] as number;
      if (limits.some((l) => t >= l.fromC && t <= l.toC)) continue;
      if (best === -1 || (view.dtg[i] as number) > (view.dtg[best] as number)) best = i;
    }
    const centre = best === -1 ? (lo + hi) / 2 : (T[best] as number);
    const id = limits.reduce((m, l) => Math.max(m, l.id), 0) + 1;
    writeLimits([
      ...limits,
      { id, fromC: Math.max(lo, centre - 25), toC: Math.min(hi, centre + 25) },
    ]);
  };

  const dtgUnit = perMinute ? '%/min' : '%/°C';
  const hasMg = curve.referenceMg !== null;
  const baseNote = `Temperatures in °C; mass in % of the reference mass${hasMg ? ` (${formatNumber(curve.referenceMg as number, 3)} mg = 100 %)` : ''}. Onset and endset are extrapolated tangent intersections.`;

  const deconvolve = (regionKey: string, ids: number[], from: number, to: number) => {
    const inRegion = sorted.filter((s) => ids.includes(s.id));
    setFits({ ...fits, [regionKey]: deconvolveSteps(T, view.dtg, inRegion, from, to) });
  };

  return (
    <div class="steps-step">
      <p>
        The DTG curve is the rate of mass loss against temperature; each peak is one mass loss step.
        Adjust the detection until the steps match what you see, then drag the round markers (or
        type the limits in the table) to set where each step starts and ends.{' '}
        <HelpTip term="DTG">
          <p>
            DTG is the derivative of the mass curve, −dm/dT, in % per °C (or % per minute at the
            heating rate you entered). A step is a peak of DTG. The derivative is computed with a
            local quadratic fit over the window below, because differentiating noisy data directly
            amplifies the noise. A wider window is smoother but also broadens peaks.
          </p>
        </HelpTip>
      </p>

      <section class="process-step is-on" aria-labelledby="detect-title">
        <h3 id="detect-title" class="process-step-title">
          Detection
        </h3>
        <div class="radiation-fields">
          <NumberInput
            label="DTG window (°C)"
            value={settings.dtgWindowC}
            min={0}
            onChange={(v) => setSteps({ dtgWindowC: v ?? DEFAULT_STEP_SETTINGS.dtgWindowC })}
            help={
              <HelpTip term="DTG window">
                <p>
                  Width of the temperature window used to estimate the slope at each point. Use a
                  larger window for noisy data. Too large a window merges neighbouring steps.
                </p>
              </HelpTip>
            }
          />
          <NumberInput
            label="Smallest peak (% of the tallest)"
            value={settings.detect.prominencePercent}
            min={0}
            max={100}
            onChange={(v) =>
              setSteps({
                detect: {
                  ...settings.detect,
                  prominencePercent: v ?? DEFAULT_STEP_SETTINGS.detect.prominencePercent,
                },
              })
            }
            help={
              <HelpTip term="peak prominence">
                <p>
                  A DTG peak counts as a step only if it rises at least this percentage of the
                  tallest peak above the surrounding valleys. Lower it to find small steps; raise it
                  if noise is detected as steps.
                </p>
              </HelpTip>
            }
          />
          <NumberInput
            label="Minimum separation (°C)"
            value={settings.detect.minSeparationC}
            min={0}
            onChange={(v) =>
              setSteps({
                detect: {
                  ...settings.detect,
                  minSeparationC: v ?? DEFAULT_STEP_SETTINGS.detect.minSeparationC,
                },
              })
            }
            help={
              <HelpTip term="minimum separation">
                <p>
                  Two DTG peaks closer than this are treated as one step (the taller peak is kept).
                </p>
              </HelpTip>
            }
          />
          <label class="inline-field">
            DTG unit
            <select
              value={perMinute ? 'per-minute' : 'per-degree'}
              onChange={(e) =>
                setSteps({ dtgUnit: e.currentTarget.value as StepSettings['dtgUnit'] })
              }
            >
              <option value="per-degree">% per °C</option>
              <option value="per-minute" disabled={rate === null || rate <= 0}>
                % per minute{rate === null ? ' (needs the heating rate)' : ''}
              </option>
            </select>
          </label>
        </div>
        {settings.limits && (
          <p class="field-hint">
            You edited the step limits by hand, so they stay as they are when the detection changes.{' '}
            <button
              type="button"
              class="btn btn-quiet"
              onClick={() => {
                setFits({});
                setSteps({ limits: null });
              }}
            >
              Use the automatic limits again
            </button>
          </p>
        )}
      </section>

      <ThermalPlot
        curves={[
          {
            id: 'mass',
            name: 'Mass',
            temperatureC: curve.temperatureC,
            mass: curve.massPct,
          },
        ]}
        massUnit="%"
        steps={sorted}
        dtg={{ temperatureC: curve.temperatureC, values: dtgScaled, unit: dtgUnit }}
        settings={data.plot}
        onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
        exportName="tga-steps"
        interaction={{
          markers,
          onMarkerDrag: drag,
          hint: 'Drag the round markers to move a step limit. Pinch or Ctrl and scroll to zoom.',
        }}
      />

      <section aria-labelledby="steps-title">
        <h3 id="steps-title" class="process-step-title">
          Mass loss steps
        </h3>
        {sorted.length === 0 ? (
          <p class="message is-warning">
            No steps were found. Lower the "smallest peak" value, use a smaller DTG window, or add a
            step by hand.
          </p>
        ) : (
          <StepTable steps={sorted} hasMg={hasMg} onMove={moveLimit} onRemove={remove} />
        )}
        <div class="upload-actions">
          <button type="button" class="btn" onClick={add}>
            Add a step
          </button>
          <button
            type="button"
            class="btn"
            disabled={sorted.length === 0}
            onClick={() =>
              downloadCsv('tga-steps', `TGA mass loss steps. ${baseNote}`, sorted, [
                { header: 'Step', value: (s) => s.id },
                { header: 'From (C)', value: (s) => s.fromC },
                { header: 'To (C)', value: (s) => s.toC },
                { header: 'Onset (C)', value: (s) => s.onsetC },
                { header: 'DTG peak (C)', value: (s) => s.peakC },
                { header: 'Endset (C)', value: (s) => s.endsetC },
                { header: 'Mass loss (%)', value: (s) => s.lossPct },
                { header: 'Mass loss (mg)', value: (s) => s.lossMg ?? '' },
                { header: 'Residual mass (%)', value: (s) => s.residualPct },
                { header: 'Residual mass (mg)', value: (s) => s.residualMg ?? '' },
              ])
            }
          >
            Download steps (CSV)
          </button>
        </div>
        <p class="field-hint">
          {baseNote} TGA alone cannot tell which substance is lost in a step.
        </p>

        {view.analysis.regions.map((region) => {
          const key = region.ids.join('-');
          const fit = fits[key];
          return (
            <div key={key} class="message is-warning overlap-note" role="note">
              <p>
                <strong>Overlap:</strong> {region.note}
              </p>
              <button
                type="button"
                class="btn"
                onClick={() => deconvolve(key, region.ids, region.fromC, region.toC)}
              >
                Split into Gaussian components (approximation)
              </button>
              {fit === null && <p>The split did not work for this region. Try different limits.</p>}
              {fit && (
                <>
                  <p class="field-hint">
                    Approximation: each DTG peak is modelled as a Gaussian. Real steps are rarely
                    Gaussian and other splits can fit almost as well, so treat these values as
                    rough.
                    {fit.converged ? '' : ' The fit did not fully converge.'} R² ={' '}
                    {num(fit.rSquared, 4)}.
                  </p>
                  <div class="table-scroll">
                    <table class="peak-table">
                      <caption class="visually-hidden">Gaussian components</caption>
                      <thead>
                        <tr>
                          <th scope="col">Component of step</th>
                          <th scope="col">Centre (°C)</th>
                          <th scope="col">FWHM (°C)</th>
                          <th scope="col">Mass loss (%)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fit.components.map((c) => (
                          <tr key={c.id}>
                            <th scope="row">{c.id}</th>
                            <td>{num(c.centerC)}</td>
                            <td>{num(c.fwhmC)}</td>
                            <td>{num(c.lossPct, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </section>

      <section aria-labelledby="ref-title">
        <h3 id="ref-title" class="process-step-title">
          Characteristic temperatures{' '}
          <HelpTip term="T5, T10, T50">
            <p>
              T5 %, T10 % and T50 % are the temperatures at which the sample has lost 5, 10 and 50 %
              of its mass (the mass curve first falls to 95, 90 and 50 %). They are a simple way to
              compare thermal stability between samples run at the same heating rate.
            </p>
          </HelpTip>
        </h3>
        <div class="table-scroll">
          <table class="peak-table">
            <caption class="visually-hidden">Characteristic temperatures</caption>
            <thead>
              <tr>
                <th scope="col">Quantity</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">T5 % (°C)</th>
                <td>{view.t5 === null ? 'not reached' : num(view.t5)}</td>
              </tr>
              <tr>
                <th scope="row">T10 % (°C)</th>
                <td>{view.t10 === null ? 'not reached' : num(view.t10)}</td>
              </tr>
              <tr>
                <th scope="row">T50 % (°C)</th>
                <td>{view.t50 === null ? 'not reached' : num(view.t50)}</td>
              </tr>
              <tr>
                <th scope="row">Residue at the end ({num(hi, 0)} °C)</th>
                <td>
                  {num(curve.massPct[curve.massPct.length - 1] ?? null, 2)} %
                  {curve.massMg && ` (${num(curve.massMg[curve.massMg.length - 1] ?? null, 3)} mg)`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="radiation-fields">
          <NumberInput
            label="Residue at temperature (°C)"
            value={settings.residueAtC}
            onChange={(v) => setSteps({ residueAtC: v })}
          />
          <p class="residue-result" role="status">
            {settings.residueAtC === null
              ? 'Enter a temperature.'
              : view.residuePct === null
                ? `${num(settings.residueAtC, 0)} °C is outside the measured range (${num(lo, 0)} to ${num(hi, 0)} °C).`
                : `Mass at ${num(settings.residueAtC, 0)} °C: ${num(view.residuePct, 2)} %${curve.referenceMg !== null ? ` (${num((view.residuePct * curve.referenceMg) / 100, 3)} mg)` : ''}`}
          </p>
        </div>
      </section>
    </div>
  );
}

function StepTable(props: {
  steps: readonly StepResult[];
  hasMg: boolean;
  onMove: (id: number, which: 'fromC' | 'toC', value: number) => void;
  onRemove: (id: number) => void;
}) {
  const { steps, hasMg, onMove, onRemove } = props;
  return (
    <div class="table-scroll">
      <table class="peak-table step-table">
        <caption class="visually-hidden">Mass loss steps</caption>
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">From (°C)</th>
            <th scope="col">To (°C)</th>
            <th scope="col">Onset (°C)</th>
            <th scope="col">DTG peak (°C)</th>
            <th scope="col">Endset (°C)</th>
            <th scope="col">Mass loss (%)</th>
            {hasMg && <th scope="col">Mass loss (mg)</th>}
            <th scope="col">Residual (%)</th>
            {hasMg && <th scope="col">Residual (mg)</th>}
            <th scope="col">
              <span class="visually-hidden">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.id}>
              <th scope="row">{s.id}</th>
              <td>
                <input
                  type="number"
                  class="table-input"
                  inputMode="decimal"
                  aria-label={`Step ${s.id} start (°C)`}
                  step="any"
                  value={Number(s.fromC.toFixed(2))}
                  onChange={(e) => {
                    const v = Number(e.currentTarget.value);
                    if (Number.isFinite(v)) onMove(s.id, 'fromC', v);
                  }}
                />
              </td>
              <td>
                <input
                  type="number"
                  class="table-input"
                  inputMode="decimal"
                  aria-label={`Step ${s.id} end (°C)`}
                  step="any"
                  value={Number(s.toC.toFixed(2))}
                  onChange={(e) => {
                    const v = Number(e.currentTarget.value);
                    if (Number.isFinite(v)) onMove(s.id, 'toC', v);
                  }}
                />
              </td>
              <td>{num(s.onsetC)}</td>
              <td>{num(s.peakC)}</td>
              <td>{num(s.endsetC)}</td>
              <td>{num(s.lossPct, 2)}</td>
              {hasMg && <td>{num(s.lossMg, 3)}</td>}
              <td>{num(s.residualPct, 2)}</td>
              {hasMg && <td>{num(s.residualMg, 3)}</td>}
              <td>
                <button
                  type="button"
                  class="btn btn-quiet"
                  aria-label={`Remove step ${s.id}`}
                  onClick={() => onRemove(s.id)}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
