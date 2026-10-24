import { useMemo } from 'preact/hooks';
import { CALCINATION_WARNING, DEFAULT_CALCINATION } from '../../core/thermal/calcination';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import type { PlotBand } from '../../ui/plot/types';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import { useCalcination, useCleaned, useStepsView } from './analysis';
import type { ThermalData } from './data';
import { ThermalPlot } from './ThermalPlot';

/** Wizard step 5: a minimum calcination temperature and three temperatures to test. */
export function CalcinationStep({ data, update }: StepContext<ThermalData>) {
  const { cleaned } = useCleaned(data);
  const view = useStepsView(data, cleaned);
  const suggestion = useCalcination(data, cleaned, view);
  const curve = cleaned?.ok ? cleaned.curve : null;
  const settings = data.calcination;
  const set = (patch: Partial<typeof settings>) =>
    update({ calcination: { ...settings, ...patch } });

  const shade = useMemo<PlotBand[]>(
    () =>
      suggestion?.plateau ? [{ from: suggestion.plateau.fromC, to: suggestion.plateau.toC }] : [],
    [suggestion],
  );

  if (!curve || !view || !suggestion) {
    return (
      <p class="message is-info">
        There is no TGA curve yet. Go back to the first steps and load a run with a mass column.
      </p>
    );
  }
  const { lastStep, minimumC, candidatesC, plateau, warnings } = suggestion;

  return (
    <div class="calcination-step">
      <p class="message is-warning" role="note">
        {CALCINATION_WARNING}
      </p>

      <section class="process-step is-on" aria-labelledby="calc-title">
        <h3 id="calc-title" class="process-step-title">
          Settings
        </h3>
        <div class="radiation-fields">
          <NumberInput
            label="Smallest significant step (% of mass)"
            value={settings.thresholdPct}
            min={0}
            onChange={(v) => set({ thresholdPct: v ?? DEFAULT_CALCINATION.thresholdPct })}
            help={
              <HelpTip term="Significant step">
                <p>
                  Steps that lose less than this are ignored when looking for the last step. Lower
                  it to include small late steps, raise it to ignore small drifts.
                </p>
              </HelpTip>
            }
          />
          <NumberInput
            label="Safety margin (°C)"
            value={settings.marginC}
            min={-1}
            onChange={(v) => set({ marginC: v ?? DEFAULT_CALCINATION.marginC })}
            help={
              <HelpTip term="Safety margin">
                <p>
                  Added to the endset of the last step, because the endset in a ramp is where the
                  loss looks finished, and a little more heat makes sure it is. The default is 50
                  °C, a convention of this site, not a published value.
                </p>
              </HelpTip>
            }
          />
          <button
            type="button"
            class="btn btn-quiet"
            onClick={() => update({ calcination: DEFAULT_CALCINATION })}
          >
            Reset to defaults
          </button>
        </div>
      </section>

      <section aria-labelledby="calc-result">
        <h3 id="calc-result" class="export-title">
          Suggestion (an estimate)
        </h3>
        {minimumC === null || lastStep === null ? (
          <p class="message is-info" role="status">
            {warnings[0]}
          </p>
        ) : (
          <>
            <p role="status">
              The last significant step (step {lastStep.id}, {formatNumber(lastStep.lossPct, 1)} %
              lost) ends at {formatNumber(lastStep.endsetC, 0)} °C. Adding the margin of{' '}
              {formatNumber(settings.marginC, 0)} °C gives a minimum of{' '}
              <strong>{formatNumber(minimumC, 0)} °C</strong>. Suggested range to explore:{' '}
              {formatNumber(candidatesC[0] as number, 0)} to{' '}
              {formatNumber(candidatesC[2] as number, 0)} °C.
            </p>
            <p>Three temperatures to calcine at and check by XRD:</p>
            <ol class="candidate-temperatures">
              {candidatesC.map((t, i) => (
                <li key={t}>
                  {t} °C {i === 0 ? '(the minimum)' : `(minimum + ${i * 50} °C)`}
                </li>
              ))}
            </ol>
            {plateau && (
              <p>
                Above the minimum the mass stays between {formatNumber(plateau.minPct, 2)} and{' '}
                {formatNumber(plateau.maxPct, 2)} % up to {formatNumber(plateau.toC, 0)} °C{' '}
                {plateau.flat ? '(a flat plateau, shaded in the plot).' : '(not flat).'}
              </p>
            )}
          </>
        )}
        {minimumC !== null &&
          warnings.map((w) => (
            <p key={w} class="message is-warning" role="note">
              {w}
            </p>
          ))}
        <p class="field-hint">
          Confirm it with XRD of samples calcined at the three temperatures above: look for the
          phase you want and for leftovers of the precursor. If you also have DSC data, a
          crystallisation or phase-change exotherm above the last mass loss may call for a higher
          temperature; that check comes with the DSC tool and is not part of this suggestion yet.
        </p>
      </section>

      <ThermalPlot
        curves={[
          { id: 'mass', name: 'Mass', temperatureC: curve.temperatureC, mass: curve.massPct },
        ]}
        massUnit="%"
        steps={view.analysis.steps}
        shade={shade}
        settings={data.plot}
        onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
        exportName="tga-calcination"
      />
    </div>
  );
}
