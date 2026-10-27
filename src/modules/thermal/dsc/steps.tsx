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
    guide: [
      'Drop your DSC file on the box, or press Choose a file. Or press Try with example data.',
      'Check the columns and the heat flow sign convention (exo up or exo down).',
      'Fill in the sample mass and run details, then press Next.',
    ],
    render: (context) => <DscUploadStep {...context} />,
    validate: dscUploadProblem,
  },
  {
    id: 'clean',
    title: 'Clean data',
    guide: [
      'Pick the ramp to analyse (for example the second heating).',
      'Optional: limit the temperature range and smooth.',
      'Then press Next.',
    ],
    render: (context) => <DscCleanStep {...context} />,
  },
  {
    id: 'events',
    title: 'Baseline and events',
    guide: [
      'Peaks (melting, crystallisation, reactions) are found automatically.',
      "Drag the markers to set each event's limits, and choose the baseline type.",
      'Check onset, peak and enthalpy in the table, then press Next.',
    ],
    render: (context) => <DscEventsStep {...context} />,
  },
  {
    id: 'glass',
    title: 'Glass transition and crystallinity',
    guide: [
      'A glass transition is a step, not a peak. Set the windows before and after it.',
      'Read Tg and the heat capacity change.',
      'Optional: polymer crystallinity from the melting enthalpy.',
    ],
    render: (context) => <DscGlassStep {...context} />,
  },
  {
    id: 'combined',
    title: 'Combined interpretation',
    guide: [
      'Heat flow and mass are read together on one temperature axis.',
      'Accept or reject the ranked suggestions, or write your own.',
      'Everything here is guidance, not a result.',
    ],
    render: (context) => <DscCombinedStep {...context} />,
  },
  {
    id: 'results',
    title: 'Results',
    guide: [
      'Check the events and glass transition tables.',
      'Download the CSV files and the figure, and copy the methods text.',
      'Save the session file to continue later.',
    ],
    render: (context) => <DscResultsStep {...context} />,
  },
];
