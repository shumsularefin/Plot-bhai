import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const API = 'https://feedback.test';

/** Loads the feedback modules with the service switched on and `fetch` answered by `answer`. */
async function load(answer: (path: string, body: unknown) => { status: number; body: unknown }) {
  vi.stubEnv('VITE_FEEDBACK_API', API);
  vi.resetModules();
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = url.slice(API.length);
      const body: unknown = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ path, body });
      const { status, body: reply } = answer(path, body);
      return Promise.resolve(new Response(JSON.stringify(reply), { status }));
    }),
  );
  const client = await import('../src/ui/feedback/client');
  const { ValidateButton } = await import('../src/ui/feedback/ValidateButton');
  const { Community } = await import('../src/ui/feedback/Community');
  return { client, ValidateButton, Community, calls };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Validate button', () => {
  it('asks for a finished analysis before a validation', async () => {
    const { ValidateButton, calls } = await load(() => ({ status: 200, body: {} }));
    render(<ValidateButton tool="XRD analysis" />);
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    expect(screen.getByRole('dialog').textContent).toContain('early testing version');
    expect(screen.getByText(/Finish an analysis in this section first/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('sends the verdict and comment with the proof of the analysis', async () => {
    const { client, ValidateButton, calls } = await load((path) =>
      path === '/analysis'
        ? { status: 200, body: { id: 'a1', proof: 'p1' } }
        : { status: 200, body: { ok: true, pending: true } },
    );
    await client.recordAnalysis('XRD analysis');
    // A second finish on the same day is not counted again.
    await client.recordAnalysis('XRD analysis');
    expect(calls.filter((c) => c.path === '/analysis')).toHaveLength(1);

    render(<ValidateButton tool="XRD analysis" />);
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(screen.getByLabelText('Something is wrong'));
    fireEvent.input(screen.getByLabelText('Comment (optional)'), {
      target: { value: '  The size looks too small.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText(/Your comment will appear once it has been read/);
    const sent = calls.find((c) => c.path === '/validate')?.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      tool: 'XRD analysis',
      id: 'a1',
      proof: 'p1',
      verdict: 'problem',
      comment: 'The size looks too small.',
    });
    expect(client.proofFor('XRD analysis')).toBeNull();
  });

  it('shows the reason when the service refuses', async () => {
    const { client, ValidateButton } = await load((path) =>
      path === '/analysis'
        ? { status: 200, body: { id: 'a1', proof: 'p1' } }
        : { status: 429, body: { error: 'Daily limit reached.' } },
    );
    await client.recordAnalysis('FTIR analysis');
    render(<ValidateButton tool="FTIR analysis" />);
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Daily limit reached.');
  });
});

describe('Home counters', () => {
  it('shows the counters and approved comments', async () => {
    const { Community } = await load((path) =>
      path === '/stats'
        ? { status: 200, body: { visits: 1234, analyses: 56, validations: 7 } }
        : {
            status: 200,
            body: {
              comments: [
                {
                  id: 1,
                  created: '2026-10-27T10:00:00.000Z',
                  tool: 'UV-Vis analysis',
                  verdict: 'works',
                  comment: 'Band gap matched.',
                },
              ],
            },
          },
    );
    render(<Community />);
    await screen.findByText('1,234');
    expect(screen.getByText('56')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Band gap matched.')).toBeTruthy());
    expect(screen.getByText(/UV-Vis analysis · It worked · 2026-10-27/)).toBeTruthy();
  });

  it('stays hidden when the service is switched off', async () => {
    vi.resetModules();
    const { Community } = await import('../src/ui/feedback/Community');
    const view = render(<Community />);
    await Promise.resolve();
    expect(view.container.textContent).toBe('');
  });
});
