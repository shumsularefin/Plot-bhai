import { useMemo } from 'preact/hooks';
import { checkKind, suggestKind } from '../../core/uvvis/kind';
import type { Spectrum, SpectrumKind, SpectrumSource, ValueScale } from '../../core/uvvis/types';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';

const SOURCE_LABELS: Record<SpectrumSource, string> = {
  text: 'Text',
  csv: '.csv',
  pasted: 'Pasted',
  synthetic: 'Example',
  digitized: 'From a graph image',
};
const KIND_LABELS: Record<SpectrumKind, string> = {
  absorbance: 'Absorbance',
  transmittance: 'Transmittance (%T)',
  reflectance: 'Reflectance (%R)',
};
const LEVEL_LABELS = { error: 'Problem', warning: 'Check', info: 'Note' } as const;

interface SpectrumCardProps {
  spectrum: Spectrum;
  onChange: (patch: Partial<Spectrum>) => void;
  onRemove: () => void;
}

/** Summary card for one loaded spectrum, with its data type choice and its messages. */
export function SpectrumCard({ spectrum, onChange, onRemove }: SpectrumCardProps) {
  const { wavelengthNm: x, values, kind, scale } = spectrum;
  const stats = useMemo(() => {
    let max = -Infinity;
    let maxAt = x[0] as number;
    values.forEach((v, i) => {
      if (v > max) {
        max = v;
        maxAt = x[i] as number;
      }
    });
    return { max, maxAt, step: ((x[x.length - 1] as number) - (x[0] as number)) / (x.length - 1) };
  }, [x, values]);
  const suggestion = useMemo(() => suggestKind(values), [values]);
  const messages = [...spectrum.notes, ...checkKind(values, kind, scale)];
  const id = `spectrum-${spectrum.id}`;
  const isPercentScale = kind !== 'absorbance';

  return (
    <article class="pattern-card" aria-labelledby={`${id}-name`}>
      <header class="pattern-card-header">
        <div class="pattern-name-field">
          <label id={`${id}-name`} for={`${id}-input`} class="visually-hidden">
            Spectrum name
          </label>
          <input
            id={`${id}-input`}
            class="pattern-name"
            value={spectrum.name}
            onInput={(e) => onChange({ name: e.currentTarget.value })}
          />
          <span class="badge">{SOURCE_LABELS[spectrum.source]}</span>
          {spectrum.synthetic && <span class="badge badge-accent">Synthetic, not real data</span>}
        </div>
        <button type="button" class="btn btn-quiet" onClick={onRemove}>
          Remove<span class="visually-hidden"> {spectrum.name}</span>
        </button>
      </header>

      <dl class="summary-grid">
        <div>
          <dt>Wavelength range</dt>
          <dd>
            {formatNumber(x[0] as number, 2)} to {formatNumber(x[x.length - 1] as number, 2)} nm
          </dd>
        </div>
        <div>
          <dt>Step</dt>
          <dd>{formatNumber(stats.step, 3)} nm</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{x.length.toLocaleString('en')}</dd>
        </div>
        <div>
          <dt>Highest value</dt>
          <dd>
            {formatNumber(stats.max, 4)} at {formatNumber(stats.maxAt, 2)} nm
          </dd>
        </div>
      </dl>

      <div class="pattern-unit">
        <label for={`${id}-kind`}>What are the values?</label>
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(e) =>
            onChange({ kind: e.currentTarget.value as SpectrumKind, kindOrigin: 'user' })
          }
        >
          {(Object.keys(KIND_LABELS) as SpectrumKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <HelpTip term="absorbance, transmittance and reflectance">
          <p>
            Absorbance (A) is how much light the sample absorbs, on a logarithmic scale.
            Transmittance (T) is the fraction of light that passes through. Reflectance (R) is the
            fraction reflected, used for powders measured by diffuse reflectance. T and R are
            written either in percent (0 to 100) or as a fraction (0 to 1). The conversions are A =
            2 − log₁₀(%T) and %T = 100 · 10^(−A).
          </p>
        </HelpTip>
        {isPercentScale && (
          <>
            <label for={`${id}-scale`} class="visually-hidden">
              Scale of the values
            </label>
            <select
              id={`${id}-scale`}
              value={scale}
              onChange={(e) => onChange({ scale: e.currentTarget.value as ValueScale })}
            >
              <option value="percent">Percent (0 to 100)</option>
              <option value="fraction">Fraction (0 to 1)</option>
            </select>
          </>
        )}
      </div>
      <p class="field-hint">
        {spectrum.kindOrigin === 'user'
          ? 'Set by you.'
          : spectrum.kindOrigin === 'generated'
            ? 'Set by the example generator.'
            : spectrum.kindOrigin === 'header'
              ? 'Taken from the column heading. Please check it.'
              : `A guess from the values: ${suggestion.reason} Please check it.`}
      </p>

      {messages.length > 0 && (
        <ul class="pattern-messages">
          {messages.map((m, i) => (
            <li key={i} class={`message is-${m.level}`}>
              <strong>{LEVEL_LABELS[m.level]}:</strong> {m.text}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
