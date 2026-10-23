import type { WizardStep } from '../../ui/wizard/types';
import type { XrdData } from './data';
import { CleanStep } from './CleanStep';
import { FitStep } from './FitStep';
import { instrumentProblem } from './instrument';
import { InstrumentStep } from './InstrumentStep';
import { MaterialStep } from './MaterialStep';
import { PhasesStep } from './PhasesStep';
import { ResultsStep } from './ResultsStep';
import { UploadStep } from './UploadStep';

function LaterStage() {
  return <p class="placeholder-note">This step is built in a later stage.</p>;
}

/** The XRD wizard in its final order. Steps without content yet are placeholders. */
export const xrdSteps: readonly WizardStep<XrdData>[] = [
  {
    id: 'upload',
    title: 'Upload',
    render: (context) => <UploadStep {...context} />,
    validate: (data) =>
      data.patterns.length === 0
        ? 'Load at least one pattern to continue. "Try with example data" loads a synthetic one.'
        : null,
  },
  { id: 'clean', title: 'Clean data', render: (context) => <CleanStep {...context} /> },
  { id: 'material', title: 'Choose material', render: (context) => <MaterialStep {...context} /> },
  {
    id: 'phases',
    title: 'Compare reference phases',
    render: (context) => <PhasesStep {...context} />,
  },
  { id: 'fit', title: 'Fit peaks', render: (context) => <FitStep {...context} /> },
  {
    id: 'instrument',
    title: 'Instrument correction',
    render: (context) => <InstrumentStep {...context} />,
    validate: instrumentProblem,
  },
  { id: 'results', title: 'Results tables', render: (context) => <ResultsStep {...context} /> },
  { id: 'export', title: 'Export', render: () => <LaterStage /> },
];
