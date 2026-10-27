import type { WizardStep } from '../../ui/wizard/types';
import { mappingProblem, runOf } from './analysis';
import { AssignStep } from './AssignStep';
import { CalcinationStep } from './CalcinationStep';
import { CleanStep } from './CleanStep';
import type { ThermalData } from './data';
import { ResultsStep } from './ResultsStep';
import { StepsStep } from './StepsStep';
import { UploadStep } from './UploadStep';

/** The thermal analysis wizard. */
export const thermalSteps: readonly WizardStep<ThermalData>[] = [
  {
    id: 'upload',
    title: 'Upload and describe the run',
    guide: [
      'Drop your TGA file on the box, or press Choose a file. Or press Try with example data.',
      'Check which columns are temperature and mass.',
      'Fill in the atmosphere, heating rate and sample mass, then press Next.',
    ],
    render: (context) => <UploadStep {...context} />,
    validate: (data) => {
      if (!data.file) {
        return 'Load a run to continue. "Try with example data" loads a synthetic one.';
      }
      const problem = mappingProblem(data.file);
      if (problem) return problem;
      return runOf(data.file)?.mass
        ? null
        : 'This tool needs a mass column for TGA. Choose one in the column settings above.';
    },
  },
  {
    id: 'clean',
    title: 'Clean data',
    guide: [
      'The run is cut to its heating part automatically.',
      'Optional: subtract a blank run, smooth, or normalise to a start temperature.',
      'Then press Next.',
    ],
    render: (context) => <CleanStep {...context} />,
  },
  {
    id: 'steps',
    title: 'Mass loss steps',
    guide: [
      'Each peak of the DTG curve (the lower plot) is one mass loss step.',
      'Adjust the detection, or drag the round markers to set where each step starts and ends.',
      'Check the steps table, then press Next.',
    ],
    render: (context) => <StepsStep {...context} />,
  },
  {
    id: 'assign',
    title: 'Assign events',
    guide: [
      'Each step gets ranked suggestions of what it might be, with a reason.',
      'Accept one, write your own, or leave it open. TGA alone cannot identify the gas released.',
      'Optional: compare with a theoretical mass loss from formulas.',
    ],
    render: (context) => <AssignStep {...context} />,
  },
  {
    id: 'calcination',
    title: 'Calcination suggestion',
    guide: [
      'The suggestion is the lowest temperature worth trying, after the last mass loss step.',
      'Calcine samples at the suggested temperatures and compare them, for example by XRD.',
      'It is a starting point, not the best temperature.',
    ],
    render: (context) => <CalcinationStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results and export',
    guide: [
      'Check the steps and events table.',
      'Download the CSV and the figure, and copy the methods text.',
      'Save the session file to continue later.',
    ],
    render: (context) => <ResultsStep {...context} />,
  },
];
