import { checkKind as checkUvvisKind } from '../uvvis/kind';
import { formatNumber } from '../xrd/parsers/numbers';
import type { DataMessage } from '../xrd/types';
import type { FtirKind, ValueScale } from './types';

export interface FtirKindSuggestion {
  kind: FtirKind;
  scale: ValueScale;
  origin: 'header' | 'guess';
  reason: string;
}

/** Data type named in header or column text ("%T", "Transmittance", "Absorbance"), if any. */
export function ftirKindFromText(text: string): FtirKind | undefined {
  if (/%\s*t\b|\bt\s*\(?%|transmit|transmission/i.test(text)) return 'transmittance';
  if (/\babs|absorb/i.test(text)) return 'absorbance';
  return undefined;
}

/**
 * True when header, column or JCAMP-DX ##YUNITS text states reflectance ("Reflectance", "%R",
 * "R (%)"). The FTIR tool has no reflectance data type yet, so such a file is read as
 * transmittance and the spectrum carries `REFLECTANCE_NOTE`.
 */
export function ftirStatesReflectance(text: string): boolean {
  return /%\s*r\b|\br\s*[([]?\s*%|reflect/i.test(text);
}

/** Warning shown on the spectrum card of a file that states reflectance. */
export const REFLECTANCE_NOTE: DataMessage = {
  level: 'warning',
  text: 'The file says these values are reflectance. This tool treats them as transmittance for now, so the absorbance view, band heights and areas are calculated as if light had passed through the sample. Reflectance bands can have different shapes and relative heights from a transmittance spectrum of the same material, so compare positions only with care. A proper reflectance data type is planned.',
};

/**
 * Suggests whether the values are absorbance or transmittance. A word in the header decides when
 * there is one. Otherwise values above 8 are taken as percent transmittance (a normal absorbance
 * never gets that high) and smaller values as absorbance. This is a guess: a transmittance
 * written as a fraction looks like a small absorbance, so the user must confirm.
 */
export function suggestFtirKind(values: ArrayLike<number>, headerText = ''): FtirKindSuggestion {
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) max = Math.max(max, values[i] as number);
  const named = ftirKindFromText(headerText);
  if (named) {
    return {
      kind: named,
      scale: named === 'transmittance' && max <= 1.5 ? 'fraction' : 'percent',
      origin: 'header',
      reason: 'The heading names this data type.',
    };
  }
  if (max > 8) {
    return {
      kind: 'transmittance',
      scale: 'percent',
      origin: 'guess',
      reason: `The values go up to ${formatNumber(max, 1)}, too high for absorbance, so they look like percent transmittance.`,
    };
  }
  return {
    kind: 'absorbance',
    scale: 'percent',
    origin: 'guess',
    reason:
      max <= 1
        ? 'The values lie between 0 and 1. That fits a low absorbance, but also a transmittance written as a fraction.'
        : `The values go up to ${formatNumber(max, 2)}, which fits absorbance.`,
  };
}

/** Plain-language checks that the chosen data type and scale fit the values. */
export function checkFtirKind(
  values: ArrayLike<number>,
  kind: FtirKind,
  scale: ValueScale,
): DataMessage[] {
  return checkUvvisKind(values, kind, scale);
}
