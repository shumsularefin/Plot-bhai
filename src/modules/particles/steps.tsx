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
    render: (context) => <UploadStep {...context} />,
    validate: (data) =>
      data.image === null
        ? 'Load an image to continue. "Try with example data" draws a synthetic one.'
        : null,
  },
  {
    id: 'scale',
    title: 'Crop and scale',
    render: (context) => <ScaleStep {...context} />,
  },
  { id: 'detect', title: 'Detect particles', render: (context) => <DetectStep {...context} /> },
  { id: 'measure', title: 'Measure by hand', render: (context) => <MeasureStep {...context} /> },
  {
    id: 'results',
    title: 'Distribution and export',
    render: (context) => <DistributionStep {...context} />,
  },
];
