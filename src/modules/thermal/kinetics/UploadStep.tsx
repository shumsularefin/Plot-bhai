import { useRef, useState } from 'preact/hooks';
import { rateWarnings } from '../../../core/thermal/kinetics';
import { estimateHeatingRate } from '../../../core/thermal/process';
import { formatNumber } from '../../../core/xrd/parsers/numbers';
import { HelpTip } from '../../../ui/HelpTip';
import type { StepContext } from '../../../ui/wizard/types';
import { NumberInput } from '../../xrd/NumberInput';
import { runOf } from '../analysis';
import { loadTable, MappingForm } from '../UploadStep';
import type { KineticRun, KineticsData } from './data';
import { EXAMPLE_RATES, exampleKineticRun } from './example';

/** Kinetics wizard step 1: load runs of one sample at different heating rates. */
export function KineticsUploadStep({ data, update }: StepContext<KineticsData>) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { runs } = data;

  const load = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    let nextId = data.nextId;
    const added: KineticRun[] = [];
    const problems: string[] = [];
    for (const file of Array.from(list)) {
      const result = await loadTable(file);
      if (typeof result === 'string') problems.push(`${file.name}: ${result}`);
      else {
        const built = runOf(result);
        const rate = built ? estimateHeatingRate(built) : null;
        added.push({
          ...result,
          id: nextId++,
          rate: rate === null ? null : Number(rate.toFixed(2)),
        });
      }
    }
    setBusy(false);
    setProblem(problems.length > 0 ? problems.join(' ') : null);
    update({ runs: [...runs, ...added], nextId });
  };

  const loadExample = () => {
    setProblem(null);
    update({
      runs: EXAMPLE_RATES.map((rate, i) => ({ ...exampleKineticRun(rate), id: i + 1, rate })),
      nextId: EXAMPLE_RATES.length + 1,
      fromC: null,
      toC: null,
    });
  };

  const patchRun = (id: number, patch: Partial<KineticRun>) =>
    update({ runs: runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const rates = runs.flatMap((r) => (r.rate !== null && r.rate > 0 ? [r.rate] : []));
  const notes = runs.length >= 3 ? rateWarnings(rates) : [];

  return (
    <div class="upload-step thermal-upload">
      <p>
        Load three or more runs of the <strong>same sample</strong> measured at different heating
        rates (five is better, for example 2, 5, 10, 20 and 40 K/min). Each file is a text or csv
        export with temperature and mass columns (TGA) or temperature and heat flow (DSC).
      </p>
      <div class="upload-actions">
        <button type="button" class="btn btn-primary" onClick={() => fileInput.current?.click()}>
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
            void load(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
        <button type="button" class="btn" onClick={loadExample}>
          Try with example data
        </button>
        <span class="field-hint">
          Loads five synthetic runs of a made-up reaction with a known activation energy. Not a real
          measurement.
        </span>
      </div>
      <p class="upload-status" role="status">
        {busy ? 'Reading the files…' : ''}
      </p>
      {problem && (
        <div class="import-problems" role="alert">
          <p>{problem}</p>
          <button type="button" class="btn btn-quiet" onClick={() => setProblem(null)}>
            Dismiss
          </button>
        </div>
      )}

      {runs.length === 0 ? (
        <p class="field-hint">No runs loaded yet.</p>
      ) : (
        <ul class="kinetic-runs">
          {runs.map((r) => {
            const run = runOf(r);
            const estimate = run ? estimateHeatingRate(run) : null;
            return (
              <li key={r.id} class="process-step is-on">
                <h3 class="process-step-title">{r.name}</h3>
                <div class="run-form">
                  <NumberInput
                    label={`Heating rate of ${r.name} (K/min)`}
                    value={r.rate}
                    min={0}
                    onChange={(v) => patchRun(r.id, { rate: v })}
                    help={
                      <HelpTip term="heating rate">
                        <p>
                          How fast the furnace temperature rose in this run, in kelvin (the same
                          size as °C) per minute. Each run must have a different rate.
                        </p>
                      </HelpTip>
                    }
                  />
                  {estimate !== null && r.rate !== Number(estimate.toFixed(2)) && (
                    <button
                      type="button"
                      class="btn btn-quiet"
                      onClick={() => patchRun(r.id, { rate: Number(estimate.toFixed(2)) })}
                    >
                      Use {formatNumber(estimate, 2)} K/min from the time column
                    </button>
                  )}
                  <button
                    type="button"
                    class="btn btn-quiet"
                    onClick={() => update({ runs: runs.filter((x) => x.id !== r.id) })}
                  >
                    Remove<span class="visually-hidden"> {r.name}</span>
                  </button>
                </div>
                <details>
                  <summary>Columns of {r.name}</summary>
                  <MappingForm loaded={r} onChange={(mapping) => patchRun(r.id, { mapping })} />
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {notes.length > 0 && (
        <ul class="pattern-messages">
          {notes.map((n, i) => (
            <li key={i} class={`message is-${n.level}`}>
              {n.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
