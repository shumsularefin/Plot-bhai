/*
 * Client of the feedback service (worker-feedback/, on Cloudflare): counts visits and finished
 * analyses, and sends validations. What is sent: a random ID for this browser, the name of the
 * analysis section, the verdict and the comment the user typed. Data files and results are never
 * sent. Everything fails quietly when the service cannot be reached; the tools work without it.
 */

/**
 * Address of the deployed service, without a trailing slash; it must also be in connect-src in
 * firebase.json. VITE_FEEDBACK_API overrides it at build time; an empty value switches the
 * service off (the unit tests do that).
 */
export const FEEDBACK_API: string =
  (import.meta.env['VITE_FEEDBACK_API'] as string | undefined) ??
  'https://plot-bhai-feedback.plot-bhai.workers.dev';

const BROWSER_KEY = 'plot-bhai-browser';
const PROOFS_KEY = 'plot-bhai-analyses';
const VISIT_KEY = 'plot-bhai-visit';

let memoryBrowser: string | null = null;

/** A random ID for this browser, kept in local storage (or for this visit when storage is blocked). */
export function browserId(): string {
  try {
    const saved = localStorage.getItem(BROWSER_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(BROWSER_KEY, id);
    return id;
  } catch {
    memoryBrowser ??= crypto.randomUUID();
    return memoryBrowser;
  }
}

async function post(path: string, body: object): Promise<Response | null> {
  if (!FEEDBACK_API) return null;
  try {
    return await fetch(`${FEEDBACK_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browser: browserId(), ...body }),
    });
  } catch {
    return null;
  }
}

async function getJson<T>(path: string): Promise<T | null> {
  if (!FEEDBACK_API) return null;
  try {
    const response = await fetch(`${FEEDBACK_API}${path}`);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Counts this visit once per browser tab session. */
export function recordVisit(): void {
  try {
    if (sessionStorage.getItem(VISIT_KEY)) return;
    sessionStorage.setItem(VISIT_KEY, '1');
  } catch {
    // Without session storage every page load would count; the service still counts a browser once a day.
  }
  void post('/visit', {});
}

/** The proof of a finished analysis in one section, valid for the day it was made and the next. */
interface Proof {
  id: string;
  proof: string;
  day: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

function readProofs(): Record<string, Proof> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROOFS_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Proof>) : {};
  } catch {
    return {};
  }
}

function writeProofs(proofs: Record<string, Proof>): void {
  try {
    localStorage.setItem(PROOFS_KEY, JSON.stringify(proofs));
  } catch {
    // The proof just is not kept; the user can finish the analysis again.
  }
  window.dispatchEvent(new Event('plot-bhai-proofs'));
}

function dropProof(tool: string): void {
  writeProofs(Object.fromEntries(Object.entries(readProofs()).filter(([key]) => key !== tool)));
}

/** The proof for a section, when there is a current one. */
export function proofFor(tool: string): Proof | null {
  const proof = readProofs()[tool];
  return proof && (proof.day === today() || proof.day === yesterday()) ? proof : null;
}

/** Records a finished analysis in a section, unless one from today is still waiting for validation. */
export async function recordAnalysis(tool: string): Promise<void> {
  if (proofFor(tool)?.day === today()) return;
  const response = await post('/analysis', { tool });
  if (!response?.ok) return;
  try {
    const { id, proof } = (await response.json()) as { id: string; proof: string };
    writeProofs({ ...readProofs(), [tool]: { id, proof, day: today() } });
  } catch {
    // An unreadable answer leaves no proof.
  }
}

export type Verdict = 'works' | 'problem';

export type SendResult =
  | { ok: true; pending: boolean }
  | { ok: false; reason: 'no-analysis' | 'unreachable' | 'refused'; message: string };

/** Sends a validation of the latest analysis in a section. */
export async function sendValidation(
  tool: string,
  verdict: Verdict,
  comment: string,
): Promise<SendResult> {
  const proof = proofFor(tool);
  if (!proof) {
    return {
      ok: false,
      reason: 'no-analysis',
      message: 'Finish an analysis in this section first: go on to its last step, then validate.',
    };
  }
  const response = await post('/validate', {
    tool,
    id: proof.id,
    proof: proof.proof,
    verdict,
    comment,
  });
  if (!response) {
    return {
      ok: false,
      reason: 'unreachable',
      message:
        'The validation service could not be reached. Check your connection and try again later.',
    };
  }
  let body: { ok?: boolean; pending?: boolean; error?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Handled below as a refusal without a reason.
  }
  if (response.ok && body.ok) {
    dropProof(tool);
    return { ok: true, pending: body.pending === true };
  }
  if (response.status === 409) {
    dropProof(tool);
  }
  return {
    ok: false,
    reason: 'refused',
    message: body.error ?? 'The validation was not accepted.',
  };
}

export interface Stats {
  visits: number;
  analyses: number;
  validations: number;
}

export interface PublicComment {
  id: number;
  created: string;
  tool: string;
  verdict: Verdict;
  comment: string;
}

export const fetchStats = () => getJson<Stats>('/stats');

export async function fetchComments(): Promise<PublicComment[] | null> {
  return (await getJson<{ comments: PublicComment[] }>('/comments'))?.comments ?? null;
}
