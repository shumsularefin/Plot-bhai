import { useMemo } from 'preact/hooks';
import weightsFile from '../../../data/thermal/atomic-weights.json';
import { REACTION_EXAMPLES, theoreticalLoss } from '../../core/thermal/formula';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';
import { NumberInput } from '../xrd/NumberInput';
import { stepKey, type ThermalData, type TheorySettings } from './data';
import type { StepResult } from '../../core/thermal/steps';

const weights = weightsFile.elements;

/** The theoretical loss of the reaction typed in, or an error message, and the measured step. */
export function useTheory(theory: TheorySettings, steps: readonly StepResult[]) {
  return useMemo(() => {
    if (theory.precursor.trim() === '' || theory.product.trim() === '') return null;
    const result = theoreticalLoss(
      { precursor: theory.precursor, product: theory.product, coefficient: theory.coefficient },
      weights,
    );
    const step = steps.find((s) => stepKey(s.peakC) === theory.stepKey) ?? null;
    return { result, step };
  }, [theory, steps]);
}

interface TheoryCheckProps {
  data: ThermalData;
  steps: readonly StepResult[];
  update: (patch: Partial<ThermalData>) => void;
}

/** Compares a measured step with the mass loss of a reaction calculated from molar masses. */
export function TheoryCheck({ data, steps, update }: TheoryCheckProps) {
  const theory = data.theory;
  const set = (patch: Partial<TheorySettings>) => update({ theory: { ...theory, ...patch } });
  const checked = useTheory(theory, steps);
  const exampleIndex = REACTION_EXAMPLES.findIndex(
    (e) =>
      e.precursor === theory.precursor &&
      e.product === theory.product &&
      e.coefficient === theory.coefficient,
  );

  return (
    <section class="process-step is-on" aria-labelledby="theory-title">
      <h3 id="theory-title" class="process-step-title">
        Check a step against theory
      </h3>
      <p class="field-hint">
        Type the formula of what you started with and of the solid that should remain, and the site
        calculates the mass loss from molar masses (CIAAW abridged atomic weights). Hydrates are
        written like CaC2O4·H2O.{' '}
        <HelpTip term="Theoretical mass loss">
          <p>
            Theoretical loss (%) = 100 × (M<sub>precursor</sub> − ν × M<sub>product</sub>) / M
            <sub>precursor</sub>, where M is the molar mass in g/mol and ν is the moles of solid
            product per mole of precursor (0.5 for 2 Al(OH)<sub>3</sub> → Al<sub>2</sub>O
            <sub>3</sub>). It assumes the reaction is complete and the sample is pure.
          </p>
        </HelpTip>
      </p>
      <div class="radiation-fields">
        <label class="inline-field">
          Ready example
          <select
            value={exampleIndex >= 0 ? String(exampleIndex) : ''}
            onChange={(e) => {
              const example = REACTION_EXAMPLES[Number(e.currentTarget.value)];
              if (example) {
                set({
                  precursor: example.precursor,
                  product: example.product,
                  coefficient: example.coefficient,
                });
              }
            }}
          >
            <option value="">Choose…</option>
            {REACTION_EXAMPLES.map((e, i) => (
              <option key={e.label} value={String(i)}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label class="inline-field">
          Starting material
          <input
            type="text"
            value={theory.precursor}
            onInput={(e) => set({ precursor: e.currentTarget.value })}
          />
        </label>
        <label class="inline-field">
          Solid product
          <input
            type="text"
            value={theory.product}
            onInput={(e) => set({ product: e.currentTarget.value })}
          />
        </label>
        <NumberInput
          label="Product per precursor (ν)"
          value={theory.coefficient}
          min={0}
          onChange={(v) => set({ coefficient: v ?? 1 })}
        />
        <label class="inline-field">
          Compare with
          <select value={theory.stepKey} onChange={(e) => set({ stepKey: e.currentTarget.value })}>
            <option value="">Choose a step…</option>
            {steps.map((s) => (
              <option key={s.id} value={stepKey(s.peakC)}>
                Step {s.id} ({formatNumber(s.peakC, 0)} °C, {formatNumber(s.lossPct, 1)} %)
              </option>
            ))}
          </select>
        </label>
      </div>
      {checked && !checked.result.ok && (
        <p class="message is-error" role="alert">
          {checked.result.error}
        </p>
      )}
      {checked?.result.ok && (
        <p class="theory-result" role="status">
          Theoretical loss {formatNumber(checked.result.value.lossPct, 2)} % (M ={' '}
          {formatNumber(checked.result.value.precursorMass, 3)} g/mol →{' '}
          {formatNumber(checked.result.value.productMass, 3)} g/mol).
          {checked.step
            ? ` Measured in step ${checked.step.id}: ${formatNumber(checked.step.lossPct, 2)} %; difference ${formatNumber(checked.step.lossPct - checked.result.value.lossPct, 2)} percentage points (measured minus theory).`
            : ' Choose a step to compare with.'}
        </p>
      )}
      {checked?.result.ok && checked.step && (
        <p class="field-hint">
          A difference does not prove the reaction is wrong: adsorbed water, impurities, a partly
          finished reaction, or overlapping steps all change the measured value. A step that matches
          does not prove the reaction either.
        </p>
      )}
    </section>
  );
}
