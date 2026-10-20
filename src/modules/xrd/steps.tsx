import type { WizardStep } from '../../ui/wizard/types';
import type { XrdData } from './data';
import { UploadStep } from './UploadStep';
import { XrdPlot } from './XrdPlot';

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
  {
    id: 'clean',
    title: 'Clean data',
    render: ({ data, update }) => (
      <>
        <p class="placeholder-note">
          Cleaning tools are built in the next stage. Your loaded patterns are shown below.
        </p>
        {data.patterns.length > 0 ? (
          <XrdPlot
            patterns={data.patterns}
            settings={data.plot}
            onSettingsChange={(patch) => update({ plot: { ...data.plot, ...patch } })}
          />
        ) : (
          <p>No patterns are loaded. Go back to Upload to add one.</p>
        )}
      </>
    ),
  },
  { id: 'material', title: 'Choose material', render: () => <LaterStage /> },
  { id: 'phases', title: 'Compare reference phases', render: () => <LaterStage /> },
  { id: 'fit', title: 'Fit peaks', render: () => <LaterStage /> },
  { id: 'instrument', title: 'Instrument correction', render: () => <LaterStage /> },
  { id: 'results', title: 'Results tables', render: () => <LaterStage /> },
  { id: 'export', title: 'Export', render: () => <LaterStage /> },
];
