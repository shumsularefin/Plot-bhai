import { useMemo } from 'preact/hooks';
import { checkFtirKind, suggestFtirKind } from '../../core/ftir/kind';
import type { FtirKind, FtirSource, FtirSpectrum, ValueScale } from '../../core/ftir/types';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { HelpTip } from '../../ui/HelpTip';

const SOURCE_LABELS: Record<FtirSource, string> = {
  text: 'Text',
  csv: '.csv',
  jcamp: 'JCAMP-DX',
  pasted: 'Pasted',
  synthetic: 'Example',
  digitized: 'From a graph image',
  computed: 'Made here (difference)',
};
const KIND_LABELS: Record<FtirKind, string> = {
  absorbance: 'Absorbance',
  transmittance: 'Transmittance (%T)',
};
const LEVEL_LABELS = { error: 'Problem', warning: 'Check', info: 'Note' } as const;

interface FtirSpectrumCardProps {
  spectrum: FtirSpectrum;
  onChange: (patch: Partial<FtirSpectrum>) => void;
  onRemove: () => void;
}

/** Summary card for one loaded spectrum, with its data type choice and its messages. */
export function FtirSpectrumCard({ spectrum, onChange, onRemove }: FtirSpectrumCardProps) {
  const { wavenumber: x, values, kind, scale } = spectrum;
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
  const suggestion = useMemo(() => suggestFtirKind(values), [values]);
  const messages = [...spectrum.notes, ...checkFtirKind(values, kind, scale)];
  const id = `ftir-${spectrum.id}`;

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
          <dt>Wavenumber range</dt>
          <dd>
            {formatNumber(x[0] as number, 1)} to {formatNumber(x[x.length - 1] as number, 1)} cm⁻¹
          </dd>
        </div>
        <div>
          <dt>Step</dt>
          <dd>{formatNumber(stats.step, 3)} cm⁻¹</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{x.length.toLocaleString('en')}</dd>
        </div>
        <div>
          <dt>Highest value</dt>
          <dd>
            {formatNumber(stats.max, 4)} at {formatNumber(stats.maxAt, 1)} cm⁻¹
          </dd>
        </div>
      </dl>

      <div class="pattern-unit">
        <label for={`${id}-kind`}>What are the values?</label>
        <select
          id={`${id}-kind`}
          value={kind}
          onChange={(e) =>
            onChange({ kind: e.currentTarget.value as FtirKind, kindOrigin: 'user' })
          }
        >
          {(Object.keys(KIND_LABELS) as FtirKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {kind === 'transmittance' && (
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
        <HelpTip term="absorbance and transmittance">
          <p>
            Absorbance (A) is how much infrared light the sample absorbs, on a logarithmic scale, so
            bands point up. Transmittance (T) is the fraction that passes through, so bands point
            down. They convert into each other: A = 2 − log₁₀(%T) and %T = 100 · 10^(−A). This site
            always analyses absorbance, converting transmittance first.
          </p>
        </HelpTip>
      </div>
      <p class="field-hint">
        {spectrum.kindOrigin === 'user'
          ? 'Set by you.'
          : spectrum.kindOrigin === 'generated'
            ? 'Set by the example generator.'
            : spectrum.kindOrigin === 'header'
              ? 'Taken from the file. Please check it.'
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
