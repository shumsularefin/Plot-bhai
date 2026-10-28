import type { WizardStep } from '../../../ui/wizard/types';
import { samplesProblem } from './analysis';
import type { ConcentrationData } from './data';
import { ResultsStep } from './ResultsStep';
import { SamplesStep } from './SamplesStep';
import { WavelengthStep } from './WavelengthStep';

/** The concentration and kinetics wizard. */
export const concentrationSteps: readonly WizardStep<ConcentrationData>[] = [
  {
    id: 'samples',
    title: 'Standards and samples',
    guide: [
      'Load the spectra of standards of known concentration, of samples taken over time, or both.',
      'Or press Try with example data. No spectra? Type the absorbances instead.',
      'Type the concentration of each standard and the time of each sample, then press Next.',
    ],
    render: (context) => <SamplesStep {...context} />,
    validate: (data) => samplesProblem(data.samples),
  },
  {
    id: 'wavelength',
    title: 'Wavelength',
    guide: [
      'The absorbance is read at the band maximum, chosen automatically.',
      'Click the plot or type a wavelength to change it, then press Next.',
    ],
    render: (context) => <WavelengthStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results and export',
    guide: [
      'Check the calibration line and the rate constant.',
      'Download the CSV files and figures, and copy the methods text.',
    ],
    render: (context) => <ResultsStep {...context} />,
  },
];
