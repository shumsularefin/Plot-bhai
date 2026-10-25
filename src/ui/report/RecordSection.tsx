import { useState } from 'preact/hooks';
import { downloadBlob, fileStem } from '../plot/export';
import { HelpTip } from '../HelpTip';
import { recordMarkdown, type AnalysisRecord } from './record';

/** Download of the analysis record (Markdown), for the lab notebook or supporting information. */
export function RecordSection({
  build,
  stem,
}: {
  build: () => Promise<AnalysisRecord>;
  stem: string;
}) {
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const save = async () => {
    setStatus({ text: 'Writing the record…', error: false });
    try {
      const text = recordMarkdown(await build(), new Date().toISOString());
      const name = `${fileStem(stem)}-analysis-record.md`;
      downloadBlob(new Blob([text], { type: 'text/markdown' }), name);
      setStatus({ text: `Saved ${name}.`, error: false });
    } catch {
      setStatus({ text: 'The record could not be written in this browser.', error: true });
    }
  };
  return (
    <section aria-labelledby="record-title">
      <h3 id="record-title" class="export-title">
        Analysis record{' '}
        <HelpTip term="analysis record">
          <p>
            A text file that lets someone repeat this analysis: each data set with a SHA-256
            fingerprint of its values, the settings stated in the file, every processing step in the
            order it ran with its parameters (steps that were off are listed as not used), the fit
            statistics and results, every warning shown, the methods text and the build of this
            site. Keep it with the session file, which can be loaded again.
          </p>
        </HelpTip>
      </h3>
      <div class="export-actions">
        <button type="button" class="btn" onClick={() => void save()}>
          Download analysis record (.md)
        </button>
      </div>
      <p class={status?.error ? 'export-status is-error' : 'export-status'} role="status">
        {status?.text}
      </p>
    </section>
  );
}
