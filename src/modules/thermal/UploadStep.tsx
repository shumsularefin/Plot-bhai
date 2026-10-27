import { useMemo, useRef, useState } from 'preact/hooks';
import { guessMapping, importThermalFile } from '../../core/thermal/import';
import { estimateHeatingRate, rampIndices } from '../../core/thermal/process';
import {
  EXAMPLE_HEATING_RATE,
  EXAMPLE_INITIAL_MASS_MG,
  exampleTgaTable,
} from '../../core/thermal/synthetic';
import type {
  Atmosphere,
  ColumnMapping,
  MassUnit,
  RunInfo,
  SampleCategory,
  TemperatureUnit,
  TimeUnit,
} from '../../core/thermal/types';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import { DataSources } from '../../ui/DataSources';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import { mappingProblem, runOf } from './analysis';
import type { LoadedTable, ThermalData } from './data';
import { ThermalPlot } from './ThermalPlot';

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

/** The most points a table preview shows. */
const PREVIEW_ROWS = 5;

/** Reads a table file for the sample or the blank; the message says why a file was refused. */
export async function loadTable(file: File): Promise<LoadedTable | string> {
  try {
    const result = importThermalFile(new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) return result.error;
    return {
      name: file.name,
      table: result.table,
      mapping: guessMapping(result.table),
      synthetic: false,
    };
  } catch {
    return 'Something went wrong while reading this file.';
  }
}

/** Dropdown of the table columns, with an optional "none" entry. */
export function ColumnSelect(props: {
  label: string;
  names: readonly string[];
  value: number | null;
  optional?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <label class="inline-field">
      {props.label}
      <select
        value={props.value === null ? '' : String(props.value)}
        onChange={(e) => {
          const text = e.currentTarget.value;
          props.onChange(text === '' ? null : Number(text));
        }}
      >
        {props.optional && <option value="">None</option>}
        {props.names.map((name, i) => (
          <option key={i} value={String(i)}>
            {i + 1}: {name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Column roles and units for one table. */
export function MappingForm(props: {
  loaded: LoadedTable;
  onChange: (mapping: ColumnMapping) => void;
}) {
  const { loaded, onChange } = props;
  const { mapping, table } = loaded;
  const set = (patch: Partial<ColumnMapping>) => onChange({ ...mapping, ...patch });
  return (
    <div class="mapping-form">
      <div class="mapping-row">
        <ColumnSelect
          label="Temperature column"
          names={table.names}
          value={mapping.temperature}
          onChange={(v) => set({ temperature: v ?? 0 })}
        />
        <label class="inline-field">
          Unit
          <select
            value={mapping.temperatureUnit}
            onChange={(e) => set({ temperatureUnit: e.currentTarget.value as TemperatureUnit })}
          >
            <option value="C">°C</option>
            <option value="K">K</option>
          </select>
        </label>
      </div>
      <div class="mapping-row">
        <ColumnSelect
          label="Mass column"
          names={table.names}
          value={mapping.mass}
          optional
          onChange={(v) => set({ mass: v })}
        />
        <label class="inline-field">
          Unit
          <select
            value={mapping.massUnit}
            onChange={(e) => set({ massUnit: e.currentTarget.value as MassUnit })}
          >
            <option value="mg">mg</option>
            <option value="percent">% of the starting mass</option>
          </select>
        </label>
      </div>
      <div class="mapping-row">
        <ColumnSelect
          label="Time column (optional)"
          names={table.names}
          value={mapping.time}
          optional
          onChange={(v) => set({ time: v })}
        />
        <label class="inline-field">
          Unit
          <select
            value={mapping.timeUnit}
            onChange={(e) => set({ timeUnit: e.currentTarget.value as TimeUnit })}
          >
            <option value="min">minutes</option>
            <option value="s">seconds</option>
          </select>
        </label>
      </div>
      <div class="mapping-row">
        <ColumnSelect
          label="Heat flow column (optional, for DSC)"
          names={table.names}
          value={mapping.heatFlow}
          optional
          onChange={(v) => set({ heatFlow: v })}
        />
      </div>
    </div>
  );
}

export function TablePreview({ table }: { table: LoadedTable['table'] }) {
  const rows = Math.min(PREVIEW_ROWS, table.columns[0]?.length ?? 0);
  return (
    <div class="table-scroll">
      <table class="peak-table">
        <caption class="visually-hidden">First rows of the file</caption>
        <thead>
          <tr>
            {table.names.map((name, i) => (
              <th key={i} scope="col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {table.columns.map((column, c) => (
                <td key={c}>{formatNumber(column[r] as number, 4)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p class="field-hint">
        {table.columns[0]?.length ?? 0} rows in total; the first {rows} are shown.
      </p>
    </div>
  );
}

/** Wizard step 1: load a text export, say which column is which, describe the run. */
export function UploadStep({ data, update }: StepContext<ThermalData>) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { file, info } = data;
  const run = useMemo(() => runOf(file), [file]);
  const mapProblem = mappingProblem(file);
  const rate = useMemo(() => (run ? estimateHeatingRate(run) : null), [run]);
  // The plot needs temperature to increase, so it shows the heating part of the run.
  const preview = useMemo(() => {
    if (!run?.mass) return null;
    const idx = rampIndices(run.temperatureC);
    return {
      temperatureC: Float64Array.from(idx, (i) => run.temperatureC[i] as number),
      mass: Float64Array.from(idx, (i) => run.mass?.[i] as number),
      cut: run.temperatureC.length - idx.length,
    };
  }, [run]);

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
    update({ file: result });
  };

  const loadExample = () => {
    setProblem(null);
    const table = exampleTgaTable();
    update({
      file: {
        name: 'Example TGA (synthetic)',
        table,
        mapping: guessMapping(table),
        synthetic: true,
      },
      info: {
        ...info,
        atmosphere: 'nitrogen',
        heatingRate: EXAMPLE_HEATING_RATE,
        initialMassMg: EXAMPLE_INITIAL_MASS_MG,
        sample: 'Synthetic example (not a real sample)',
        category: 'other',
      },
    });
  };

  const setInfo = (patch: Partial<RunInfo>) => update({ info: { ...info, ...patch } });

  return (
    <div class="upload-step thermal-upload">
      <p>
        Load a thermogravimetric (TGA) run as a text or csv file with temperature and mass columns.
        If your software only saves a binary format, export the run as text or csv from it first.
      </p>
      <DataSources imageHref="#/thermal/image">
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
            .csv, .txt or .xy with temperature and mass in columns. Header lines, tab, semicolon or
            comma separators and decimal commas are handled. Files stay on your device.
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
      </DataSources>
      <div class="upload-actions">
        <button type="button" class="btn" onClick={loadExample}>
          Try with example data
        </button>
        <span class="field-hint">
          Loads a synthetic run with made-up mass loss steps. It is not a real measurement.
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
        <section class="process-step is-on" aria-labelledby="columns-title">
          <h3 id="columns-title" class="process-step-title">
            Columns in {file.name}
          </h3>
          <p class="process-step-description">
            The site guessed which column is which from the header. Check each choice; the preview
            below the form shows the first rows.
          </p>
          <MappingForm
            loaded={file}
            onChange={(mapping) => update({ file: { ...file, mapping } })}
          />
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
        <section class="process-step is-on" aria-labelledby="run-title">
          <h3 id="run-title" class="process-step-title">
            Describe the run
          </h3>
          <p class="process-step-description">
            These details are stored with the analysis and printed in the results, so a reader can
            see how the sample was measured. All are optional, but the initial mass is needed to
            report mass losses in mg.
          </p>
          <div class="run-form">
            <label class="inline-field">
              <span>
                Atmosphere{' '}
                <HelpTip term="atmosphere">
                  <p>
                    The gas flowing over the sample. Nitrogen or argon (inert) show decomposition;
                    air or oxygen also allow oxidation and burning, which usually changes both the
                    temperatures and the steps.
                  </p>
                </HelpTip>
              </span>
              <select
                aria-label="Atmosphere"
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
            {info.atmosphere === 'other' && (
              <label class="inline-field">
                Name of the gas
                <input
                  type="text"
                  value={info.atmosphereOther}
                  onInput={(e) => setInfo({ atmosphereOther: e.currentTarget.value })}
                />
              </label>
            )}
            <NumberInput
              label="Heating rate (K/min)"
              value={info.heatingRate}
              min={0}
              onChange={(v) => setInfo({ heatingRate: v })}
              help={
                <HelpTip term="heating rate">
                  <p>
                    How fast the furnace temperature rises, in kelvin (the same size as °C) per
                    minute. Faster heating shifts every step to higher temperature, so papers always
                    report it.
                  </p>
                </HelpTip>
              }
            />
            {rate !== null && (
              <p class="field-hint rate-hint">
                The time and temperature columns give about {formatNumber(rate, 2)} K/min.{' '}
                {info.heatingRate !== rate && (
                  <button
                    type="button"
                    class="btn btn-quiet"
                    onClick={() => setInfo({ heatingRate: Number(rate.toFixed(2)) })}
                  >
                    Use this value
                  </button>
                )}
              </p>
            )}
            <NumberInput
              label="Initial sample mass (mg)"
              value={info.initialMassMg}
              min={0}
              onChange={(v) => setInfo({ initialMassMg: v })}
              help={
                <HelpTip term="initial mass">
                  <p>
                    The sample mass at the start of the run. If your file has mass in mg, this is
                    the 100 % reference; if not entered, the first mass value is used. If the file
                    already has mass in %, entering it lets the site also give mg.
                  </p>
                </HelpTip>
              }
            />
            <label class="inline-field">
              Sample description
              <input
                type="text"
                value={info.sample}
                placeholder="for example, Mg(OH)₂ powder, dried at 80 °C"
                onInput={(e) => setInfo({ sample: e.currentTarget.value })}
              />
            </label>
            <label class="inline-field">
              <span>
                Sample type (optional){' '}
                <HelpTip term="sample type">
                  <p>
                    Used later to rank which thermal events are most likely. Leave it as "Not
                    specified" if unsure; nothing is assumed from it.
                  </p>
                </HelpTip>
              </span>
              <select
                aria-label="Sample type"
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
        </section>
      )}

      {run && preview && (
        <section aria-labelledby="preview-title">
          <h3 id="preview-title" class="process-step-title">
            Preview of the run as recorded
          </h3>
          {preview.cut > 0 && (
            <p class="field-hint">
              Only the heating part is drawn; {preview.cut} points that repeat a temperature or come
              after the highest temperature are left out here and in the next step.
            </p>
          )}
          <ThermalPlot
            curves={[
              {
                id: 'raw',
                name: run.name,
                temperatureC: preview.temperatureC,
                mass: preview.mass,
              },
            ]}
            massUnit={run.massUnit === 'mg' ? 'mg' : '%'}
            settings={data.plot}
            onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
            exportName={`${run.name}-raw`}
          />
        </section>
      )}
    </div>
  );
}
