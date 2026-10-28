import { useRef, useState } from 'preact/hooks';
import { HelpTip } from '../../../ui/HelpTip';
import type { StepContext } from '../../../ui/wizard/types';
import { NumberInput } from '../../xrd/NumberInput';
import { loadTable, MappingForm } from '../UploadStep';
import { fileProblem } from './analysis';
import {
  initialDscMethodsData,
  METHOD_LABELS,
  ROLE_LABELS,
  ROLES,
  type DscMethod,
  type DscMethodsData,
  type FileRole,
} from './data';
import {
  EXAMPLE_CP,
  EXAMPLE_OIT,
  EXAMPLE_PURITY,
  exampleCpRuns,
  exampleOitRun,
  examplePurityRun,
} from './example';

const METHOD_HELP: Record<DscMethod, string> = {
  cp: 'Three runs with the same pans, purge gas and heating rate: an empty pan (blank), a sapphire disc, and the sample. The specific heat capacity follows from how far each curve lies from the blank.',
  purity:
    'One slow heating run through the melting peak of a nearly pure crystalline substance. The shape of the peak gives the impurity content (van ’t Hoff). Not for polymers, or for substances that decompose while melting.',
  oit: 'One isothermal run with a time column: the sample is held hot under nitrogen, then the gas is switched to oxygen or air. The OIT is the time until oxidation starts.',
};

/** The example runs of each method, with the settings that go with them. */
function exampleFor(method: DscMethod): Partial<DscMethodsData> {
  if (method === 'cp') {
    return {
      files: exampleCpRuns(),
      exoUp: false,
      heatFlowUnit: 'mW',
      sapphireMassMg: EXAMPLE_CP.sapphireMg,
      sampleMassMg: EXAMPLE_CP.sampleMg,
      rateKPerMin: EXAMPLE_CP.rateKPerMin,
      cp: { fromC: 50, toC: 250, stepC: 10 },
    };
  }
  if (method === 'purity') {
    return {
      files: { sample: examplePurityRun() },
      exoUp: false,
      heatFlowUnit: 'W/g',
      rateKPerMin: EXAMPLE_PURITY.rateKPerMin,
      purity: { ...initialDscMethodsData.purity, molarMass: EXAMPLE_PURITY.molarMass },
    };
  }
  return {
    files: { sample: exampleOitRun() },
    exoUp: false,
    heatFlowUnit: 'mW',
    oit: { ...initialDscMethodsData.oit, switchMin: EXAMPLE_OIT.switchMin },
  };
}

/** DSC methods step 1: the method, its files, the sign convention and the masses. */
export function DscMethodsUploadStep({ data, update }: StepContext<DscMethodsData>) {
  const [problem, setProblem] = useState<string | null>(null);
  const inputs = useRef<Partial<Record<FileRole, HTMLInputElement | null>>>({});
  const roles = ROLES[data.method];

  const load = async (role: FileRole, list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    const result = await loadTable(file);
    if (typeof result === 'string') setProblem(`${file.name}: ${result}`);
    else {
      setProblem(null);
      update({ files: { ...data.files, [role]: result } });
    }
  };
  const setMethod = (method: DscMethod) =>
    update({ ...initialDscMethodsData, method, plot: data.plot });

  return (
    <div class="upload-step thermal-upload">
      <fieldset class="method-choice">
        <legend>Method</legend>
        {(Object.keys(METHOD_LABELS) as DscMethod[]).map((m) => (
          <label key={m} class="check">
            <input
              type="radio"
              name="dsc-method"
              checked={data.method === m}
              onChange={() => setMethod(m)}
            />
            {METHOD_LABELS[m]}
          </label>
        ))}
      </fieldset>
      <p class="field-hint">{METHOD_HELP[data.method]}</p>
      <div class="upload-actions">
        <button
          type="button"
          class="btn"
          onClick={() => {
            setProblem(null);
            update({ ...initialDscMethodsData, method: data.method, ...exampleFor(data.method) });
          }}
        >
          Try with example data
        </button>
        <span class="field-hint">
          Loads synthetic runs with a known answer. Not a real measurement.
        </span>
      </div>
      {problem && (
        <div class="import-problems" role="alert">
          <p>{problem}</p>
          <button type="button" class="btn btn-quiet" onClick={() => setProblem(null)}>
            Dismiss
          </button>
        </div>
      )}

      <ul class="kinetic-runs">
        {roles.map((role) => {
          const file = data.files[role];
          const problemOfFile = file ? fileProblem(data.method, file) : null;
          return (
            <li key={role} class="process-step is-on">
              <h3 class="process-step-title">{ROLE_LABELS[role]}</h3>
              <div class="run-form">
                <button
                  type="button"
                  class="btn btn-primary"
                  onClick={() => inputs.current[role]?.click()}
                >
                  {file ? 'Replace the file' : 'Choose a file'}
                  <span class="visually-hidden"> for the {ROLE_LABELS[role].toLowerCase()}</span>
                </button>
                <input
                  ref={(el) => {
                    inputs.current[role] = el;
                  }}
                  type="file"
                  class="visually-hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    void load(role, e.currentTarget.files);
                    e.currentTarget.value = '';
                  }}
                />
                <span>{file ? file.name : 'No file yet.'}</span>
              </div>
              {file && (
                <details>
                  <summary>Columns of {file.name}</summary>
                  <MappingForm
                    loaded={file}
                    onChange={(mapping) =>
                      update({ files: { ...data.files, [role]: { ...file, mapping } } })
                    }
                  />
                </details>
              )}
              {problemOfFile && (
                <p class="message is-error">
                  <strong>Problem:</strong> {problemOfFile}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <fieldset class="exo-choice">
        <legend>
          Which way do exothermic peaks point in your files?{' '}
          <HelpTip term="exo up or down">
            <p>
              Some instruments plot heat released by the sample (exothermic: oxidation,
              crystallisation) upwards, others downwards. The file does not say which, so you tell
              the site. Melting absorbs heat (endothermic).
            </p>
          </HelpTip>
        </legend>
        <label class="radio-field">
          <input
            type="radio"
            name="dsc-methods-exo"
            checked={data.exoUp}
            onChange={() => update({ exoUp: true })}
          />
          Exo up (heat released is positive)
        </label>
        <label class="radio-field">
          <input
            type="radio"
            name="dsc-methods-exo"
            checked={!data.exoUp}
            onChange={() => update({ exoUp: false })}
          />
          Exo down (heat absorbed is positive)
        </label>
      </fieldset>

      <div class="radiation-fields">
        {data.method !== 'oit' && (
          <label class="inline-field">
            Heat flow unit in the files
            <select
              value={data.heatFlowUnit}
              onChange={(e) =>
                update({ heatFlowUnit: e.currentTarget.value as DscMethodsData['heatFlowUnit'] })
              }
            >
              <option value="mW">mW</option>
              <option value="W/g">W/g (already divided by the mass)</option>
            </select>
          </label>
        )}
        {data.method === 'cp' && (
          <NumberInput
            label="Sapphire mass (mg)"
            value={data.sapphireMassMg}
            min={0}
            onChange={(sapphireMassMg) => update({ sapphireMassMg })}
          />
        )}
        {(data.method === 'cp' || (data.method === 'purity' && data.heatFlowUnit === 'mW')) && (
          <NumberInput
            label="Sample mass (mg)"
            value={data.sampleMassMg}
            min={0}
            onChange={(sampleMassMg) => update({ sampleMassMg })}
          />
        )}
        {data.method === 'purity' && (
          <NumberInput
            label="Heating rate (K/min)"
            value={data.rateKPerMin}
            min={0}
            onChange={(rateKPerMin) => update({ rateKPerMin })}
          />
        )}
      </div>
    </div>
  );
}
