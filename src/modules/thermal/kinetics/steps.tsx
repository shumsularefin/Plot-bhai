import type { WizardStep } from '../../../ui/wizard/types';
import { uploadProblem } from './analysis';
import type { KineticsData } from './data';
import { KineticsResultsStep } from './ResultsStep';
import { KineticsSetupStep } from './SetupStep';
import { KineticsUploadStep } from './UploadStep';

/** The kinetics wizard. */
export const kineticsSteps: readonly WizardStep<KineticsData>[] = [
  {
    id: 'upload',
    title: 'Upload runs and heating rates',
    render: (context) => <KineticsUploadStep {...context} />,
    validate: (data) => uploadProblem(data.runs),
  },
  {
    id: 'setup',
    title: 'Method and window',
    render: (context) => <KineticsSetupStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results and export',
    render: (context) => <KineticsResultsStep {...context} />,
  },
];
