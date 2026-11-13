import { useMemo } from 'preact/hooks';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { summarise } from '../../core/xrd/summary';
import type { IntensityUnit, Pattern } from '../../core/xrd/types';
import { checkPattern } from '../../core/xrd/validate';
import { HelpTip } from '../../ui/HelpTip';

const FORMAT_LABELS: Record<Pattern['source'], string> = {
  xy: '.xy',
  xye: '.xye',
  csv: '.csv',
  text: 'Text',
  xrdml: 'XRDML',
  ras: 'Rigaku RAS',
  rasx: 'Rigaku RASX',
  brml: 'Bruker BRML',
  raw: 'Bruker RAW',
  pasted: 'Pasted',
  synthetic: 'Example',
  digitized: 'From an image',
};
const UNIT_NAMES: Record<IntensityUnit, string> = { counts: 'counts', cps: 'cps' };
const LEVEL_LABELS = { error: 'Problem', warning: 'Check', info: 'Note' } as const;

interface PatternCardProps {
  pattern: Pattern;
  onChange: (patch: Partial<Pattern>) => void;
  onConvertRadians: () => void;
  onRemove: () => void;
}

/**
 * Summary card for one loaded pattern: the essentials, any problem shown right where it applies,
 * and the file's details and notes folded away until asked for.
 */
export function PatternCard({ pattern, onChange, onConvertRadians, onRemove }: PatternCardProps) {
  const summary = useMemo(
    () => summarise(pattern.twoTheta, pattern.intensity),
    [pattern.twoTheta, pattern.intensity],
  );
  const check = useMemo(() => checkPattern(pattern), [pattern]);
  const messages = [...pattern.notes, ...check.messages];
  // Problems and checks stay in view; plain notes about the file wait under "More about this file".
  const alerts = messages.filter((m) => m.level !== 'info');
  const notes = messages.filter((m) => m.level === 'info');
  const unit = UNIT_NAMES[pattern.intensityUnit];
  const deg = (v: number) => `${formatNumber(v, 3)}°`;
  const id = `pattern-${pattern.id}`;

  return (
    <article class="pattern-card" aria-labelledby={`${id}-name`}>
      <header class="pattern-card-header">
        <div class="pattern-name-field">
          <label id={`${id}-name`} for={`${id}-input`} class="visually-hidden">
            Pattern name
          </label>
          <input
            id={`${id}-input`}
            class="pattern-name"
            value={pattern.name}
            onInput={(e) => onChange({ name: e.currentTarget.value })}
          />
          <span class="badge">{FORMAT_LABELS[pattern.source]}</span>
          {pattern.synthetic && <span class="badge badge-accent">Calculated, not measured</span>}
          {pattern.digitized && (
            <span class="badge badge-accent">Digitized from a figure: approximate</span>
          )}
        </div>
        <button type="button" class="btn btn-quiet" onClick={onRemove}>
          Remove<span class="visually-hidden"> {pattern.name}</span>
        </button>
      </header>

      <dl class="summary-grid">
        <div>
          <dt>2θ range</dt>
          <dd>
            {deg(summary.twoThetaMin)} to {deg(summary.twoThetaMax)}
          </dd>
        </div>
        <div>
          <dt>Step</dt>
          <dd>
            {summary.step.uniform ? '' : '≈ '}
            {formatNumber(summary.step.median, 5)}°{summary.step.uniform ? '' : ' (varies)'}
          </dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>{summary.points.toLocaleString('en')}</dd>
        </div>
        {pattern.digitized && (
          <div>
            <dt>Read from</dt>
            <dd>
              {pattern.digitized.image}, {formatNumber(pattern.digitized.pixelDeg, 3)}° per pixel,
              line {formatNumber(pattern.digitized.lineWidthPx, 2)} px thick
            </dd>
          </div>
        )}
      </dl>

      {!pattern.digitized && (
        <div class="pattern-unit">
          <label for={`${id}-unit`}>Intensity unit</label>
          <select
            id={`${id}-unit`}
            value={pattern.intensityUnit}
            onChange={(e) =>
              onChange({
                intensityUnit: e.currentTarget.value as IntensityUnit,
                unitOrigin: 'user',
              })
            }
          >
            <option value="counts">Counts (raw detector counts)</option>
            <option value="cps">Counts per second (cps)</option>
          </select>
          <HelpTip term="counts versus counts per second">
            <p>
              Counts are the number of X-ray photons detected at each point. Counts per second (cps)
              are counts divided by the counting time. Raw counts are whole numbers; cps usually are
              not. Knowing which one you have matters later when estimating noise.
            </p>
          </HelpTip>
        </div>
      )}

      {alerts.length > 0 && (
        <ul class="pattern-messages">
          {alerts.map((m, i) => (
            <li key={i} class={`message is-${m.level}`}>
              <strong>{LEVEL_LABELS[m.level]}:</strong> {m.text}
            </li>
          ))}
        </ul>
      )}
      {check.looksLikeRadians && (
        <button type="button" class="btn" onClick={onConvertRadians}>
          Convert 2θ from radians to degrees
        </button>
      )}

      <details class="pattern-details">
        <summary>
          More about this file
          {notes.length > 0 && ` (${notes.length} ${notes.length === 1 ? 'note' : 'notes'})`}
        </summary>
        <dl class="summary-grid">
          <div>
            <dt>Max intensity</dt>
            <dd>
              {formatNumber(summary.maxIntensity, 3)} {unit} at {deg(summary.maxIntensityAt)}
            </dd>
          </div>
          {pattern.countingTimeS !== undefined && (
            <div>
              <dt>Counting time</dt>
              <dd>{formatNumber(pattern.countingTimeS)} s per point</dd>
            </div>
          )}
          {pattern.wavelengthFromFileA !== undefined && (
            <div>
              <dt>Wavelength in file</dt>
              <dd>{formatNumber(pattern.wavelengthFromFileA, 6)} Å (as written in the file)</dd>
            </div>
          )}
        </dl>
        {notes.length > 0 && (
          <ul class="pattern-notes">
            {notes.map((m, i) => (
              <li key={i}>{m.text}</li>
            ))}
          </ul>
        )}
        {pattern.metadata && pattern.metadata.length > 0 && (
          <details class="pattern-metadata">
            <summary>Measurement settings from the file header ({pattern.metadata.length})</summary>
            <dl class="summary-grid">
              {pattern.metadata.map((field, i) => (
                <div key={i}>
                  <dt>{field.key}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </details>
    </article>
  );
}
