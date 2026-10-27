import { useState } from 'preact/hooks';
import { EXAMPLE_BANDS } from '../../../core/ftir/synthetic';
import type { FtirSpectrum } from '../../../core/ftir/types';
import { percentTFromAbsorbance } from '../../../core/uvvis/conversions';
import { suggestKind } from '../../../core/uvvis/kind';
import { MAX_SERIES } from '../../../ui/plot/palette';
import { newId } from '../../ftir/data';
import { ftirLabels } from '../../ftir/FtirPlot';
import { ftirStore } from '../../ftir/ftirStore';
import { defaultQuantity } from '../../ftir/quantity';
import { curveName, digitizedNotes } from '../digitized';
import { DigitizeTool } from '../DigitizeTool';
import { drawFigure } from '../example';
import { KindChoice, type KindOption } from '../KindChoice';
import { SendButton } from '../SendButton';
import type { DigitizeTarget, SendProps } from '../target';

/** Absorbance of the example bands (Lorentzian, see core/ftir/synthetic) at ν cm⁻¹. */
function absorbance(v: number): number {
  return EXAMPLE_BANDS.reduce((a, b) => {
    const half = b.fwhm / 2;
    return a + (b.height * half * half) / ((v - b.centre) ** 2 + half * half);
  }, 0);
}

const example = () =>
  drawFigure({
    x: [4000, 400],
    xTick: 500,
    xTitle: 'Wavenumber (cm⁻¹)',
    y: [0, 110],
    yTick: 20,
    yLabelsTo: 100,
    curves: [{ f: (v) => percentTFromAbsorbance(absorbance(v)), color: '#1f4e9c' }],
    traced: { index: 0, rgb: [0x1f, 0x4e, 0x9c], at: 2500 },
    marks: { x: [3500, 1000], y: [0, 100] },
    description:
      'A generated figure, not from a real paper: a percent transmittance spectrum of made-up bands, drawn with the highest wavenumber on the left as FTIR spectra usually are.',
  });

const OPTIONS: readonly KindOption[] = [
  { kind: 'absorbance', scale: 'percent', label: 'Absorbance' },
  { kind: 'transmittance', scale: 'percent', label: 'Transmittance in % (0 to 100)' },
  { kind: 'transmittance', scale: 'fraction', label: 'Transmittance as a fraction (0 to 1)' },
];

function Send({ data, curve }: SendProps) {
  const suggestion = suggestKind(curve.y);
  const [choice, setChoice] = useState<Omit<KindOption, 'label'> | null>(null);
  const chosen = choice ?? suggestion;
  const add = async () => {
    await ftirStore.ready;
    const current = ftirStore.get();
    const spectra = current.data.spectra;
    if (spectra.length >= MAX_SERIES)
      return `The FTIR analysis already holds ${MAX_SERIES} spectra, the most it can show. Remove one there, then come back.`;
    const spectrum: FtirSpectrum = {
      id: newId(),
      name: curveName(data),
      source: 'digitized',
      wavenumber: curve.x,
      values: curve.y,
      kind: chosen.kind === 'transmittance' ? 'transmittance' : 'absorbance',
      scale: chosen.scale,
      kindOrigin: choice ? 'user' : 'guess',
      synthetic: data.image?.synthetic ?? false,
      notes: digitizedNotes(curve, target.axes),
    };
    ftirStore.set({
      ...current,
      step: 0,
      data: {
        ...current.data,
        spectra: [...spectra, spectrum],
        ...(spectra.length === 0 && {
          view: { ...current.data.view, quantity: defaultQuantity([spectrum]) },
        }),
      },
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
      <SendButton label="Add to my FTIR analysis" onSend={add} route={target.route} />
    </>
  );
}

const target: DigitizeTarget = {
  tool: 'FTIR',
  route: '#/ftir',
  storeKey: 'ftir-image-session',
  imageKey: 'ftir-image-file',
  figure: 'an FTIR spectrum',
  axes: {
    x: 'wavenumber',
    y: 'absorbance or %T',
    // Both directions are common, so a decreasing axis raises no warning.
    xIncreasesRight: false,
    xShort: 'ν̃',
    yShort: 'y',
    xUnit: ' cm⁻¹',
    xCsv: 'wavenumber (cm-1)',
    xDigits: 0,
    yMayBeNegative: false,
  },
  labels: { ...ftirLabels('absorbance')(false), y: 'As in the figure' },
  example,
  Send,
};

export default function FtirFromImage() {
  return <DigitizeTool target={target} />;
}
