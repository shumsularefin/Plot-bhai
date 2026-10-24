import type { WizardStep } from '../../ui/wizard/types';
import { CleanStep } from './CleanStep';
import type { UvvisData } from './data';
import { BandGapStep } from './BandGapStep';
import { ResultsStep } from './ResultsStep';
import { UploadStep } from './UploadStep';

/** The UV-Vis wizard. */
export const uvvisSteps: readonly WizardStep<UvvisData>[] = [
  {
    id: 'upload',
    title: 'Upload',
    render: (context) => <UploadStep {...context} />,
    validate: (data) =>
      data.spectra.length === 0
        ? 'Load at least one spectrum to continue. "Try with example data" loads synthetic ones.'
        : null,
  },
  {
    id: 'clean',
    title: 'Data type and cleaning',
    render: (context) => <CleanStep {...context} />,
  },
  {
    id: 'bandgap',
    title: 'Band gap',
    render: (context) => <BandGapStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results and export',
    render: (context) => <ResultsStep {...context} />,
  },
];
