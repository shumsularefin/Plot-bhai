import { formatNumber } from '../xrd/parsers/numbers';
import type { DataMessage } from '../xrd/types';
import type { SpectrumKind, ValueScale } from './types';

export interface KindSuggestion {
  kind: SpectrumKind;
  scale: ValueScale;
  origin: 'header' | 'guess';
  /** Plain-language reason, shown next to the choice. */
  reason: string;
}

/** Reads a data type from header or column text such as "%T", "Transmittance", "Abs" or "R (%)". */
export function kindFromText(text: string): { kind: SpectrumKind; scale?: ValueScale } | undefined {
  if (/%\s*t\b|\bt\s*\(?%|transmit|transmission/i.test(text)) {
    return { kind: 'transmittance', scale: 'percent' };
  }
  if (/%\s*r\b|\br\s*\(?%|reflect/i.test(text)) return { kind: 'reflectance', scale: 'percent' };
  if (/\babs|absorb/i.test(text)) return { kind: 'absorbance' };
  return undefined;
}

/**
 * Suggests what the y values are. A word in the header ("%T", "Reflectance", "Absorbance")
 * decides when there is one. Otherwise the range decides: values above 8 cannot be a normal
 * absorbance and are taken as percent transmittance; smaller values are taken as absorbance.
 * This is a guess. Percent reflectance looks exactly like percent transmittance, and a
 * transmittance or reflectance written as a fraction looks like a small absorbance, so the
 * user must confirm.
 */
export function suggestKind(values: ArrayLike<number>, headerText = ''): KindSuggestion {
  const fromText = kindFromText(headerText);
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) max = Math.max(max, values[i] as number);

  if (fromText) {
    const scale = fromText.scale ?? (max > 1.5 ? 'percent' : 'fraction');
    return {
      kind: fromText.kind,
      scale: fromText.kind === 'absorbance' ? 'percent' : scale,
      origin: 'header',
      reason: 'The column heading names this data type.',
    };
  }
  if (max > 8) {
    return {
      kind: 'transmittance',
      scale: 'percent',
      origin: 'guess',
      reason: `The values go up to ${formatNumber(max, 1)}, too high for absorbance, so they look like percent. Transmittance and reflectance look the same, so please check which one this is.`,
    };
  }
  return {
    kind: 'absorbance',
    scale: 'percent',
    origin: 'guess',
    reason:
      max <= 1
        ? 'The values lie between 0 and 1. That fits a low absorbance, but also a transmittance or reflectance written as a fraction, so please check.'
        : `The values go up to ${formatNumber(max, 2)}, which fits absorbance.`,
  };
}

/**
 * Plain-language checks that the chosen data type and scale fit the values. Re-run whenever
 * the user changes either. Wavelength checks are made on import.
 */
export function checkKind(
  values: ArrayLike<number>,
  kind: SpectrumKind,
  scale: ValueScale,
): DataMessage[] {
  let min = Infinity;
  let max = -Infinity;
  let nonPositive = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] as number;
    min = Math.min(min, v);
    max = Math.max(max, v);
    if (v <= 0) nonPositive++;
  }
  const messages: DataMessage[] = [];
  if (kind === 'absorbance') {
    if (min < -0.1) {
      messages.push({
        level: 'warning',
        text: `Some absorbance values are below zero (lowest ${formatNumber(min, 3)}). Check the baseline or the blank.`,
      });
    }
    if (max > 4) {
      messages.push({
        level: 'warning',
        text: `Absorbance above about 4 is usually unreliable because almost no light reaches the detector (highest here: ${formatNumber(max, 2)}).`,
      });
    }
    return messages;
  }
  const full = scale === 'percent' ? 100 : 1;
  const name = kind === 'transmittance' ? 'transmittance' : 'reflectance';
  if (scale === 'percent' && max <= 1.5) {
    messages.push({
      level: 'warning',
      text: `The values only reach ${formatNumber(max, 3)}. If the ${name} is written as a fraction (0 to 1), choose "Fraction".`,
    });
  }
  if (scale === 'fraction' && max > 1.5) {
    messages.push({
      level: 'warning',
      text: `The values reach ${formatNumber(max, 1)}, which is too high for a fraction. If the ${name} is in percent, choose "Percent".`,
    });
  }
  if (max > full * 1.1) {
    messages.push({
      level: 'warning',
      text: `Some ${name} values are above ${full === 100 ? '100 %' : '1'}, which is not physical. This often comes from a baseline or reference problem.`,
    });
  }
  if (nonPositive > 0) {
    messages.push({
      level: 'warning',
      text:
        kind === 'transmittance'
          ? `${nonPositive} value${nonPositive === 1 ? ' is' : 's are'} zero or negative. Absorbance cannot be calculated at these points, so they are left out of absorbance views.`
          : `${nonPositive} value${nonPositive === 1 ? ' is' : 's are'} zero or negative. The Kubelka–Munk function cannot be calculated at these points, so they are left out of that view.`,
    });
  }
  return messages;
}
