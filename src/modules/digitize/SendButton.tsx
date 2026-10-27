import { useState } from 'preact/hooks';

interface SendButtonProps {
  label: string;
  /** Adds the curve to the tool; returns a plain-language problem, or null when it worked. */
  onSend: () => Promise<string | null>;
  /** The tool's route, opened after a successful send. */
  route: string;
}

/** The button that hands the curve to the analysis tool and opens it. */
export function SendButton({ label, onSend, route }: SendButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const problem = await onSend();
      if (problem) setError(problem);
      else location.hash = route;
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error && (
        <p class="message is-error" role="alert">
          <strong>Problem:</strong> {error}
        </p>
      )}
      <div class="upload-actions">
        <button type="button" class="btn btn-primary" disabled={busy} onClick={() => void send()}>
          {label}
        </button>
      </div>
    </>
  );
}
