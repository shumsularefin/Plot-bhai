import type { ComponentChildren } from 'preact';
import type { DataMessage } from '../../core/xrd/types';

interface StepSectionProps {
  id: string;
  title: string;
  /** One or two plain-language sentences on what the step does and when to use it. */
  description: ComponentChildren;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onReset: () => void;
  messages?: readonly DataMessage[] | undefined;
  /** Disables the switch, for example Kα2 stripping when the data are Kα1 only. */
  unavailable?: string | undefined;
  children?: ComponentChildren;
}

const LEVEL_LABELS = { error: 'Problem', warning: 'Check', info: 'Note' } as const;

/** One preprocessing step: an on/off switch, a description, its settings and a reset button. */
export function StepSection(props: StepSectionProps) {
  const { id, title, description, enabled, onToggle, onReset, messages, unavailable, children } =
    props;
  return (
    <section class={`process-step${enabled ? ' is-on' : ''}`} aria-labelledby={`${id}-title`}>
      <div class="process-step-header">
        <label class="switch">
          <input
            type="checkbox"
            role="switch"
            checked={enabled}
            disabled={unavailable !== undefined}
            onChange={(e) => onToggle(e.currentTarget.checked)}
          />
          <span id={`${id}-title`} class="process-step-title">
            {title}
          </span>
        </label>
        <button type="button" class="btn btn-quiet" onClick={onReset}>
          Reset<span class="visually-hidden"> {title}</span>
        </button>
      </div>
      <p class="process-step-description">{description}</p>
      {unavailable && <p class="field-hint">{unavailable}</p>}
      {enabled && children && <div class="process-step-body">{children}</div>}
      {enabled && messages && messages.length > 0 && (
        <ul class="pattern-messages">
          {messages.map((m, i) => (
            <li key={i} class={`message is-${m.level}`}>
              <strong>{LEVEL_LABELS[m.level]}:</strong> {m.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
