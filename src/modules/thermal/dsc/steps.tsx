import type { WizardStep } from '../../../ui/wizard/types';
import { DscCleanStep } from './CleanStep';
import { DscCombinedStep } from './CombinedStep';
import type { DscData } from './data';
import { DscEventsStep } from './EventsStep';
import { DscGlassStep } from './GlassStep';
import { DscResultsStep } from './ResultsStep';
import { DscUploadStep, dscUploadProblem } from './UploadStep';

/** The DSC wizard. Step 5 reads the DSC events against a mass curve (a mass column or a second file). */
export const dscSteps: readonly WizardStep<DscData>[] = [
  {
    id: 'upload',
    title: 'Upload and describe the run',
    render: (context) => <DscUploadStep {...context} />,
    validate: dscUploadProblem,
  },
  { id: 'clean', title: 'Clean data', render: (context) => <DscCleanStep {...context} /> },
  {
    id: 'events',
    title: 'Baseline and events',
    render: (context) => <DscEventsStep {...context} />,
  },
  {
    id: 'glass',
    title: 'Glass transition and crystallinity',
    render: (context) => <DscGlassStep {...context} />,
  },
  {
    id: 'combined',
    title: 'Combined interpretation',
    render: (context) => <DscCombinedStep {...context} />,
  },
  { id: 'results', title: 'Results', render: (context) => <DscResultsStep {...context} /> },
];
