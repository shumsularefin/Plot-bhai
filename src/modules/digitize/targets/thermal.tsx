import { useState } from 'preact/hooks';
import { EXAMPLE_STEPS, syntheticMassPct } from '../../../core/thermal/synthetic';
import type { ColumnMapping, TemperatureUnit } from '../../../core/thermal/types';
import type { LoadedTable } from '../../thermal/data';
import { dscStore } from '../../thermal/dsc/dscStore';
import { saveTechnique } from '../../thermal/technique';
import { tgaStore } from '../../thermal/tgaStore';
import { curveName, digitizedNotes } from '../digitized';
import { DigitizeTool } from '../DigitizeTool';
import { drawFigure } from '../example';
import { SendButton } from '../SendButton';
import type { DigitizeTarget, SendProps } from '../target';

const example = () =>
  drawFigure({
    x: [25, 800],
    xTick: 100,
    xTitle: 'Temperature (°C)',
    y: [40, 105],
    yTick: 10,
    yLabelsTo: 100,
    curves: [{ f: (t) => syntheticMassPct(t, EXAMPLE_STEPS), color: '#000000' }],
    traced: { index: 0, rgb: [0, 0, 0], at: 300 },
    marks: { x: [100, 700], y: [50, 100] },
    description: `A generated figure, not from a real paper: a TGA curve with made-up mass loss steps of ${EXAMPLE_STEPS.map((s) => `${s.loss} %`).join(', ')}, fastest at ${EXAMPLE_STEPS.map((s) => s.peak).join(', ')} °C.`,
  });

type CurveKind = 'mass-percent' | 'mass-mg' | 'heat-flow';

const KINDS: { id: CurveKind; label: string }[] = [
  { id: 'mass-percent', label: 'TGA: mass in %' },
  { id: 'mass-mg', label: 'TGA: mass in mg' },
  { id: 'heat-flow', label: 'DSC: heat flow' },
];

function Send({ data, curve }: SendProps) {
  const [kind, setKind] = useState<CurveKind>('mass-percent');
  const [unit, setUnit] = useState<TemperatureUnit>('C');
  const dsc = kind === 'heat-flow';
  const add = async () => {
    const store = dsc ? dscStore : tgaStore;
    await store.ready;
    const current = store.get();
    if (
      current.data.file &&
      !window.confirm(
        `Replace ${current.data.file.name} in the ${dsc ? 'DSC' : 'TGA'} analysis with this curve?`,
      )
    )
      return 'Nothing was changed.';
    const name = dsc ? 'Heat flow (as in the figure)' : `Mass ${kind === 'mass-mg' ? 'mg' : '%'}`;
    const mapping: ColumnMapping = {
      temperature: 0,
      temperatureUnit: unit,
      mass: dsc ? null : 1,
      massUnit: kind === 'mass-mg' ? 'mg' : 'percent',
      time: null,
      timeUnit: 'min',
      heatFlow: dsc ? 1 : null,
    };
    const file: LoadedTable = {
      name: curveName(data),
      table: {
        names: [`Temperature ${unit === 'C' ? '°C' : 'K'}`, name],
        columns: [curve.x, curve.y],
        headerText: '',
        notes: digitizedNotes(curve, target.axes),
      },
      mapping,
      synthetic: data.image?.synthetic ?? false,
      digitized: true,
    };
    if (dsc)
      dscStore.set({
        ...dscStore.get(),
        step: 0,
        data: {
          ...dscStore.get().data,
          file,
          limits: null,
          glassWindows: null,
          assignments: {},
          stepAssignments: {},
        },
      });
    else tgaStore.set({ ...tgaStore.get(), step: 0, data: { ...tgaStore.get().data, file } });
    saveTechnique(dsc ? 'dsc' : 'tga');
    return null;
  };
  return (
    <>
      <fieldset class="method-choice">
        <legend>The curve is</legend>
        {KINDS.map((k) => (
          <label key={k.id} class="check">
            <input
              type="radio"
              name="thermal-kind"
              checked={kind === k.id}
              onChange={() => setKind(k.id)}
            />
            {k.label}
          </label>
        ))}
      </fieldset>
      <fieldset class="method-choice">
        <legend>Temperature in the figure is in</legend>
        <label class="check">
          <input
            type="radio"
            name="thermal-unit"
            checked={unit === 'C'}
            onChange={() => setUnit('C')}
          />
          °C
        </label>
        <label class="check">
          <input
            type="radio"
            name="thermal-unit"
            checked={unit === 'K'}
            onChange={() => setUnit('K')}
          />
          K
        </label>
      </fieldset>
      {dsc && (
        <p class="field-hint">
          In the DSC upload step, say which way exothermic points in the figure and the heat flow
          unit.
        </p>
      )}
      <SendButton
        label={`Add to my ${dsc ? 'DSC' : 'TGA'} analysis`}
        onSend={add}
        route={target.route}
      />
    </>
  );
}

const target: DigitizeTarget = {
  tool: 'TGA or DSC',
  route: '#/thermal',
  storeKey: 'thermal-image-session',
  imageKey: 'thermal-image-file',
  figure: 'a TGA or DSC curve plotted against temperature',
  axes: {
    x: 'temperature',
    y: 'mass or heat flow',
    xIncreasesRight: true,
    xShort: 'T',
    yShort: 'y',
    xUnit: '°',
    xCsv: 'temperature',
    xDigits: 1,
    yMayBeNegative: true,
  },
  labels: { x: 'Temperature', y: 'As in the figure' },
  example,
  Send,
};

export default function ThermalFromImage() {
  return <DigitizeTool target={target} />;
}
