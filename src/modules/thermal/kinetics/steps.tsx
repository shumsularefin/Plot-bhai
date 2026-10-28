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
    guide: [
      'Load one run per heating rate (at least three), or press Try with example data.',
      'Type the heating rate of each run.',
      'Then press Next.',
    ],
    render: (context) => <KineticsUploadStep {...context} />,
    validate: (data) => uploadProblem(data.runs),
  },
  {
    id: 'setup',
    title: 'Method and window',
    guide: [
      'Choose the method: Kissinger, an isoconversional method, or Coats-Redfern.',
      'Set the temperature window of the step to analyse.',
      'Then press Next.',
    ],
    render: (context) => <KineticsSetupStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results and export',
    guide: [
      'Read the activation energy and check the straight-line plot.',
      'Download the CSV and copy the methods text.',
    ],
    render: (context) => <KineticsResultsStep {...context} />,
  },
];
