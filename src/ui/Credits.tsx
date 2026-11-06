import { useEffect, useRef, useState } from 'preact/hooks';
import './feedback/feedback.css';

/** Who made the site, shown in full on the About page and in a small pop-up on the home page. */
export function CreditsText() {
  return (
    <>
      <p>
        Designed and developed by{' '}
        <a href="https://shumsul-arefin.web.app" target="_blank" rel="noopener noreferrer">
          <strong>Shumsul Arefin</strong>
        </a>
        , graduate student, Department of Applied Chemistry and Chemical Engineering, Gopalganj
        Science and Technology University (GSTU).
      </p>
      <p>Supervised by:</p>
      <ul>
        <li>
          <strong>Dr. MD Kamruzzaman</strong>, Professor and Chairman, Department of Applied
          Chemistry and Chemical Engineering, GSTU
        </li>
        <li>
          <strong>S. M. Fazle Rabbi</strong>, Lecturer, Department of Applied Chemistry and Chemical
          Engineering, GSTU
        </li>
      </ul>
    </>
  );
}

/** A small "About" button that opens the credits. */
export function CreditsButton() {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closer.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    opener.current?.focus();
  };
  return (
    <>
      <button
        ref={opener}
        type="button"
        class="btn btn-quiet credits-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        About
      </button>
      {open && (
        <div class="validate-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
          <div
            class="validate-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="credits-title"
            onKeyDown={(e) => e.key === 'Escape' && close()}
          >
            <h2 id="credits-title" class="validate-title">
              About Plot Bhai
            </h2>
            <CreditsText />
            <p>
              <a href="#/about" onClick={close}>
                Equations, assumptions and limits
              </a>
            </p>
            <div class="export-actions">
              <button ref={closer} type="button" class="btn" onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
