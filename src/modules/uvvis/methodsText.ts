import { SOFTWARE } from '../../ui/software';
import { uvvisMethodsParagraph, type UvvisMethodsInput } from '../../core/uvvis/methods';
import { DEFAULT_CLEANING } from '../../core/uvvis/process';
import { resultRows } from './analysis';
import type { UvvisData } from './data';

/** The settings that went into the analysis, read from the saved session. */
export function methodsInput(data: UvvisData): UvvisMethodsInput {
  const rows = resultRows(data);
  return {
    software: SOFTWARE,
    allSynthetic: data.spectra.length > 0 && data.spectra.every((s) => s.synthetic),
    spectra: rows.map(({ spectrum, choice, analysis }) => {
      const cleaning = data.cleaning[spectrum.id] ?? DEFAULT_CLEANING;
      return {
        name: spectrum.name,
        kind: spectrum.kind,
        cleaning: {
          blank: cleaning.blank.enabled && cleaning.blank.blankId !== null,
          offset: cleaning.offset.enabled
            ? { fromNm: cleaning.offset.fromNm, toNm: cleaning.offset.toNm }
            : null,
          smoothing: cleaning.smoothing.enabled
            ? { window: cleaning.smoothing.window, order: cleaning.smoothing.order }
            : null,
        },
        transition: choice.transition,
        fitted: analysis.fit !== null,
        thicknessNm: choice.thicknessNm,
        urbach: choice.urbach.enabled && analysis.urbach?.fit != null,
        derivative: analysis.derivative ? choice.derivative : 'off',
      };
    }),
  };
}

export const methodsText = (data: UvvisData): string => uvvisMethodsParagraph(methodsInput(data));
