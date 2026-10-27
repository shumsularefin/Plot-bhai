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
    guide: [
      'Drop your spectrum files on the box, or press Choose files.',
      'Only have a picture of a graph? Press Use a graph image.',
      'No file at hand? Press Try with example data.',
      'In each card, check the data type (absorbance, transmittance or reflectance), then press Next.',
    ],
    render: (context) => <UploadStep {...context} />,
    validate: (data) =>
      data.spectra.length === 0
        ? 'Load at least one spectrum to continue. "Try with example data" loads synthetic ones.'
        : null,
  },
  {
    id: 'clean',
    title: 'Data type and cleaning',
    guide: [
      'Choose how the spectra are shown; your data are not changed.',
      'Optional: subtract a blank, set a baseline offset or smooth noisy spectra.',
      'Use these settings for all spectra applies them to every file. Then press Next.',
    ],
    render: (context) => <CleanStep {...context} />,
  },
  {
    id: 'bandgap',
    title: 'Band gap',
    guide: [
      'Choose the transition type (direct or indirect) for the Tauc plot.',
      'The straight part of the absorption edge is suggested; drag or type its limits to adjust.',
      'The band gap is where the fitted line meets the energy axis. Then press Next.',
    ],
    render: (context) => <BandGapStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results and export',
    guide: [
      'Check the results table.',
      'Download the CSV and copy the methods text.',
      'Figures are exported from the step where they are drawn.',
    ],
    render: (context) => <ResultsStep {...context} />,
  },
];
