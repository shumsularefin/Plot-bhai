import type { WizardStep } from '../../ui/wizard/types';
import { AssignStep } from './AssignStep';
import { CleanStep } from './CleanStep';
import type { FtirData } from './data';
import { PeaksStep } from './PeaksStep';
import { ResultsStep } from './ResultsStep';
import { UploadStep } from './UploadStep';

/** The FTIR wizard. */
export const ftirSteps: readonly WizardStep<FtirData>[] = [
  {
    id: 'upload',
    title: 'Upload',
    render: (context) => <UploadStep {...context} />,
    validate: (data) =>
      data.spectra.length === 0
        ? 'Load at least one spectrum to continue. "Try with example data" loads synthetic ones.'
        : null,
  },
  { id: 'clean', title: 'Clean data', render: (context) => <CleanStep {...context} /> },
  { id: 'peaks', title: 'Pick peaks', render: (context) => <PeaksStep {...context} /> },
  { id: 'assign', title: 'Assign groups', render: (context) => <AssignStep {...context} /> },
  { id: 'results', title: 'Results and export', render: (context) => <ResultsStep {...context} /> },
];
