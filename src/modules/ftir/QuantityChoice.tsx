import { useId } from 'preact/hooks';
import { HelpTip } from '../../ui/HelpTip';
import type { FtirData } from './data';
import type { FtirQuantity, ShownQuantity } from './quantity';

interface QuantityChoiceProps {
  data: FtirData;
  update: (patch: Partial<FtirData>) => void;
  shown: ShownQuantity;
}

/**
 * The vertical axis choice, shared by every FTIR step so the plots, peak tables and exports all
 * use the same quantity. It changes the display only: the stored data are never converted.
 */
export function QuantityChoice({ data, update, shown }: QuantityChoiceProps) {
  const name = useId();
  const choose = (quantity: FtirQuantity) => update({ view: { ...data.view, quantity } });
  return (
    <div class="quantity-choice">
      <fieldset class="segmented">
        <legend>
          Show as{' '}
          <HelpTip term="absorbance and transmittance">
            <p>
              Transmittance T is the fraction of light that passes through the sample; absorbance is
              A = −log₁₀ T = 2 − log₁₀(%T). The two views show the same measurement. Your data are
              stored exactly as loaded; processing and peak picking always work on absorbance (bands
              point up), and the result is drawn, tabulated and exported in the quantity chosen
              here. Bands are minima in transmittance and maxima in absorbance.
            </p>
          </HelpTip>
        </legend>
        {(['absorbance', 'transmittance'] as const).map((q) => (
          <label key={q} class={data.view.quantity === q ? 'is-selected' : undefined}>
            <input
              type="radio"
              name={name}
              checked={data.view.quantity === q}
              onChange={() => choose(q)}
            />
            {q === 'absorbance' ? 'Absorbance' : 'Transmittance (%)'}
          </label>
        ))}
      </fieldset>
      {shown.reason && (
        <p class="message is-warning" role="status">
          <strong>Note:</strong> {shown.reason}
        </p>
      )}
    </div>
  );
}
