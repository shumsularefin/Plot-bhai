import { useMemo, useRef, useState } from 'preact/hooks';
import {
  cleanDsc,
  DEFAULT_DSC_CLEAN,
  displayExoUp,
  type DscCleanSettings,
} from '../../../core/thermal/dscClean';
import { formatNumber } from '../../../core/xrd/parsers/numbers';
import { HelpTip } from '../../../ui/HelpTip';
import type { StepContext } from '../../../ui/wizard/types';
import { NumberInput } from '../../xrd/NumberInput';
import { useDscCurve } from './analysis';
import type { DscData } from './data';
import { DscPlot, type DscLine } from './DscPlot';

const UNDO_LIMIT = 50;

/** DSC wizard step 2: choose the ramp, crop, smooth, and the direction exothermic peaks are drawn. */
export function DscCleanStep({ data, update }: StepContext<DscData>) {
  const { run, cleaned } = useDscCurve(data);
  const settings = data.clean;
  const history = useRef<DscCleanSettings[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [overlay, setOverlay] = useState(false);

  const others = useMemo(() => {
    if (!run || !cleaned?.ok || !overlay) return [];
    return cleaned.segments
      .map((s) => ({
        s,
        r: cleanDsc(run, data.setup, data.info, { ...settings, segmentId: s.id }),
      }))
      .filter((x) => x.r.ok);
  }, [run, cleaned, overlay, data.setup, data.info, settings]);

  if (!run) return <p>No run is loaded. Go back to Upload to add one.</p>;
  if (!cleaned?.ok) {
    return (
      <p class="message is-error" role="alert">
        {cleaned?.error ?? 'There is no DSC curve yet.'}
      </p>
    );
  }
  const { curve, segments } = cleaned;

  // Any change to the curve makes edited limits and windows meaningless, so they go back to automatic.
  const setSettings = (next: DscCleanSettings) => {
    history.current = [...history.current, settings].slice(-UNDO_LIMIT);
    setCanUndo(true);
    update({ clean: next, limits: null, glassWindows: null, assignments: {} });
  };
  const patch = (value: Partial<DscCleanSettings>) => setSettings({ ...settings, ...value });
  const undo = () => {
    const last = history.current[history.current.length - 1];
    if (!last) return;
    history.current = history.current.slice(0, -1);
    setCanUndo(history.current.length > 0);
    update({ clean: last, limits: null, glassWindows: null, assignments: {} });
  };

  const lines: DscLine[] = overlay
    ? others.map((x, i) => {
        const c = x.r.ok ? x.r.curve : curve;
        return {
          id: `seg-${x.s.id}`,
          name: x.s.label,
          temperatureC: c.temperatureC,
          exo: c.exo,
          colorIndex: i,
        };
      })
    : [
        {
          id: 'curve',
          name: curve.segment.label,
          temperatureC: curve.temperatureC,
          exo: curve.exo,
        },
      ];
  const exoUp = displayExoUp(data.setup);

  return (
    <div class="clean-step">
      <p>
        A DSC file often holds a heat, cool, heat program. Pick the ramp to analyse. The heat flow
        is converted to W/g when a mass is known, and exothermic peaks are drawn the way you choose
        below.
      </p>
      <DscPlot
        lines={lines}
        unit={curve.unit}
        setup={data.setup}
        settings={data.plot}
        onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
        exportName="dsc-curve"
      />
      {curve.notes.length > 0 && (
        <ul class="pattern-messages">
          {curve.notes.map((n, i) => (
            <li key={i} class={`message is-${n.level}`}>
              {n.text}
            </li>
          ))}
        </ul>
      )}

      <section class="process-step is-on" aria-labelledby="ramp-title">
        <h3 id="ramp-title" class="process-step-title">
          Ramp to analyse{' '}
          <HelpTip term="heating and cooling ramps">
            <p>
              The ramps are found from the direction of the temperature. Heating 1 shows the sample
              as received, including its thermal history; cooling and heating 2 show what happens
              after the history is erased. Cooling is analysed with the temperature reversed, and
              the onset is then on the high-temperature side.
            </p>
          </HelpTip>
        </h3>
        <div class="radiation-fields">
          <label class="inline-field">
            Ramp
            <select
              value={String(curve.segment.id)}
              onChange={(e) => patch({ segmentId: Number(e.currentTarget.value) })}
            >
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({formatNumber(s.startC, 0)} to {formatNumber(s.endC, 0)} °C)
                </option>
              ))}
            </select>
          </label>
          <label class="switch">
            <input
              type="checkbox"
              checked={overlay}
              onChange={(e) => setOverlay(e.currentTarget.checked)}
            />
            <span>Overlay all ramps</span>
          </label>
        </div>
        <p class="field-hint">
          Scan rate used:{' '}
          {curve.rateKPerMin === null
            ? 'unknown'
            : `${formatNumber(curve.rateKPerMin, 2)} K/min (${curve.rateSource === 'entered' ? 'entered in step 1' : 'from the time column'})`}
          .
        </p>
      </section>

      <section class="process-step is-on" aria-labelledby="dsc-range-title">
        <h3 id="dsc-range-title" class="process-step-title">
          Temperature range and smoothing
        </h3>
        <div class="radiation-fields">
          <NumberInput
            label="From (°C)"
            value={settings.fromC}
            onChange={(v) => patch({ fromC: v })}
          />
          <NumberInput label="To (°C)" value={settings.toC} onChange={(v) => patch({ toC: v })} />
          <NumberInput
            label="Smoothing window (°C, 0 = none)"
            value={settings.smoothWindowC}
            min={-1}
            onChange={(v) => patch({ smoothWindowC: Math.max(0, v ?? 0) })}
            help={
              <HelpTip term="smoothing">
                <p>
                  Averages nearby points to reduce noise. Too much rounds peaks and lowers their
                  height, so keep the window much narrower than the peaks. Enthalpies change very
                  little; onset temperatures can shift.
                </p>
              </HelpTip>
            }
          />
        </div>
        <div class="export-actions">
          <button type="button" class="btn btn-quiet" disabled={!canUndo} onClick={undo}>
            Undo
          </button>
          <button
            type="button"
            class="btn btn-quiet"
            onClick={() => setSettings({ ...DEFAULT_DSC_CLEAN })}
          >
            Reset
          </button>
        </div>
      </section>

      <fieldset class="exo-choice">
        <legend>
          How should exothermic peaks be drawn?{' '}
          <HelpTip term="exo convention">
            <p>
              This only changes how plots and tables are shown; the numbers are the same. The choice
              is written on every plot axis and in every table so a reader is never left guessing.
            </p>
          </HelpTip>
        </legend>
        <label class="radio-field">
          <input
            type="radio"
            name="display-exo"
            checked={exoUp}
            onChange={() => update({ setup: { ...data.setup, displayExoUp: true } })}
          />
          Exo up
        </label>
        <label class="radio-field">
          <input
            type="radio"
            name="display-exo"
            checked={!exoUp}
            onChange={() => update({ setup: { ...data.setup, displayExoUp: false } })}
          />
          Exo down
        </label>
      </fieldset>
    </div>
  );
}
