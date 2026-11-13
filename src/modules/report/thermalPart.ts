import type { CalcinationSuggestion } from '../../core/thermal/calcination';
import type { StepResult } from '../../core/thermal/steps';
import { formatNumber } from '../../core/xrd/parsers/numbers';
import type { ReportPart } from '../../ui/report/sampleReport';
import { assignedLabel, type StepsView } from '../thermal/analysis';
import type { ThermalData } from '../thermal/data';
import { methodsText } from '../thermal/methodsText';

const num = (value: number | null, digits = 1) =>
  value === null || !Number.isFinite(value) ? '–' : formatNumber(value, digits);

/**
 * The thermal (TGA) part of the sample report: the same numbers as the tool's results table.
 * Events are the user's accepted interpretations; TGA alone cannot identify evolved species.
 */
export function thermalPart(
  data: ThermalData,
  view: StepsView,
  steps: readonly StepResult[],
  calcination: CalcinationSuggestion | null,
): ReportPart {
  const results = [
    {
      title: 'Mass loss steps (events are your interpretation)',
      lines: steps.length
        ? steps.map(
            (s) =>
              `Step ${s.id}: onset ${num(s.onsetC)} °C, DTG peak ${num(s.peakC)} °C, endset ${num(s.endsetC)} °C, mass loss ${num(s.lossPct, 2)} %, event: ${assignedLabel(data, s.id) || 'not assigned'}`,
          )
        : ['No steps were found.'],
    },
    {
      title: 'Thermal stability',
      lines: [
        `T5 ${num(view.t5)} °C, T10 ${num(view.t10)} °C, T50 ${num(view.t50)} °C (temperatures at 5, 10 and 50 % mass loss)`,
        ...(view.residuePct !== null
          ? [`Residue at ${num(data.steps.residueAtC, 0)} °C: ${num(view.residuePct, 2)} %`]
          : []),
      ],
    },
  ];
  if (calcination?.ok)
    results.push({
      title: 'Calcination (a starting point to confirm experimentally)',
      lines: [
        `Lowest temperature to try: ${num(calcination.minimumC, 0)} °C (endset of the last significant step plus the margin); candidates: ${calcination.candidatesC.map((t) => num(t, 0)).join(', ') || 'none inside the range'} °C. Confirm by XRD of samples calcined at a few temperatures.`,
      ],
    });
  return {
    tool: 'Thermal analysis (TGA)',
    data: [data.file?.name ?? 'run'],
    example: data.file?.synthetic === true,
    results,
    methods: methodsText(data, steps, calcination),
  };
}
