import type { WizardStep } from '../../ui/wizard/types';
import type { ParticleData } from './data';
import { DetectStep } from './DetectStep';
import { DistributionStep } from './DistributionStep';
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
      'Tick "darker than the background" for TEM images, then press Detect particles.',
      'If the particles sit in clumps, choose "In clumps or overlapping" under part 3 and detect again.',
      'Check every outline against the image: merge, cut, delete or add particles where it went wrong.',
      'Measure particles the detection cannot outline with Add a line, then press Next.',
    ],
    render: (context) => <DetectStep {...context} />,
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
