import { useState } from 'preact/hooks';
import { suggestKind } from '../../../core/uvvis/kind';
import { directGapAbsorbance, EXAMPLE_BAND_GAP_EV } from '../../../core/uvvis/synthetic';
import type { Spectrum } from '../../../core/uvvis/types';
import { MAX_SERIES } from '../../../ui/plot/palette';
import { newId } from '../../uvvis/data';
import { uvvisStore } from '../../uvvis/uvvisStore';
import { curveName, digitizedNotes } from '../digitized';
import { DigitizeTool } from '../DigitizeTool';
import { drawFigure } from '../example';
import { KindChoice, type KindOption } from '../KindChoice';
import { SendButton } from '../SendButton';
import type { DigitizeTarget, SendProps } from '../target';

const EXAMPLE_GRID = { startNm: 250, endNm: 800, stepNm: 1 };

/** The example absorbance, linearly interpolated on its 1 nm grid. */
function exampleCurve(): (nm: number) => number {
  const { values } = directGapAbsorbance({
    ...EXAMPLE_GRID,
    bandGapEv: EXAMPLE_BAND_GAP_EV,
  });
  return (nm) => {
    const t = Math.min(
      Math.max((nm - EXAMPLE_GRID.startNm) / EXAMPLE_GRID.stepNm, 0),
      values.length - 1,
    );
    const i = Math.min(Math.floor(t), values.length - 2);
    const a = values[i] as number;
    return a + (t - i) * ((values[i + 1] as number) - a);
  };
}

const example = () =>
  drawFigure({
    x: [250, 800],
    xTick: 50,
    xTitle: 'Wavelength (nm)',
    y: [0, 2],
    yTick: 0.5,
    yLabelsTo: 2,
    curves: [{ f: exampleCurve(), color: '#000000' }],
    traced: { index: 0, rgb: [0, 0, 0], at: 600 },
    marks: { x: [300, 750], y: [0, 1.5] },
    description: `A generated figure, not from a real paper: the absorbance of a made-up direct band gap of ${EXAMPLE_BAND_GAP_EV} eV, so the Tauc plot later can be checked against ${EXAMPLE_BAND_GAP_EV} eV.`,
  });

const OPTIONS: readonly KindOption[] = [
  { kind: 'absorbance', scale: 'percent', label: 'Absorbance' },
  { kind: 'transmittance', scale: 'percent', label: 'Transmittance in % (0 to 100)' },
  { kind: 'transmittance', scale: 'fraction', label: 'Transmittance as a fraction (0 to 1)' },
  { kind: 'reflectance', scale: 'percent', label: 'Reflectance in % (0 to 100)' },
  { kind: 'reflectance', scale: 'fraction', label: 'Reflectance as a fraction (0 to 1)' },
];

function Send({ data, curve }: SendProps) {
  const suggestion = suggestKind(curve.y);
  const [choice, setChoice] = useState<Omit<KindOption, 'label'> | null>(null);
  const chosen = choice ?? suggestion;
  const add = async () => {
    await uvvisStore.ready;
    const current = uvvisStore.get();
    const spectra = current.data.spectra;
    if (spectra.length >= MAX_SERIES)
      return `The UV-Vis analysis already holds ${MAX_SERIES} spectra, the most it can show. Remove one there, then come back.`;
    const spectrum: Spectrum = {
      id: newId(),
      name: curveName(data),
      source: 'digitized',
      wavelengthNm: curve.x,
      values: curve.y,
      kind: chosen.kind,
      scale: chosen.scale,
      kindOrigin: choice ? 'user' : 'guess',
      synthetic: data.image?.synthetic ?? false,
      notes: digitizedNotes(curve, target.axes),
    };
    uvvisStore.set({
      ...current,
      step: 0,
      data: { ...current.data, spectra: [...spectra, spectrum] },
    });
    return null;
  };
  return (
    <>
      <KindChoice
        options={OPTIONS}
        value={chosen}
        onChange={setChoice}
        reason={choice ? 'Chosen by you.' : `Suggested: ${suggestion.reason}`}
      />
      <SendButton label="Add to my UV-Vis analysis" onSend={add} route={target.route} />
    </>
  );
}

const target: DigitizeTarget = {
  tool: 'UV-Vis',
  route: '#/uvvis',
  storeKey: 'uvvis-image-session',
  imageKey: 'uvvis-image-file',
  figure: 'a UV-Vis spectrum plotted against wavelength in nm',
  axes: {
    x: 'wavelength',
    y: 'absorbance, %T or %R',
    xIncreasesRight: true,
    xShort: 'λ',
    yShort: 'y',
    xUnit: ' nm',
    xCsv: 'wavelength (nm)',
    xDigits: 1,
    yMayBeNegative: false,
  },
  labels: { x: 'Wavelength (nm)', y: 'As in the figure' },
  example,
  Send,
};

export default function UvvisFromImage() {
  return <DigitizeTool target={target} />;
}
