import type { SpectrumKind, ValueScale } from '../../core/uvvis/types';

export interface KindOption {
  kind: SpectrumKind;
  scale: ValueScale;
  label: string;
}

export const sameKind = (a: Omit<KindOption, 'label'>, b: Omit<KindOption, 'label'>) =>
  a.kind === b.kind && (a.kind === 'absorbance' || a.scale === b.scale);

/** Radio buttons for what the figure's y axis shows. */
export function KindChoice({
  options,
  value,
  onChange,
  reason,
}: {
  options: readonly KindOption[];
  value: Omit<KindOption, 'label'>;
  onChange: (option: KindOption) => void;
  /** Why the preselected option was suggested. */
  reason: string;
}) {
  return (
    <fieldset class="method-choice">
      <legend>The y axis of the figure shows</legend>
      {options.map((o) => (
        <label key={o.label} class="check">
          <input
            type="radio"
            name="digitized-kind"
            checked={sameKind(o, value)}
            onChange={() => onChange(o)}
          />
          {o.label}
        </label>
      ))}
      <p class="field-hint">{reason}</p>
    </fieldset>
  );
}
