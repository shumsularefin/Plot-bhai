import type { WizardStep } from '../../ui/wizard/types';
import type { ParticleData } from './data';
import { DetectStep } from './DetectStep';
import { DistributionStep } from './DistributionStep';
import { MeasureStep } from './MeasureStep';
import { ScaleStep } from './ScaleStep';
import { UploadStep } from './UploadStep';

/** The particle size wizard. */
export const particleSteps: readonly WizardStep<ParticleData>[] = [
  {
    id: 'upload',
    title: 'Upload',
    guide: [
      'Drop an SEM or TEM image on the box, or press Choose an image (PNG, JPEG or TIFF).',
      'No image at hand? Press Try with example data.',
      'Then press Next.',
    ],
    render: (context) => <UploadStep {...context} />,
    validate: (data) =>
      data.image === null
        ? 'Load an image to continue. "Try with example data" draws a synthetic one.'
        : null,
  },
  {
    id: 'scale',
    title: 'Crop and scale',
    guide: [
      'Crop away the info bar if the image has one.',
      'Choose Draw the scale bar and drag along the bar printed on the image.',
      'Type the length printed next to the bar, then press Next.',
    ],
    render: (context) => <ScaleStep {...context} />,
  },
  {
    id: 'detect',
    title: 'Detect particles',
    guide: [
      'Press Detect particles.',
      'Check every outline against the image: merge, cut, delete or add particles where it went wrong.',
      'Adjust the sensitivity if many particles are missed or split, then press Next.',
    ],
    render: (context) => <DetectStep {...context} />,
  },
  {
    id: 'measure',
    title: 'Measure by hand',
    guide: [
      'Optional: measure particles by hand with a line, circle or ellipse.',
      'Drag on the image to draw; each measurement appears in the table.',
      'Then press Next.',
    ],
    render: (context) => <MeasureStep {...context} />,
  },
  {
    id: 'results',
    title: 'Distribution and export',
    guide: [
      'Choose which particles go into the distribution.',
      'Read the mean size and the histogram.',
      'Download the CSV files and the annotated image, and copy the methods text.',
    ],
    render: (context) => <DistributionStep {...context} />,
  },
];
