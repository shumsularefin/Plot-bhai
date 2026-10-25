import { RecordSection } from '../../ui/report/RecordSection';
import { xrdRecord } from './record';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ProcessingResult } from '../../core/xrd/process/pipeline';
import type { Pattern } from '../../core/xrd/types';
import { downloadBlob, fileStem } from '../../ui/plot/export';
import { PlotPanel } from '../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../ui/plot/series';
import type { StepContext } from '../../ui/wizard/types';
import { assignmentFor, peakLabelSet } from './assignment';
import { downloadTable } from './csv';
import { processingFor, type XrdData } from './data';
import { referenceLanesFor } from './figure';
import { xrdLabels } from './labels';
import { methodsFor } from './methodsText';
import { parseSession, serialiseSession } from './session';
import { allTables, combinedCsv } from './tables';
import { useProcessed } from './useProcessed';
import { useCandidatePhases } from './useReferencePhases';

/** Index of this step in the wizard, saved in the session file as the step on screen. */
const EXPORT_STEP = 7;

/** Cleans one pattern in a worker and reports the result upward (hooks cannot run in a loop). */
function ProcessedFeed({
  pattern,
  data,
  onResult,
}: {
  pattern: Pattern;
  data: XrdData;
  onResult: (id: string, result: ProcessingResult | null) => void;
}) {
  const { result } = useProcessed(pattern, processingFor(data, pattern.id), data.radiation);
  useEffect(() => onResult(pattern.id, result), [pattern.id, result, onResult]);
  return null;
}

/** Wizard step 8: figure, methods text, tables and the session file. */
export function ExportStep({ data, update }: StepContext<XrdData>) {
  const { phases } = useCandidatePhases(data.material);
  const [processed, setProcessed] = useState<Record<string, ProcessingResult | null>>({});
  const onResult = (id: string, result: ProcessingResult | null) =>
    setProcessed((all) => (all[id] === result ? all : { ...all, [id]: result }));

  const sources = useMemo<SeriesSource[]>(
    () =>
      data.patterns.flatMap((pattern, i) => {
        const result = processed[pattern.id];
        return result
          ? [
              {
                id: pattern.id,
                name: pattern.name,
                x: result.twoTheta,
                y: result.intensity,
                unit: pattern.intensityUnit === 'counts' ? 'counts' : 'cps',
                colorIndex: i,
              },
            ]
          : [];
      }),
    [data.patterns, processed],
  );

  // Labels and lanes come from the first pattern that has fitted peaks and a chosen phase.
  const assignment = useMemo(() => {
    if (!phases) return null;
    for (const pattern of data.patterns) {
      const result = assignmentFor(data, pattern.id, phases, false);
      if (result) return { pattern, result };
    }
    return null;
  }, [data, phases]);
  const lanes = useMemo(
    () => (assignment ? referenceLanesFor(data, assignment.result) : []),
    [data, assignment],
  );
  const peakLabels = useMemo(
    () => (assignment ? peakLabelSet(assignment.result) : undefined),
    [assignment],
  );

  const methods = methodsFor(data, phases ?? []);
  const tables = useMemo(() => allTables(data, phases ?? []), [data, phases]);

  if (data.patterns.length === 0)
    return <p>No patterns are loaded. Go back to Upload to add one.</p>;

  return (
    <div class="export-step">
      {data.patterns.map((pattern) => (
        <ProcessedFeed key={pattern.id} pattern={pattern} data={data} onResult={onResult} />
      ))}

      <section aria-labelledby="figure-title">
        <h3 id="figure-title" class="export-title">
          Figure
        </h3>
        <p class="field-hint">
          Stack several patterns with an offset, choose the width of a single or double column, the
          font and the line width, then download SVG or PNG.
          {assignment &&
            ` Peak labels (hkl) and the reference lines under the figure come from ${assignment.pattern.name}; each lane is named with its phase and COD ID.`}
        </p>
        {sources.length > 0 ? (
          <PlotPanel
            sources={sources}
            settings={data.plot}
            onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
            labels={xrdLabels}
            xName="2θ"
            xUnit="°"
            exportName="xrd-figure"
            lanes={lanes}
            {...(peakLabels && { peakLabels })}
          />
        ) : (
          <p aria-busy="true">Preparing the patterns…</p>
        )}
      </section>

      <MethodsSection text={methods} />
      <TablesSection tables={tables} />
      <RecordSection
        build={() => xrdRecord(data, phases ?? [])}
        stem={data.patterns[0]?.name ?? 'xrd'}
      />
      <SessionSection data={data} update={update} />
    </div>
  );
}

function MethodsSection({ text }: { text: string }) {
  const [status, setStatus] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied.');
    } catch {
      setStatus('Copying was not allowed here. Select the text and copy it by hand.');
    }
  };
  return (
    <section aria-labelledby="methods-title">
      <h3 id="methods-title" class="export-title">
        Methods text
      </h3>
      <p class="field-hint">
        Written from the settings you actually used. Check it against your instrument and sample
        before you paste it into a paper; it does not describe how the sample was made or measured.
      </p>
      <p class="methods-text" data-testid="methods-text">
        {text}
      </p>
      <div class="export-actions">
        <button type="button" class="btn" onClick={() => void copy()}>
          Copy text
        </button>
        <p class="export-status" role="status">
          {status}
        </p>
      </div>
    </section>
  );
}

function TablesSection({ tables }: { tables: ReturnType<typeof allTables> }) {
  return (
    <section aria-labelledby="tables-title">
      <h3 id="tables-title" class="export-title">
        Tables
      </h3>
      {tables.length === 0 ? (
        <p class="field-hint">
          There are no tables yet. Fit peaks in step 5 to get the peak, assignment and size tables.
        </p>
      ) : (
        <>
          <p class="field-hint">
            One CSV file per table, or all of them in one file with a &quot;## name&quot; line
            before each. Texture, crystallinity and the per-method line fits can be downloaded from
            their own sections in step 7.
          </p>
          <ul class="table-list">
            {tables.map((table) => (
              <li key={table.name}>
                <button type="button" class="btn" onClick={() => downloadTable(table)}>
                  {table.name}.csv
                </button>
              </li>
            ))}
          </ul>
          <div class="export-actions">
            <button
              type="button"
              class="btn"
              onClick={() =>
                downloadBlob(
                  new Blob([combinedCsv(tables)], { type: 'text/csv' }),
                  'xrd-all-tables.csv',
                )
              }
            >
              All tables in one CSV
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function SessionSection({ data, update }: StepContext<XrdData>) {
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const save = () => {
    const text = serialiseSession({ step: EXPORT_STEP, furthest: EXPORT_STEP, data });
    downloadBlob(
      new Blob([text], { type: 'application/json' }),
      `${fileStem(data.patterns[0]?.name ?? 'xrd')}-session.json`,
    );
    setStatus({ text: 'Session file saved.', error: false });
  };
  const load = async (file: File) => {
    const parsed = parseSession(await file.text());
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
