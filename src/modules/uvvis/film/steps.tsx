import type { WizardStep } from '../../../ui/wizard/types';
import { uploadProblem } from './analysis';
import type { FilmData } from './data';
import { FilmResultsStep } from './ResultsStep';
import { FilmSetupStep } from './SetupStep';
import { FilmUploadStep } from './UploadStep';

/** The plasmon and thin-film wizard. */
export const filmSteps: readonly WizardStep<FilmData>[] = [
  {
    id: 'upload',
    title: 'Method and spectrum',
    guide: [
      'Choose the plasmon band fit or the thin film method.',
      'Load one spectrum, or press Try with example data.',
      'Then press Next.',
    ],
    render: (context) => <FilmUploadStep {...context} />,
    validate: uploadProblem,
  },
  {
    id: 'setup',
    title: 'Range and settings',
    guide: [
      'Set the range on the plot.',
      'Plasmon: give the starting band position. Thin film: give the substrate index.',
      'Then press Next.',
    ],
    render: (context) => <FilmSetupStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results and export',
    guide: ['Read the result and check the plot.', 'Download the CSV and copy the methods text.'],
    render: (context) => <FilmResultsStep {...context} />,
  },
];
