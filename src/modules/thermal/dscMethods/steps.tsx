import type { WizardStep } from '../../../ui/wizard/types';
import { uploadProblem } from './analysis';
import type { DscMethodsData } from './data';
import { DscMethodsResultsStep } from './ResultsStep';
import { DscMethodsSetupStep } from './SetupStep';
import { DscMethodsUploadStep } from './UploadStep';

/** The DSC methods wizard: heat capacity, purity or oxidation induction time. */
export const dscMethodsSteps: readonly WizardStep<DscMethodsData>[] = [
  {
    id: 'upload',
    title: 'Method and runs',
    guide: [
      'Choose the method, then load the runs it asks for, or press Try with example data.',
      'Say which way exothermic peaks point, and type the masses.',
      'Then press Next.',
    ],
    render: (context) => <DscMethodsUploadStep {...context} />,
    validate: uploadProblem,
  },
  {
    id: 'setup',
    title: 'Range and settings',
    guide: [
      'Check the runs on the plot.',
      'Set the temperature range, peak limits or gas switch time.',
      'Then press Next.',
    ],
    render: (context) => <DscMethodsSetupStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results and export',
    guide: ['Read the result and check the plot.', 'Download the CSV and copy the methods text.'],
    render: (context) => <DscMethodsResultsStep {...context} />,
  },
];
