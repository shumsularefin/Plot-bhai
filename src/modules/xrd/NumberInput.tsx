import type { ComponentChildren } from 'preact';

export interface NumberInputProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  help?: ComponentChildren;
}

export function NumberInput({ label, value, onChange, min, max, step, help }: NumberInputProps) {
  return (
    <label class="inline-field">
      <span>
        {label} {help}
      </span>
      <input
        type="number"
        aria-label={label}
        inputMode="decimal"
        step={step ?? 'any'}
        {...(min !== undefined && { min })}
        {...(max !== undefined && { max })}
        value={value ?? ''}
        onInput={(e) => {
          const text = e.currentTarget.value.trim();
          const v = Number(text);
          if (text === '') onChange(null);
          else if (
            Number.isFinite(v) &&
            (min === undefined || v > min) &&
            (max === undefined || v <= max)
          )
            onChange(v);
        }}
      />
    </label>
  );
}
