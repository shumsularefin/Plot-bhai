import { useMemo, useRef, useState } from 'preact/hooks';
import { cleanRun, DEFAULT_CLEAN, type CleanSettings } from '../../core/thermal/process';
import { HelpTip } from '../../ui/HelpTip';
import type { StepContext } from '../../ui/wizard/types';
import { NumberInput } from '../xrd/NumberInput';
import { StepSection } from '../xrd/StepSection';
import { mappingProblem, useCleaned } from './analysis';
import type { ThermalData } from './data';
import { ThermalPlot } from './ThermalPlot';
import { loadTable, MappingForm } from './UploadStep';

const UNDO_LIMIT = 50;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Wizard step 2: cut the heating ramp, optional blank subtraction, smoothing, normalisation. */
export function CleanStep({ data, update }: StepContext<ThermalData>) {
  const { run, blank, cleaned } = useCleaned(data);
  const settings = data.clean;
  const history = useRef<CleanSettings[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [blankProblem, setBlankProblem] = useState<string | null>(null);
  const blankInput = useRef<HTMLInputElement>(null);

  const before = useMemo(
    () => (run ? cleanRun(run, null, data.info, DEFAULT_CLEAN) : null),
    [run, data.info],
  );

  if (!run) return <p>No run is loaded. Go back to Upload to add one.</p>;

  const setSettings = (next: CleanSettings) => {
    history.current = [...history.current, settings].slice(-UNDO_LIMIT);
    setCanUndo(true);
    update({ clean: next });
  };
  const patch = (value: Partial<CleanSettings>) => setSettings({ ...settings, ...value });
  const undo = () => {
    const last = history.current[history.current.length - 1];
    if (!last) return;
    history.current = history.current.slice(0, -1);
    setCanUndo(history.current.length > 0);
    update({ clean: last });
  };

  const curve = cleaned?.ok ? cleaned.curve : null;
  const original = before?.ok ? before.curve : null;
  // Mass is shown in % so "before" and "after" share an axis; mg appears in the table later.
  const curves = [
    ...(original
      ? [
          {
            id: 'before',
            name: 'Before cleaning',
            temperatureC: original.temperatureC,
            mass: original.massPct,
            dashed: true,
            colorIndex: 1,
          },
        ]
      : []),
    ...(curve
      ? [
          {
            id: 'after',
            name: 'After cleaning',
            temperatureC: curve.temperatureC,
            mass: curve.massPct,
            colorIndex: 0,
          },
        ]
      : []),
  ];

  const loadBlank = async (list: FileList | null) => {
    const picked = list?.[0];
    if (!picked) return;
    const result = await loadTable(picked);
    if (typeof result === 'string') {
      setBlankProblem(`${picked.name}: ${result}`);
      return;
    }
    setBlankProblem(null);
    update({ blank: result });
    patch({ useBlank: true });
  };
  const blankMapProblem = mappingProblem(data.blank);

  return (
    <div class="clean-step">
      <div class="clean-toolbar">
        <div class="clean-actions">
          <button type="button" class="btn" onClick={undo} disabled={!canUndo}>
            Undo
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => setSettings(DEFAULT_CLEAN)}
            disabled={same(settings, DEFAULT_CLEAN)}
          >
            Reset all steps
          </button>
        </div>
      </div>
      <p class="field-hint">
        Every step is optional and can be switched off again at any time. Your original file is
        never changed. Mass is shown in % of the{' '}
        {data.info.initialMassMg !== null ? 'initial mass you entered' : 'first mass value'}.
      </p>

      <StepSection
        id="ramp"
        title="Heating ramp"
        description={
          <>
            A thermal run is cut to its heating part: isothermal holds and the cooling after the
            highest temperature are removed automatically. Set a start and end temperature to keep
            only part of the ramp.{' '}
            <HelpTip term="heating ramp">
              <p>
                TGA analysis looks at mass against a steadily rising temperature. A hold at one
                temperature or the cooling afterwards would put the same temperature on the axis
                twice, so only the first pass up to the highest temperature is kept.
              </p>
            </HelpTip>
          </>
        }
        enabled={settings.fromC !== null || settings.toC !== null}
        onToggle={(on) =>
          patch(on ? { fromC: run.temperatureC[0] ?? 0 } : { fromC: null, toC: null })
        }
        onReset={() => patch({ fromC: null, toC: null })}
      >
        <div class="radiation-fields">
          <NumberInput
            label="From (°C)"
            value={settings.fromC}
            onChange={(v) => patch({ fromC: v })}
          />
          <NumberInput label="To (°C)" value={settings.toC} onChange={(v) => patch({ toC: v })} />
        </div>
      </StepSection>

      <StepSection
        id="blank"
        title="Blank (buoyancy) correction"
        description={
          <>
            Subtract a run of the empty crucible measured with the same program, which removes the
            apparent mass change caused by changing gas buoyancy.{' '}
            <HelpTip term="buoyancy">
              <p>
                As the furnace heats, the gas becomes thinner and pushes up on the sample holder
                less, so the balance shows a slow drift even for an inert sample. A blank run
                records that drift. The blank must be in the same mass unit as the sample (both mg).
              </p>
            </HelpTip>
          </>
        }
        enabled={settings.useBlank}
        onToggle={(on) => patch({ useBlank: on })}
        onReset={() => {
          patch({ useBlank: false });
          update({ blank: null });
        }}
      >
        <div class="upload-actions">
          <button type="button" class="btn" onClick={() => blankInput.current?.click()}>
            {data.blank ? 'Choose another blank file' : 'Choose the blank file'}
          </button>
          <input
            ref={blankInput}
            type="file"
            class="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void loadBlank(e.currentTarget.files);
              e.currentTarget.value = '';
            }}
          />
          {data.blank && <span>{data.blank.name}</span>}
        </div>
        {blankProblem && (
          <p class="message is-error" role="alert">
            {blankProblem}
          </p>
        )}
        {data.blank && (
          <MappingForm
            loaded={data.blank}
            onChange={(mapping) => data.blank && update({ blank: { ...data.blank, mapping } })}
          />
        )}
        {blankMapProblem && <p class="message is-error">{blankMapProblem}</p>}
        {!data.blank && <p class="field-hint">Choose a blank file to use this correction.</p>}
        {data.blank && !blank?.mass && (
          <p class="message is-warning">The blank needs a mass column.</p>
        )}
      </StepSection>

      <StepSection
        id="smooth"
        title="Smoothing"
        description="Averages the mass with a local polynomial over a temperature window. Use as little as possible: it rounds off the steps. The DTG curve in the next step is smoothed separately."
        enabled={settings.smoothWindowC > 0}
        onToggle={(on) => patch({ smoothWindowC: on ? 5 : 0 })}
        onReset={() => patch({ smoothWindowC: 0 })}
      >
        <NumberInput
          label="Window (°C)"
          value={settings.smoothWindowC}
          min={0}
          onChange={(v) => patch({ smoothWindowC: v ?? 0 })}
        />
      </StepSection>

      <StepSection
        id="normalise"
        title="Normalise to a start temperature"
        description={
          <>
            Sets 100 % to the mass at a temperature you choose, for example after the sample has
            dried at 120 °C, so later losses are relative to the dry mass.{' '}
            <HelpTip term="normalising the mass">
              <p>
                Without this, 100 % is the mass at the start of the run. Normalising at, say, 150 °C
                ignores moisture lost before that temperature. Losses and the residue are then a
                percentage of the mass at that temperature.
              </p>
            </HelpTip>
          </>
        }
        enabled={settings.normaliseAtC !== null}
        onToggle={(on) =>
          patch({ normaliseAtC: on ? Math.round((run.temperatureC[0] ?? 25) + 100) : null })
        }
        onReset={() => patch({ normaliseAtC: null })}
      >
        <NumberInput
          label="Temperature (°C)"
          value={settings.normaliseAtC}
          onChange={(v) => patch({ normaliseAtC: v })}
        />
      </StepSection>

      {cleaned && !cleaned.ok && (
        <p class="message is-error" role="alert">
          <strong>Problem:</strong> {cleaned.error}
        </p>
      )}
      {curve && curve.notes.length > 0 && (
        <ul class="pattern-messages">
          {curve.notes.map((n, i) => (
            <li key={i} class={`message is-${n.level}`}>
              {n.text}
            </li>
          ))}
        </ul>
      )}

      {curves.length > 0 && (
        <ThermalPlot
          curves={curves}
          massUnit="%"
          settings={data.plot}
          onSettingsChange={(p) => update({ plot: { ...data.plot, ...p } })}
          exportName={`${run.name}-cleaned`}
        />
      )}
    </div>
  );
}
