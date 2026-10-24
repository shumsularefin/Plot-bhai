import type { WizardStep } from '../../ui/wizard/types';
import { mappingProblem, runOf } from './analysis';
import { CleanStep } from './CleanStep';
import type { ThermalData } from './data';
import { StepsStep } from './StepsStep';
import { UploadStep } from './UploadStep';

/** Shown for the steps that come in the next sub-stage. */
function Soon({ what }: { what: string }) {
  return (
    <p class="message is-info">
      {what} is not built yet; it comes in the next sub-stage. Your mass loss steps from step 3 are
      saved and will be used here.
    </p>
  );
}

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
    render: () => <Soon what="Assigning events to the steps" />,
  },
  {
    id: 'calcination',
    title: 'Calcination suggestion',
    render: () => <Soon what="The calcination temperature suggestion" />,
  },
  {
    id: 'results',
    title: 'Results and export',
    render: () => <Soon what="The combined results and export" />,
  },
];
