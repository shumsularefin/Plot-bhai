import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_COMMENT } from './limits';
import { FEEDBACK_API, proofFor, sendValidation, type SendResult, type Verdict } from './client';
import './feedback.css';

/** Whether the section has a finished analysis waiting for validation; follows changes in any tab. */
function useProof(tool: string): boolean {
  const [has, setHas] = useState(() => proofFor(tool) !== null);
  useEffect(() => {
    const check = () => setHas(proofFor(tool) !== null);
    check();
    window.addEventListener('plot-bhai-proofs', check);
    window.addEventListener('storage', check);
    return () => {
      window.removeEventListener('plot-bhai-proofs', check);
      window.removeEventListener('storage', check);
    };
  }, [tool]);
  return has;
}

/**
 * The highlighted Validate button of an analysis section and its pop-up: the tool is a testing
 * version, so users are asked whether the result worked, with an optional comment that is
 * published only after the owner approves it. A validation needs a finished analysis.
 */
export function ValidateButton({ tool }: { tool: string }) {
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<Verdict>('works');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const ready = useProof(tool);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) dialog.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setResult(null);
    opener.current?.focus();
  };
  const send = async () => {
    setBusy(true);
    const sent = await sendValidation(tool, verdict, comment.trim());
    setBusy(false);
    setResult(sent);
    if (sent.ok) setComment('');
  };

  return (
    <>
      <button
        ref={opener}
        type="button"
        class="btn validate-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Validate
      </button>
      {open && (
        <div class="validate-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
          <div
            ref={dialog}
            class="validate-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="validate-title"
            onKeyDown={(e) => e.key === 'Escape' && close()}
          >
            <h2 id="validate-title" class="validate-title">
              Help test {tool}
            </h2>
            <p>
              This tool is an <strong>early testing version</strong>. Please check its result
              against what you know or another program, and say whether it worked. Your comment
              helps fix problems; it is published on the home page only after the site owner has
              read it.
            </p>
            {result?.ok ? (
              <p class="message is-info" role="status">
                Thank you.{' '}
                {result.pending
                  ? 'Your comment will appear once it has been read.'
                  : 'Your validation was counted.'}
              </p>
            ) : !FEEDBACK_API ? (
              <p class="message is-warning" role="status">
                Validation is switched off on this copy of the site.
              </p>
            ) : !ready ? (
              <p class="message is-warning" role="status">
                Finish an analysis in this section first: go on to its last step, then press
                Validate again.
              </p>
            ) : (
              <>
                <fieldset class="method-choice">
                  <legend>Did it work for your data?</legend>
                  <label class="check">
                    <input
                      type="radio"
                      name="validate-verdict"
                      checked={verdict === 'works'}
                      onChange={() => setVerdict('works')}
                    />
                    It worked
                  </label>
                  <label class="check">
                    <input
                      type="radio"
                      name="validate-verdict"
                      checked={verdict === 'problem'}
                      onChange={() => setVerdict('problem')}
                    />
                    Something is wrong
                  </label>
                </fieldset>
                <label class="inline-field validate-comment">
                  Comment (optional)
                  <textarea
                    rows={4}
                    maxLength={MAX_COMMENT}
                    value={comment}
                    onInput={(e) => setComment(e.currentTarget.value)}
                  />
                </label>
                <p class="field-hint">
                  Sent: the name of this section, your answer, your comment and a random ID for this
                  browser. Your data files and results are not sent. Do not write personal details
                  in the comment.
                </p>
                {result && !result.ok && (
                  <p class="message is-warning" role="alert">
                    {result.message}
                  </p>
                )}
              </>
            )}
            <div class="export-actions">
              {ready && !result?.ok && (
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={busy}
                  onClick={() => void send()}
                >
                  {busy ? 'Sending…' : 'Send'}
                </button>
              )}
              <button type="button" class="btn" onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
