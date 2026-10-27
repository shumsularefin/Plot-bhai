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
    render: (context) => <ImageStep {...context} />,
    validate: (data) =>
      data.image === null
        ? 'Load a figure image to continue. "Try with example data" draws a synthetic one.'
        : null,
  },
  {
    id: 'axes',
    title: 'Calibrate axes',
    render: (context) => <AxesStep {...context} />,
    validate: (data) => {
      const outcome = calibrationOf(data);
      return 'problem' in outcome ? outcome.problem : null;
    },
  },
  {
    id: 'curve',
    title: 'Digitize the curve',
    render: (context) => <CurveStep {...context} />,
    validate: (data) =>
      data.curve.color === null ? 'Click on the curve to digitize it before going on.' : null,
  },
  { id: 'send', title: 'Analyse in XRD', render: (context) => <SendStep {...context} /> },
];
