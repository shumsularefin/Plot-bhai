import type { WizardStep } from '../../ui/wizard/types';
import type { ParticleData } from './data';
import { MeasureStep } from './MeasureStep';
import { ScaleStep } from './ScaleStep';
import { UploadStep } from './UploadStep';

/** The particle size wizard. Automatic detection (10b) joins step 3; step 4 is built in 10c. */
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
  { id: 'measure', title: 'Measure', render: (context) => <MeasureStep {...context} /> },
  {
    id: 'results',
    title: 'Distribution and export',
    render: () => (
      <p class="message">
        <strong>Coming soon:</strong> the size distribution (histogram, fits, D10, D50, D90) and the
        export of figures and tables will be here. This step is not built yet. Your measurements
        from step 3 are kept.
      </p>
    ),
  },
];
