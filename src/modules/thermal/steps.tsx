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
    render: (context) => <CleanStep {...context} />,
  },
  {
    id: 'steps',
    title: 'Mass loss steps',
    render: (context) => <StepsStep {...context} />,
  },
  {
    id: 'assign',
    title: 'Assign events',
    render: (context) => <AssignStep {...context} />,
  },
  {
    id: 'calcination',
    title: 'Calcination suggestion',
    render: (context) => <CalcinationStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results and export',
    render: (context) => <ResultsStep {...context} />,
  },
];
