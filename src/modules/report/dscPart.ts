import { displayExoUp, type DscCurve } from '../../core/thermal/dscClean';
import { DSC_NO_CERTAINTY_NOTE } from '../../core/thermal/dscGuidance';
import type { ReportPart } from '../../ui/report/sampleReport';
import type { DscView } from '../thermal/dsc/analysis';
import type { CombinedResult } from '../thermal/dsc/combinedAnalysis';
import type { DscData } from '../thermal/dsc/data';
import { num } from '../thermal/dsc/EventsStep';
import { dscMethodsText } from '../thermal/dsc/methodsText';

/**
 * The DSC part of the sample report: the same numbers as the DSC results step, with the heat flow
 * sign convention stated. Interpretations are the user's own; DSC alone does not identify events.
 */
export function dscPart(
  data: DscData,
  curve: DscCurve,
  view: DscView,
  combined: CombinedResult,
): ReportPart {
  const exoUp = displayExoUp(data.setup);
  const hu = curve.specific ? 'J/g' : 'mJ';
  const label = (id: number) => data.assignments[id]?.label || 'not assigned';
  const results = [
    {
      title: `Events, ${curve.segment.label.toLowerCase()} (exo ${exoUp ? 'up' : 'down'} on plots; ΔH endothermic positive; interpretations are yours)`,
      lines: view.events.length
        ? view.events.map(
            (e) =>
              `Event ${e.id}, ${e.direction === 'endo' ? 'endothermic' : 'exothermic'}: onset ${num(e.onsetC)} °C, peak ${num(e.peakC)} °C, endset ${num(e.endsetC)} °C, ΔH ${num(e.enthalpy, 2)} ${hu}, interpretation: ${label(e.id)}`,
          )
        : ['No events were found.'],
    },
  ];
  const g = view.glass?.ok ? view.glass.glass : null;
  if (g)
    results.push({
      title: 'Glass transition',
      lines: [
        `Tg (midpoint) ${num(g.midpointC)} °C, onset ${num(g.onsetC)} °C, endset ${num(g.endsetC)} °C, ΔCp ${num(g.deltaCp, 3)} J/(g·K)`,
      ],
    });
  const cryst = view.crystallinity;
  if (cryst.result?.ok && cryst.melting)
    results.push({
      title: 'Crystallinity (an estimate)',
      lines: [
        `Xc ≈ ${num(cryst.result.percent, 1)} % from event ${cryst.melting.id}${cryst.cold ? ` minus event ${cryst.cold.id}` : ''}, ΔH0 = ${data.crystallinity.fullyCrystallineJPerG} J/g (entered by the user)`,
      ],
    });
  results.push({ title: 'Note', lines: [DSC_NO_CERTAINTY_NOTE] });
  return {
    tool: 'Thermal analysis (DSC)',
    data: [data.file?.name ?? 'run'],
    example: data.file?.synthetic === true,
    results,
    methods: dscMethodsText(data, curve, view, combined),
  };
}
