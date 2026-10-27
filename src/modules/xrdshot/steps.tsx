import type { WizardStep } from '../../ui/wizard/types';
import { AxesStep } from './AxesStep';
import { CurveStep } from './CurveStep';
import type { ShotData } from './data';
import { calibrationOf } from './digitized';
import { ImageStep } from './ImageStep';
import { SendStep } from './SendStep';

/** The XRD screenshot wizard. */
export const shotSteps: readonly WizardStep<ShotData>[] = [
  {
    id: 'image',
    title: 'Image',
    guide: [
      'Drop or paste a screenshot of an XRD figure, or press Choose an image.',
      'Turn it if needed and crop to the plot area.',
      'Then press Next.',
    ],
    render: (context) => <ImageStep {...context} />,
    validate: (data) =>
      data.image === null
        ? 'Load a figure image to continue. "Try with example data" draws a synthetic one.'
        : null,
  },
  {
    id: 'axes',
    title: 'Calibrate axes',
    guide: [
      'Click two labelled ticks on the 2θ axis and type their values.',
      'Do the same for two ticks on the intensity axis.',
      "Check the dashed grid matches the figure's ticks, then press Next.",
    ],
    render: (context) => <AxesStep {...context} />,
    validate: (data) => {
      const outcome = calibrationOf(data);
      return 'problem' in outcome ? outcome.problem : null;
    },
  },
  {
    id: 'curve',
    title: 'Digitize the curve',
    guide: [
      'Click on the curve to trace it.',
      'Fix mistakes with erase boxes or by adding points.',
      'Check the trace on the image, then press Next.',
    ],
    render: (context) => <CurveStep {...context} />,
    validate: (data) =>
      data.curve.color === null ? 'Click on the curve to digitize it before going on.' : null,
  },
  {
    id: 'send',
    title: 'Analyse in XRD',
    guide: [
      'Add the pattern to your current XRD analysis, or start a new one.',
      'It is marked as approximate, because it was read from a picture.',
    ],
    render: (context) => <SendStep {...context} />,
  },
];
