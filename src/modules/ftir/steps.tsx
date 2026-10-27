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
    guide: [
      'Drop your spectrum files on the box, or press Choose files (.csv, .txt, .dpt, .jdx).',
      'No file at hand? Press Try with example data.',
      'Check in each card that absorbance or transmittance was detected correctly, then press Next.',
    ],
    render: (context) => <UploadStep {...context} />,
    validate: (data) =>
      data.spectra.length === 0
        ? 'Load at least one spectrum to continue. "Try with example data" loads synthetic ones.'
        : null,
  },
  {
    id: 'clean',
    title: 'Clean data',
    guide: [
      'Every switch is optional: turn on only what your spectra need.',
      'Usually: a baseline correction; smoothing only for noisy spectra.',
      'Use these settings for all spectra applies them to every file. Then press Next.',
    ],
    render: (context) => <CleanStep {...context} />,
  },
  {
    id: 'peaks',
    title: 'Pick peaks',
    guide: [
      'Peaks are picked automatically and marked on the plot.',
      'Move the prominence slider to keep more or fewer peaks; limit the range if needed.',
      'Check the peak table, then press Next.',
    ],
    render: (context) => <PeaksStep {...context} />,
  },
  {
    id: 'assign',
    title: 'Assign groups',
    guide: [
      'Each peak gets ranked suggestions of functional groups, from typical wavenumber ranges.',
      'Accept a suggestion, write your own label, or leave the peak unassigned.',
      'Suggestions are estimates: confirm them with your literature.',
    ],
    render: (context) => <AssignStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results and export',
    guide: [
      'Check the peak and assignment table.',
      'Download the CSV files and the figure, and copy the methods text.',
      'Save the session file to continue later.',
    ],
    render: (context) => <ResultsStep {...context} />,
  },
];
