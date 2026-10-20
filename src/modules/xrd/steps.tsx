import { HelpTip } from '../../ui/HelpTip';
import type { WizardStep } from '../../ui/wizard/types';

/** Data saved for an XRD analysis. Later stages add the real fields. */
export interface XrdData {
  sampleName: string;
}

export const initialXrdData: XrdData = { sampleName: '' };

function LaterStage() {
  return <p class="placeholder-note">This step is built in a later stage.</p>;
}

/**
 * The XRD wizard in its final order. Every step except the sample name is a placeholder
 * until its stage is built.
 */
export const xrdSteps: readonly WizardStep<XrdData>[] = [
  {
    id: 'upload',
    title: 'Upload',
    render: ({ data, update }) => (
      <>
        <p>
          Upload your diffraction pattern: intensity measured against the angle 2θ{' '}
          <HelpTip term="2θ">
            <p>
              2θ (two-theta) is the angle between the incoming X-ray beam and the diffracted beam. A
              diffractometer records intensity at each 2θ angle, usually in degrees.
            </p>
          </HelpTip>
        </p>
        <p class="placeholder-note">File upload arrives in a later stage.</p>
        <div class="field">
          <label for="xrd-sample-name">Sample name</label>
          <input
            id="xrd-sample-name"
            type="text"
            autocomplete="off"
            value={data.sampleName}
            onInput={(event) => update({ sampleName: event.currentTarget.value })}
          />
          <p class="field-hint">Used in table headings and exported file names.</p>
        </div>
      </>
    ),
    validate: (data) => (data.sampleName.trim() === '' ? 'Enter a sample name to continue.' : null),
  },
  { id: 'clean', title: 'Clean data', render: () => <LaterStage /> },
  { id: 'material', title: 'Choose material', render: () => <LaterStage /> },
  { id: 'phases', title: 'Compare reference phases', render: () => <LaterStage /> },
  { id: 'fit', title: 'Fit peaks', render: () => <LaterStage /> },
  { id: 'instrument', title: 'Instrument correction', render: () => <LaterStage /> },
  { id: 'results', title: 'Results tables', render: () => <LaterStage /> },
  { id: 'export', title: 'Export', render: () => <LaterStage /> },
];
