import { useMemo, useRef, useState } from 'preact/hooks';
import { guessMapping } from '../../../core/thermal/import';
import {
  EXAMPLE_DSC_MASS_MG,
  EXAMPLE_DSC_RATE,
  exampleDscTable,
} from '../../../core/thermal/synthetic';
import type { Atmosphere, RunInfo, SampleCategory } from '../../../core/thermal/types';
import type { HeatFlowUnit } from '../../../core/thermal/dscClean';
import { formatNumber } from '../../../core/xrd/parsers/numbers';
import { HelpTip } from '../../../ui/HelpTip';
import type { StepContext } from '../../../ui/wizard/types';
import { NumberInput } from '../../xrd/NumberInput';
import { mappingProblem, runOf } from '../analysis';
import { ColumnSelect, loadTable, TablePreview } from '../UploadStep';
import type { DscData } from './data';

const ATMOSPHERES: Record<Atmosphere, string> = {
  nitrogen: 'Nitrogen',
  argon: 'Argon',
  air: 'Air',
  oxygen: 'Oxygen',
  other: 'Other gas',
};

const CATEGORIES: Record<SampleCategory, string> = {
  unspecified: 'Not specified',
  'hydroxide-or-salt': 'Metal hydroxide or salt precursor',
  polymer: 'Polymer',
  biomass: 'Biomass or plant extract',
  composite: 'Composite',
  other: 'Other',
};

const UNITS: Record<HeatFlowUnit, string> = {
  mW: 'mW (not yet divided by the mass)',
  'mW/mg': 'mW/mg',
  'W/g': 'W/g',
};

/** Why step 1 cannot continue, else null. */
export function dscUploadProblem(data: DscData): string | null {
  const { file, setup } = data;
  if (!file) return 'Load a run to continue. "Try with example data" loads a synthetic one.';
  const problem = mappingProblem(file);
  if (problem) return problem;
  if (file.mapping.heatFlow === null) return 'Choose the heat flow column in the column settings.';
  if (setup.fileExoUp === null) {
    return 'Say whether exothermic peaks point up or down in your file. Every result depends on it.';
  }
  return null;
}

/** DSC wizard step 1: load a text export, say what the heat flow column means, describe the run. */
export function DscUploadStep({ data, update }: StepContext<DscData>) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { file, info, setup } = data;
  const run = useMemo(() => runOf(file), [file]);
  const mapProblem = mappingProblem(file);

  const load = async (list: FileList | null) => {
    const picked = list?.[0];
    if (!picked) return;
    setBusy(true);
    const result = await loadTable(picked);
    setBusy(false);
    if (typeof result === 'string') {
      setProblem(`${picked.name}: ${result}`);
      return;
    }
    setProblem(null);
    update({ file: result, limits: null, glassWindows: null, assignments: {} });
  };

  const loadExample = () => {
    setProblem(null);
    const table = exampleDscTable();
    update({
      file: {
        name: 'Example DSC (synthetic)',
        table,
        mapping: guessMapping(table),
        synthetic: true,
      },
      setup: { unit: 'mW', fileExoUp: true, displayExoUp: null },
      info: {
        ...info,
        atmosphere: 'nitrogen',
        heatingRate: EXAMPLE_DSC_RATE,
        initialMassMg: EXAMPLE_DSC_MASS_MG,
        sample: 'Synthetic example (not a real sample)',
        category: 'polymer',
      },
      clean: { ...data.clean, segmentId: null },
      limits: null,
      glassWindows: null,
      assignments: {},
    });
  };

  const setInfo = (patch: Partial<RunInfo>) => update({ info: { ...info, ...patch } });
  const names = file?.table.names ?? [];

  return (
    <div class="upload-step thermal-upload">
      <p>
        Load a DSC run as a text or csv file with temperature and heat flow columns. A heat, cool,
        heat program in one file is fine: the next step lets you choose the ramp. If your software
        only saves a binary format, export the run as text or csv first.
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
          void load(e.dataTransfer?.files ?? null);
        }}
      >
        <p class="drop-zone-title">Drag and drop a file here</p>
        <p class="field-hint">
          .csv, .txt or .xy. Header lines, tab, semicolon or comma separators and decimal commas are
          handled. Files stay on your device.
        </p>
        <button type="button" class="btn btn-primary" onClick={() => fileInput.current?.click()}>
          Choose a file
        </button>
        <input
          ref={fileInput}
          type="file"
          class="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void load(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </div>
      <div class="upload-actions">
        <button type="button" class="btn" onClick={loadExample}>
          Try with example data
        </button>
        <span class="field-hint">
          Loads a synthetic heat, cool, heat run with made-up events. It is not a real measurement.
        </span>
      </div>
      <p class="upload-status" role="status">
        {busy ? 'Reading the file…' : ''}
      </p>
      {problem && (
        <div class="import-problems" role="alert">
          <p>{problem}</p>
          <button type="button" class="btn btn-quiet" onClick={() => setProblem(null)}>
            Dismiss
          </button>
        </div>
      )}

      {file && (
        <section class="process-step is-on" aria-labelledby="dsc-columns-title">
          <h3 id="dsc-columns-title" class="process-step-title">
            Columns in {file.name}
          </h3>
          <p class="process-step-description">
            The site guessed which column is which from the header. Check each choice.
          </p>
          <div class="mapping-form">
            <div class="mapping-row">
              <ColumnSelect
                label="Temperature column"
                names={names}
                value={file.mapping.temperature}
                onChange={(v) =>
                  update({ file: { ...file, mapping: { ...file.mapping, temperature: v ?? 0 } } })
                }
              />
              <label class="inline-field">
                Unit
                <select
                  value={file.mapping.temperatureUnit}
                  onChange={(e) =>
                    update({
                      file: {
                        ...file,
                        mapping: {
                          ...file.mapping,
                          temperatureUnit: e.currentTarget.value as 'C' | 'K',
                        },
                      },
                    })
                  }
                >
                  <option value="C">°C</option>
                  <option value="K">K</option>
                </select>
              </label>
            </div>
            <div class="mapping-row">
              <ColumnSelect
                label="Heat flow column"
                names={names}
                value={file.mapping.heatFlow}
                optional
                onChange={(v) =>
                  update({ file: { ...file, mapping: { ...file.mapping, heatFlow: v } } })
                }
              />
              <label class="inline-field">
                Heat flow unit
                <select
                  value={setup.unit}
                  onChange={(e) =>
                    update({ setup: { ...setup, unit: e.currentTarget.value as HeatFlowUnit } })
                  }
                >
                  {Object.entries(UNITS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div class="mapping-row">
              <ColumnSelect
                label="Time column (optional, gives the scan rate)"
                names={names}
                value={file.mapping.time}
                optional
                onChange={(v) =>
                  update({ file: { ...file, mapping: { ...file.mapping, time: v } } })
                }
              />
              <label class="inline-field">
                Unit
                <select
                  value={file.mapping.timeUnit}
                  onChange={(e) =>
                    update({
                      file: {
                        ...file,
                        mapping: {
                          ...file.mapping,
                          timeUnit: e.currentTarget.value as 'min' | 's',
                        },
                      },
                    })
                  }
                >
                  <option value="min">minutes</option>
                  <option value="s">seconds</option>
                </select>
              </label>
            </div>
          </div>
          <fieldset class="exo-choice">
            <legend>
              Which way do exothermic peaks point in your file?{' '}
              <HelpTip term="exo up or down">
                <p>
                  Some instruments plot heat released by the sample (exothermic: crystallisation,
                  oxidation) upwards, others downwards. The file does not say which, so you tell the
                  site. It is used to read the sign of every peak correctly. If unsure, look at a
                  known melting peak: melting absorbs heat (endothermic).
                </p>
              </HelpTip>
            </legend>
            <label class="radio-field">
              <input
                type="radio"
                name="file-exo"
                checked={setup.fileExoUp === true}
                onChange={() => update({ setup: { ...setup, fileExoUp: true } })}
              />
              Exo up (heat released is positive)
            </label>
            <label class="radio-field">
              <input
                type="radio"
                name="file-exo"
                checked={setup.fileExoUp === false}
                onChange={() => update({ setup: { ...setup, fileExoUp: false } })}
              />
              Exo down (heat absorbed is positive)
            </label>
          </fieldset>
          {mapProblem && (
            <p class="message is-error" role="alert">
              <strong>Problem:</strong> {mapProblem}
            </p>
          )}
          {run && run.notes.length > 0 && (
            <ul class="pattern-messages">
              {run.notes.map((n, i) => (
                <li key={i} class={`message is-${n.level}`}>
                  {n.text}
                </li>
              ))}
            </ul>
          )}
          <TablePreview table={file.table} />
        </section>
      )}

      {file && (
        <section class="process-step is-on" aria-labelledby="dsc-run-title">
          <h3 id="dsc-run-title" class="process-step-title">
            Describe the run
          </h3>
          <p class="process-step-description">
            These details are stored with the analysis. The sample mass is needed to give heat flow
            per gram, enthalpies in J/g and the heat capacity change; the scan rate is needed for
            every enthalpy.
          </p>
          <div class="run-form">
            <NumberInput
              label="Sample mass (mg)"
              value={info.initialMassMg}
              min={0}
              onChange={(v) => setInfo({ initialMassMg: v })}
              help={
                <HelpTip term="sample mass">
                  <p>
                    The mass of the sample in the pan. A heat flow in mW is divided by it to give
                    W/g, so runs of different size can be compared. Not needed if the file is
                    already per mg or per g.
                  </p>
                </HelpTip>
              }
            />
            <NumberInput
              label="Scan rate (K/min)"
              value={info.heatingRate}
              min={0}
              onChange={(v) => setInfo({ heatingRate: v })}
              help={
                <HelpTip term="scan rate">
                  <p>
                    How fast the temperature changes, in kelvin (the same size as °C) per minute.
                    Heat flow is energy per second, so the rate converts a peak area into joules per
                    gram. If left empty and the file has a time column, the rate is taken from it.
                  </p>
                </HelpTip>
              }
            />
            <label class="inline-field">
              Atmosphere
              <select
                value={info.atmosphere}
                onChange={(e) => setInfo({ atmosphere: e.currentTarget.value as Atmosphere })}
              >
                {Object.entries(ATMOSPHERES).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label class="inline-field">
              Sample description
              <input
                type="text"
                value={info.sample}
                placeholder="for example, PLA film, annealed 1 h"
                onInput={(e) => setInfo({ sample: e.currentTarget.value })}
              />
            </label>
            <label class="inline-field">
              Sample type (optional)
              <select
                value={info.category}
                onChange={(e) => setInfo({ category: e.currentTarget.value as SampleCategory })}
              >
                {Object.entries(CATEGORIES).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {run && (
            <p class="field-hint">
              {formatNumber(run.temperatureC.length, 0)} points,{' '}
              {formatNumber(
                run.temperatureC.reduce((a, b) => Math.min(a, b)),
                0,
              )}{' '}
              to{' '}
              {formatNumber(
                run.temperatureC.reduce((a, b) => Math.max(a, b)),
                0,
              )}{' '}
              °C.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
