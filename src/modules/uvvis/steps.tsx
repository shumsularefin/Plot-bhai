import type { WizardStep } from '../../ui/wizard/types';
import { CleanStep } from './CleanStep';
import type { UvvisData } from './data';
import { BandGapStep } from './BandGapStep';
import { BandsStep } from './BandsStep';
import { ResultsStep } from './ResultsStep';
import { UploadStep } from './UploadStep';

/** The UV-Vis wizard. */
export const uvvisSteps: readonly WizardStep<UvvisData>[] = [
  {
    id: 'upload',
    title: 'Upload',
    summary: 'Load your spectra',
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
    tab: 'Clean',
    summary: 'Display, blank and smoothing',
    guide: [
      'Choose how the spectra are shown; your data are not changed.',
      'Optional: subtract a blank, set a baseline offset or smooth noisy spectra.',
      'Use these settings for all spectra applies them to every file. Then press Next.',
    ],
    render: (context) => <CleanStep {...context} />,
  },
  {
    id: 'bands',
    title: 'Absorption bands',
    tab: 'Bands',
    summary: 'Band table and band fit',
    guide: [
      'The band maxima of each spectrum are listed with their wavelength and photon energy.',
      'Change the minimum prominence or the search range, or add and remove bands on the plot.',
      'Optional: fit overlapping bands on the energy axis. Then press Next.',
    ],
    render: (context) => <BandsStep {...context} />,
  },
  {
    id: 'bandgap',
    title: 'Band gap',
    summary: 'Tauc plot and fit',
    guide: [
      'Choose the transition type (direct or indirect) for the Tauc plot.',
      'The straight part of the absorption edge is suggested; drag or type its limits to adjust.',
      'Say whether the sample is a film or a solution, with its thickness or path length if known.',
      'The band gap is where the fitted line meets the energy axis, or a baseline when the curve does not fall to zero below the edge. Then press Next.',
    ],
    render: (context) => <BandGapStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results and export',
    tab: 'Results',
    summary: 'Tables, figures and methods text',
    guide: [
      'Check the results table.',
      'Download the CSV and copy the methods text.',
      'Figures are exported from the step where they are drawn.',
    ],
    render: (context) => <ResultsStep {...context} />,
  },
];
