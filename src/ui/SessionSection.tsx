import { useRef, useState } from 'preact/hooks';
import type { SessionCodec } from './persist/sessionFile';
import { downloadBlob, fileStem } from './plot/export';

interface SessionSectionProps<D> {
  codec: SessionCodec<D>;
  data: D;
  update: (patch: Partial<D>) => void;
  /** Index of the step this section is on, saved as the step on screen. */
  step: number;
  /** Start of the downloaded file name, for example the first spectrum's name. */
  stem: string;
}

/** Save the whole analysis as a JSON file, or open one saved earlier. */
export function SessionSection<D>({ codec, data, update, step, stem }: SessionSectionProps<D>) {
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const save = () => {
    const text = codec.serialise({ step, furthest: step, data });
    downloadBlob(new Blob([text], { type: 'application/json' }), `${fileStem(stem)}-session.json`);
    setStatus({ text: 'Session file saved.', error: false });
  };
  const load = async (file: File) => {
    const parsed = codec.parse(await file.text());
    if (!parsed.ok) {
      setStatus({ text: parsed.reason, error: true });
      return;
    }
    update(parsed.state.data);
    setStatus({ text: `Session restored from ${file.name}.`, error: false });
  };
  return (
    <section aria-labelledby="session-title">
      <h3 id="session-title" class="export-title">
        Session file
      </h3>
      <p class="field-hint">
        The session file holds your data and every setting. Open it later (or on another computer)
        to continue exactly where you stopped. Opening a file replaces the analysis you have now.
      </p>
      <div class="export-actions">
        <button type="button" class="btn btn-primary" onClick={save}>
          Download session (JSON)
        </button>
        <button type="button" class="btn" onClick={() => input.current?.click()}>
          Open a session file
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          class="visually-hidden"
          aria-label="Session file to open"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void load(file);
          }}
        />
      </div>
      <p class={status?.error ? 'export-status is-error' : 'export-status'} role="status">
        {status?.text}
      </p>
    </section>
  );
}
