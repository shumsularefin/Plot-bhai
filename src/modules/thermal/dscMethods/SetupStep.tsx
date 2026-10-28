import { useMemo } from 'preact/hooks';
import { HelpTip } from '../../../ui/HelpTip';
import { PlotPanel } from '../../../ui/plot/PlotPanel';
import type { SeriesSource } from '../../../ui/plot/series';
import type { PlotBand } from '../../../ui/plot/types';
import type { StepContext } from '../../../ui/wizard/types';
import { NumberInput } from '../../xrd/NumberInput';
import { isothermOf, rampOf } from './analysis';
import { ROLE_LABELS, ROLES, type DscMethodsData } from './data';

/** DSC methods step 2: the range or times each method needs, on a plot of the loaded runs. */
export function DscMethodsSetupStep({ data, update }: StepContext<DscMethodsData>) {
  const oit = data.method === 'oit';
  const sources = useMemo<SeriesSource[]>(() => {
    if (oit) {
      const iso = isothermOf(data.files.sample, data.exoUp);
      return iso
        ? [{ id: 'sample', name: 'Sample', x: iso.timeMin, y: iso.exo, unit: data.heatFlowUnit }]
        : [];
    }
    return ROLES[data.method].flatMap((role, i) => {
      const ramp = rampOf(data.files[role], data.exoUp);
      return ramp
        ? [
            {
              id: role,
              name: ROLE_LABELS[role],
              x: ramp.temperatureC,
              y: ramp.heatFlow,
              unit: data.heatFlowUnit,
              colorIndex: i,
            },
          ]
        : [];
    });
  }, [data.files, data.exoUp, data.method, data.heatFlowUnit, oit]);

  const bands: PlotBand[] = [];
  if (data.method === 'cp' && data.cp.fromC !== null && data.cp.toC !== null) {
    bands.push({ fromX: data.cp.fromC, toX: data.cp.toC, label: 'Cp range' });
  }
  if (data.method === 'purity' && data.purity.fromC !== null && data.purity.toC !== null) {
    bands.push({ fromX: data.purity.fromC, toX: data.purity.toC, label: 'Melting peak' });
  }
  if (oit && data.oit.baselineFromMin !== null && data.oit.baselineToMin !== null) {
    bands.push({ fromX: data.oit.baselineFromMin, toX: data.oit.baselineToMin, label: 'Baseline' });
  }
  const setCp = (patch: Partial<DscMethodsData['cp']>) => update({ cp: { ...data.cp, ...patch } });
  const setPurity = (patch: Partial<DscMethodsData['purity']>) =>
    update({ purity: { ...data.purity, ...patch } });
  const setOit = (patch: Partial<DscMethodsData['oit']>) =>
    update({ oit: { ...data.oit, ...patch } });

  return (
    <div class="clean-step">
      {data.method === 'cp' && (
        <div class="radiation-fields">
          <NumberInput
            label="Cp from (°C)"
            value={data.cp.fromC}
            onChange={(fromC) => setCp({ fromC })}
          />
          <NumberInput label="to (°C)" value={data.cp.toC} onChange={(toC) => setCp({ toC })} />
          <NumberInput
            label="Every (°C)"
            value={data.cp.stepC}
            min={0}
            onChange={(v) => v !== null && setCp({ stepC: v })}
          />
          <p class="field-hint">
            Empty limits use the whole range the runs share. Leave out the first minutes of each
            run, where the heat flow has not yet settled after the start of heating.
          </p>
        </div>
      )}
      {data.method === 'purity' && (
        <div class="radiation-fields">
          <NumberInput
            label="Molar mass of the substance (g/mol)"
            value={data.purity.molarMass}
            min={0}
            onChange={(molarMass) => setPurity({ molarMass })}
          />
          <NumberInput
            label="Peak from (°C)"
            value={data.purity.fromC}
            onChange={(fromC) => setPurity({ fromC })}
          />
          <NumberInput
            label="to (°C)"
            value={data.purity.toC}
            onChange={(toC) => setPurity({ toC })}
          />
          <NumberInput
            label="Fraction melted from"
            value={data.purity.fMin}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => v !== null && setPurity({ fMin: v })}
            help={
              <HelpTip term="fraction melted">
                <p>
                  F at a temperature is the part of the peak area up to that temperature. Only the
                  points between these two fractions go into the straight-line fit of temperature
                  against 1/F. 0.1 to 0.5 is a common choice.
                </p>
              </HelpTip>
            }
          />
          <NumberInput
            label="Fraction melted to"
            value={data.purity.fMax}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => v !== null && setPurity({ fMax: v })}
          />
          <p class="field-hint">
            Set the limits on the flat baseline on both sides of the peak. Empty limits use the
            whole file.
          </p>
        </div>
      )}
      {oit && (
        <div class="radiation-fields">
          <NumberInput
            label="Gas switch at (min)"
            value={data.oit.switchMin}
            min={0}
            onChange={(switchMin) => setOit({ switchMin })}
          />
          <NumberInput
            label="Baseline from (min)"
            value={data.oit.baselineFromMin}
            min={0}
            onChange={(baselineFromMin) => setOit({ baselineFromMin })}
          />
          <NumberInput
            label="Baseline to (min)"
            value={data.oit.baselineToMin}
            min={0}
            onChange={(baselineToMin) => setOit({ baselineToMin })}
          />
          <p class="field-hint">
            Empty baseline limits use the flat part from the switch to halfway to the steepest rise.
            The plot shows the heat flow with exothermic up.
          </p>
        </div>
      )}
      <PlotPanel
        sources={sources}
        settings={data.plot}
        onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
        labels={() =>
          oit
            ? { x: 'Time (min)', y: `Heat flow (${data.heatFlowUnit}), exo up` }
            : { x: 'Temperature (°C)', y: `Heat flow (${data.heatFlowUnit}), endo up` }
        }
        xName={oit ? 't' : 'T'}
        xUnit={oit ? ' min' : ' °C'}
        exportName={`dsc-${data.method}-runs`}
        showOverlayOptions={false}
        bands={bands}
      />
    </div>
  );
}
