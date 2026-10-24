import { displayExoUp } from '../../../core/thermal/dscClean';
import { HelpTip } from '../../../ui/HelpTip';
import type { StepContext } from '../../../ui/wizard/types';
import { NumberInput } from '../../xrd/NumberInput';
import { eventBands, useDscCurve, useDscView } from './analysis';
import { DEFAULT_CRYSTALLINITY, type DscData } from './data';
import { DscPlot } from './DscPlot';
import { num } from './EventsStep';

/** DSC wizard step 4: glass transition (half-height) and polymer crystallinity. */
export function DscGlassStep({ data, update }: StepContext<DscData>) {
  const { cleaned } = useDscCurve(data);
  const view = useDscView(data, cleaned);
  const curve = cleaned?.ok ? cleaned.curve : null;
  if (!curve || !view) {
    return (
      <p class="message is-error" role="alert">
        There is no DSC curve yet. Go back to the earlier steps.
      </p>
    );
  }
  const { glass, windows, events, crystallinity: cryst } = view;
  const settings = data.crystallinity;
  const exoUp = displayExoUp(data.setup);
  const setWindow = (key: keyof NonNullable<typeof windows>, v: number | null) => {
    if (!windows || v === null) return;
    update({ glassWindows: { ...windows, [key]: v } });
  };
  const setCryst = (patch: Partial<typeof settings>) =>
    update({ crystallinity: { ...settings, ...patch } });
  const g = glass?.ok ? glass.glass : null;
  const endo = events.filter((e) => e.direction === 'endo');
  const exo = events.filter((e) => e.direction === 'exo');

  return (
    <div class="glass-step">
      <DscPlot
        lines={[
          {
            id: 'curve',
            name: curve.segment.label,
            temperatureC: curve.temperatureC,
            exo: curve.exo,
          },
          ...(g && windows
            ? [
                {
                  id: 'lines',
                  name: 'Pre and post lines',
                  dashed: true,
                  colorIndex: 2,
                  temperatureC: Float64Array.from(
                    [windows.preFromC, windows.postToC].filter(Number.isFinite),
                  ),
                  exo: Float64Array.from(
                    [windows.preFromC, windows.postToC].map(
                      (t, i) =>
                        -(i === 0
                          ? g.pre.intercept + g.pre.slope * t
                          : g.post.intercept + g.post.slope * t),
                    ),
                  ),
                },
              ]
            : []),
        ]}
        unit={curve.unit}
        setup={data.setup}
        bands={eventBands(events)}
        settings={data.plot}
        onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
        exportName="dsc-glass"
      />
      <p class="field-hint">Exothermic peaks point {exoUp ? 'up' : 'down'} on this plot.</p>

      <section class="process-step is-on" aria-labelledby="glass-title">
        <h3 id="glass-title" class="process-step-title">
          Glass transition (half-height method){' '}
          <HelpTip term="glass transition">
            <p>
              A glass transition shows as a step in the baseline, not a peak: the heat capacity of
              the sample changes. Straight lines are fitted before and after the step and extended.
              Tg (midpoint) is where the curve is halfway between the two lines; onset and endset
              are where the tangent at the steepest point meets them. The height of the step gives
              the heat capacity change ΔCp = step ÷ scan rate. Tg depends on the scan rate, so
              report it.
            </p>
          </HelpTip>
        </h3>
        {glass === null && (
          <p class="message is-warning" role="status">
            No step-like region was found outside the events. If the sample has a glass transition,
            enter the windows by hand once a first guess exists, or choose another ramp.
          </p>
        )}
        {glass && !glass.ok && (
          <p class="message is-warning" role="status">
            {glass.error}
          </p>
        )}
        {windows && (
          <div class="radiation-fields">
            <NumberInput
              label="Line before the step, from (°C)"
              value={Number(windows.preFromC.toFixed(1))}
              onChange={(v) => setWindow('preFromC', v)}
            />
            <NumberInput
              label="to (°C)"
              value={Number(windows.preToC.toFixed(1))}
              onChange={(v) => setWindow('preToC', v)}
            />
            <NumberInput
              label="Line after the step, from (°C)"
              value={Number(windows.postFromC.toFixed(1))}
              onChange={(v) => setWindow('postFromC', v)}
            />
            <NumberInput
              label="to (°C)"
              value={Number(windows.postToC.toFixed(1))}
              onChange={(v) => setWindow('postToC', v)}
            />
            <button
              type="button"
              class="btn btn-quiet"
              disabled={data.glassWindows === null}
              onClick={() => update({ glassWindows: null })}
            >
              Back to automatic windows
            </button>
          </div>
        )}
        {g && (
          <div class="table-scroll">
            <table class="peak-table">
              <caption>
                Glass transition of {curve.segment.label.toLowerCase()}; exo {exoUp ? 'up' : 'down'}{' '}
                on the plot
              </caption>
              <tbody>
                <tr>
                  <th scope="row">Tg, midpoint (°C)</th>
                  <td>{num(g.midpointC)}</td>
                </tr>
                <tr>
                  <th scope="row">Onset (°C)</th>
                  <td>{num(g.onsetC)}</td>
                </tr>
                <tr>
                  <th scope="row">Endset (°C)</th>
                  <td>{num(g.endsetC)}</td>
                </tr>
                <tr>
                  <th scope="row">Inflection (°C)</th>
                  <td>{num(g.inflectionC)}</td>
                </tr>
                <tr>
                  <th scope="row">ΔCp (J/(g·K))</th>
                  <td>{num(g.deltaCp, 3)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {g && g.notes.length > 0 && (
          <ul class="pattern-messages">
            {g.notes.map((n, i) => (
              <li key={i} class="message is-warning">
                {n}
              </li>
            ))}
          </ul>
        )}
        {g && g.deltaCp === null && (
          <p class="message is-warning" role="status">
            ΔCp needs heat flow per gram and a scan rate. Enter the sample mass and the rate in step
            1.
          </p>
        )}
      </section>

      <section class="process-step is-on" aria-labelledby="cryst-title">
        <h3 id="cryst-title" class="process-step-title">
          Polymer crystallinity{' '}
          <HelpTip term="crystallinity">
            <p>
              Xc = (ΔHm − ΔHcc) ÷ (w · ΔH0) × 100. ΔHm is the melting enthalpy, ΔHcc the enthalpy of
              cold crystallisation (crystallisation during heating, subtracted because those
              crystals were not there before the scan), w the polymer's mass fraction in the sample
              and ΔH0 the melting enthalpy of the 100 % crystalline polymer. ΔH0 depends on the
              polymer and on the source, so the site ships no values: enter one you can cite.
            </p>
          </HelpTip>
        </h3>
        {curve.cooling ? (
          <p class="field-hint">
            Crystallinity is calculated from a heating ramp. Choose one in step 2.
          </p>
        ) : !curve.specific ? (
          <p class="message is-warning" role="status">
            Crystallinity needs enthalpies in J/g. Enter the sample mass in step 1.
          </p>
        ) : endo.length === 0 ? (
          <p class="field-hint">No melting event was found on this ramp.</p>
        ) : (
          <>
            <div class="radiation-fields">
              <label class="inline-field">
                Melting event
                <select
                  value={cryst.melting ? String(cryst.melting.id) : ''}
                  onChange={(e) => setCryst({ meltingId: Number(e.currentTarget.value) })}
                >
                  {endo.map((e) => (
                    <option key={e.id} value={e.id}>
                      Event {e.id} ({num(e.peakC, 0)} °C, {num(e.enthalpy, 1)} J/g)
                    </option>
                  ))}
                </select>
              </label>
              <label class="inline-field">
                Cold crystallisation event
                <select
                  value={cryst.cold ? String(cryst.cold.id) : 'none'}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setCryst({ coldId: v === 'none' ? 'none' : Number(v) });
                  }}
                >
                  <option value="none">None</option>
                  {exo.map((e) => (
                    <option key={e.id} value={e.id}>
                      Event {e.id} ({num(e.peakC, 0)} °C, {num(e.enthalpy, 1)} J/g)
                    </option>
                  ))}
                </select>
              </label>
              <NumberInput
                label="Polymer mass fraction w (0 to 1)"
                value={settings.weightFraction}
                min={0}
                max={1}
                onChange={(v) => setCryst({ weightFraction: v ?? 1 })}
              />
              <NumberInput
                label="ΔH0 of the 100 % crystalline polymer (J/g)"
                value={settings.fullyCrystallineJPerG}
                min={0}
                onChange={(v) => setCryst({ fullyCrystallineJPerG: v })}
                help={
                  <HelpTip term="ΔH0">
                    <p>
                      Take it from a source you can cite for your polymer and state it in the paper.
                      The site does not supply one.
                    </p>
                  </HelpTip>
                }
              />
              <button
                type="button"
                class="btn btn-quiet"
                onClick={() => update({ crystallinity: { ...DEFAULT_CRYSTALLINITY } })}
              >
                Reset
              </button>
            </div>
            {cryst.result?.ok ? (
              <>
                <p role="status">
                  <strong>Xc ≈ {num(cryst.result.percent, 1)} %</strong> (an estimate; it depends on
                  the ΔH0 you entered).
                </p>
                {cryst.result.notes.map((n, i) => (
                  <p key={i} class="message is-warning">
                    {n}
                  </p>
                ))}
              </>
            ) : (
              cryst.result && (
                <p class="message is-warning" role="status">
                  {cryst.result.error}
                </p>
              )
            )}
          </>
        )}
      </section>
    </div>
  );
}
