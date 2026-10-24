import { useMemo } from 'preact/hooks';
import {
  CALCINATION_WARNING,
  DEFAULT_CALCINATION,
  type CalcinationOptions,
} from '../../core/thermal/calcination';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { PlotBand } from '../../ui/plot/types';
import type { StepContext } from '../../ui/wizard/types';
import { downloadCsv } from '../xrd/csv';
import { NumberInput } from '../xrd/NumberInput';
import { calcinationOf, stepBands, stepNumberLabels, useThermalView } from './analysis';
import type { ThermalData } from './data';
import { ThermalPlot } from './ThermalPlot';

const num = (value: number | null, digits = 0) =>
  value === null || !Number.isFinite(value) ? '–' : formatNumber(value, digits);

/** Wizard step 5: a calcination starting point from the last significant mass loss. */
export function CalcinationStep({ data, update }: StepContext<ThermalData>) {
  const { curve, view } = useThermalView(data);
  const steps = useMemo(() => view?.analysis.steps ?? [], [view]);
  const suggestion = useMemo(() => calcinationOf(data, curve, steps), [data, curve, steps]);
  const bands = useMemo<PlotBand[]>(() => {
    const out = stepBands(steps);
    if (suggestion?.ok && curve && suggestion.minimumC <= suggestion.dataEndC) {
      out.push({ fromX: suggestion.minimumC, toX: suggestion.dataEndC, label: 'plateau' });
    }
    return out;
  }, [steps, suggestion, curve]);
  const numbers = useMemo(
    () => (curve ? stepNumberLabels(steps, curve.temperatureC, curve.massPct) : undefined),
    [curve, steps],
  );

  if (!curve || !view) {
    return (
      <p class="message is-error" role="alert">
        There is no cleaned TGA curve yet. Go back to Upload and load a run with a mass column.
      </p>
    );
  }
  const set = (patch: Partial<CalcinationOptions>) =>
    update({ calcination: { ...data.calcination, ...patch } });

  return (
    <div class="calcination-step">
      <p class="message is-warning" role="note">
        <strong>Read this first:</strong> {CALCINATION_WARNING}
      </p>

      <section class="process-step is-on" aria-labelledby="calc-settings-title">
        <h3 id="calc-settings-title" class="process-step-title">
          Settings{' '}
          <HelpTip term="calcination suggestion">
            <p>
              The suggested lowest temperature is the extrapolated endset of the last mass loss step
              that is big enough to matter, plus a safety margin. Above it the curve should be flat
              (the plateau). The three candidates are spaced evenly from there, so you can calcine
              samples at each and compare them by XRD.
            </p>
          </HelpTip>
        </h3>
        <div class="radiation-fields">
          <NumberInput
            label="Smallest step that counts (% of mass)"
            value={data.calcination.minLossPct}
            onChange={(v) => set({ minLossPct: Math.max(0, v ?? DEFAULT_CALCINATION.minLossPct) })}
          />
          <NumberInput
            label="Safety margin (°C)"
            value={data.calcination.marginC}
            onChange={(v) => set({ marginC: Math.max(0, v ?? DEFAULT_CALCINATION.marginC) })}
          />
          <NumberInput
            label="Spacing of candidates (°C)"
            value={data.calcination.spacingC}
            min={1}
            onChange={(v) => set({ spacingC: v ?? DEFAULT_CALCINATION.spacingC })}
          />
        </div>
      </section>

      <ThermalPlot
        curves={[
          { id: 'mass', name: 'Mass', temperatureC: curve.temperatureC, mass: curve.massPct },
        ]}
        massUnit="%"
        settings={data.plot}
        onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
        exportName="tga-calcination"
        bands={bands}
        {...(numbers && { peakLabels: numbers })}
      />

      <section aria-labelledby="calc-result-title">
        <h3 id="calc-result-title" class="process-step-title">
          Suggestion (an estimate)
        </h3>
        {!suggestion || !suggestion.ok ? (
          <p class="message is-warning" role="status">
            {suggestion?.ok === false ? suggestion.error : 'No suggestion is possible yet.'}
          </p>
        ) : (
          <>
            <p role="status">
              <strong>Lowest temperature worth trying: {num(suggestion.minimumC)} °C.</strong>{' '}
              {suggestion.candidatesC.length > 0 &&
                `Range to explore: ${num(suggestion.candidatesC[0] as number)} to ${num(suggestion.candidatesC[suggestion.candidatesC.length - 1] as number)} °C.`}
            </p>
            <ul>
              {suggestion.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            {suggestion.candidatesC.length > 0 ? (
              <>
                <h4>Candidate temperatures to test</h4>
                <ol>
                  {suggestion.candidatesC.map((t) => (
                    <li key={t}>{num(t)} °C</li>
                  ))}
                </ol>
                <p class="field-hint">
                  Calcine one sample at each (with the hold time you plan to use) and compare them,
                  for example by XRD. Only the experiment can tell which is suitable.
                </p>
                <button
                  type="button"
                  class="btn"
                  onClick={() =>
                    downloadCsv(
                      'tga-calcination',
                      `Calcination suggestion (an estimate, to be confirmed by experiment). Last significant step ${suggestion.step.id}, endset ${formatNumber(suggestion.step.endsetC, 1)} C, margin ${formatNumber(data.calcination.marginC, 0)} C.`,
                      suggestion.candidatesC,
                      [
                        { header: 'Candidate (C)', value: (t) => t },
                        {
                          header: 'Role',
                          value: (t) => (t === suggestion.minimumC ? 'lowest worth trying' : ''),
                        },
                      ],
                    )
                  }
                >
                  Download candidates (CSV)
                </button>
              </>
            ) : (
              <p class="message is-warning">
                No candidate fits inside the measured range. Run the TGA to a higher temperature or
                lower the margin.
              </p>
            )}
          </>
        )}
        <p class="field-hint">
          DSC data (next sub-stage) will be used to mark exothermic events with no mass change above
          this temperature, as possible crystallisation or phase transitions.
        </p>
      </section>
    </div>
  );
}
