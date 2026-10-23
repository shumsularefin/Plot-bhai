import { useRef, useState } from 'preact/hooks';
import type { Pattern } from '../../core/xrd/types';
import { radiansToDegrees } from '../../core/xrd/validate';
import { HelpTip } from '../../ui/HelpTip';
import { MAX_SERIES } from '../../ui/plot/palette';
import type { StepContext } from '../../ui/wizard/types';
import { examplePatternRecords, newId, type XrdData } from './data';
import { importInWorker } from './importClient';
import { PatternCard } from './PatternCard';
import { XrdPlot } from './XrdPlot';

interface ImportProblem {
  name: string;
  error: string;
}

/** Wizard step 1: load patterns by drag and drop, file picker, paste, or example data. */
export function UploadStep({ data, update }: StepContext<XrdData>) {
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<ImportProblem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pasted, setPasted] = useState('');
  const [removed, setRemoved] = useState<{ pattern: Pattern; index: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const patterns = data.patterns;
  const full = patterns.length >= MAX_SERIES;

  const addPatterns = (added: Pattern[]) => {
    if (added.length > 0) update({ patterns: [...patterns, ...added] });
  };

  const importAll = async (requests: Parameters<typeof importInWorker>[0][], names: string[]) => {
    const room = MAX_SERIES - patterns.length;
    const tooMany = names.slice(Math.max(room, 0)).map((name) => ({
      name,
      error: `Up to ${MAX_SERIES} patterns can be loaded at once. Remove one to add another.`,
    }));
    setBusy(requests.length === 1 ? 'Reading the data…' : `Reading ${requests.length} files…`);
    setRemoved(null);
    const results = await Promise.all(requests.slice(0, Math.max(room, 0)).map(importInWorker));
    const found: ImportProblem[] = [...tooMany];
    const added: Pattern[] = [];
    results.forEach((result, i) => {
      if (result.ok) added.push({ ...result.pattern, id: newId() });
      else found.push({ name: names[i] as string, error: result.error });
    });
    addPatterns(added);
    setProblems(found);
    setBusy(null);
    return added.length;
  };

  const importFiles = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length === 0) return;
    void importAll(
      files.map((file) => ({ kind: 'file' as const, file })),
      files.map((file) => file.name),
    );
  };

  const importPasted = async () => {
    const name = `Pasted data ${patterns.filter((p) => p.source === 'pasted').length + 1}`;
    const loaded = await importAll([{ kind: 'text', name, text: pasted }], [name]);
    if (loaded > 0) setPasted('');
  };

  const loadExample = () => {
    setProblems([]);
    setRemoved(null);
    const room = MAX_SERIES - patterns.length;
    const examples = examplePatternRecords().filter(
      (e) => !patterns.some((p) => p.name === e.name),
    );
    addPatterns(examples.slice(0, Math.max(room, 0)));
  };

  const changePattern = (id: string, patch: Partial<Pattern>) =>
    update({ patterns: patterns.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const remove = (index: number) => {
    const pattern = patterns[index];
    if (!pattern) return;
    setRemoved({ pattern, index });
    update({ patterns: patterns.filter((_, i) => i !== index) });
  };

  const undoRemove = () => {
    if (!removed) return;
    const next = [...patterns];
    next.splice(Math.min(removed.index, next.length), 0, removed.pattern);
    update({ patterns: next });
    setRemoved(null);
  };

  return (
    <div class="upload-step">
      <p>
        Load one or more diffraction patterns: intensity measured against the angle 2θ{' '}
        <HelpTip term="2θ">
          <p>
            2θ (two-theta) is the angle between the incoming X-ray beam and the diffracted beam. A
            diffractometer records intensity at each 2θ angle, usually in degrees.
          </p>
        </HelpTip>
      </p>

      <div
        class={`drop-zone${dragging ? ' is-dragging' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!full) importFiles(e.dataTransfer?.files ?? null);
        }}
      >
        <p class="drop-zone-title">Drag and drop files here</p>
        <p class="field-hint">
          .xy, .xye, .dat, .txt, .csv, .xrdml (PANalytical) or .ras (Rigaku). Files stay on your
          device.
        </p>
        <button
          type="button"
          class="btn btn-primary"
          onClick={() => fileInput.current?.click()}
          disabled={full}
        >
          Choose files
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          class="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            importFiles(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </div>

      <div class="upload-actions">
        <button type="button" class="btn" onClick={loadExample} disabled={full}>
          Try with example data
        </button>
        <span class="field-hint">
          Loads two synthetic patterns, generated by this site. They are not real measurements.
        </span>
      </div>

      <details class="paste-box">
        <summary>Paste data instead</summary>
        <div class="field paste-field">
          <label for="xrd-paste">Two columns: 2θ in degrees and intensity</label>
          <textarea
            id="xrd-paste"
            rows={6}
            spellcheck={false}
            value={pasted}
            placeholder={'10.00  152\n10.02  149\n…'}
            onInput={(e) => setPasted(e.currentTarget.value)}
          />
          <button
            type="button"
            class="btn"
            onClick={() => void importPasted()}
            disabled={pasted.trim() === '' || full}
          >
            Load pasted data
          </button>
        </div>
      </details>

      <p class="upload-status" role="status">
        {busy}
        {removed && (
          <>
            Removed {removed.pattern.name}.{' '}
            <button type="button" class="btn btn-quiet" onClick={undoRemove}>
              Undo
            </button>
          </>
        )}
      </p>

      {problems.length > 0 && (
        <div class="import-problems" role="alert">
          <ul>
            {problems.map((p, i) => (
              <li key={i}>
                <strong>{p.name}:</strong> {p.error}
              </li>
            ))}
          </ul>
          <button type="button" class="btn btn-quiet" onClick={() => setProblems([])}>
            Dismiss
          </button>
        </div>
      )}

      {patterns.map((pattern, index) => (
        <PatternCard
          key={pattern.id}
          pattern={pattern}
          onChange={(patch) => changePattern(pattern.id, patch)}
          onConvertRadians={() =>
            changePattern(pattern.id, {
              twoTheta: radiansToDegrees(pattern.twoTheta),
              notes: [
                ...pattern.notes,
                { level: 'info', text: '2θ was converted from radians to degrees.' },
              ],
            })
          }
          onRemove={() => remove(index)}
        />
      ))}

      {patterns.length > 0 && (
        <XrdPlot
          patterns={patterns}
          settings={data.plot}
          onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
        />
      )}
    </div>
  );
}
