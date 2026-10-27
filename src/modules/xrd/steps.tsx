import type { WizardStep } from '../../ui/wizard/types';
import type { XrdData } from './data';
import { CleanStep } from './CleanStep';
import { ExportStep } from './ExportStep';
import { FitStep } from './FitStep';
import { instrumentProblem } from './instrument';
import { InstrumentStep } from './InstrumentStep';
import { MaterialStep } from './MaterialStep';
import { PhasesStep } from './PhasesStep';
import { ResultsStep } from './ResultsStep';
import { RietveldStep } from './RietveldStep';
import { UploadStep } from './UploadStep';

/** The XRD wizard in its final order. */
export const xrdSteps: readonly WizardStep<XrdData>[] = [
  {
    id: 'upload',
    title: 'Upload',
    guide: [
      'Drop your pattern files on the box, or press Choose files (.xy, .csv, .xrdml, .ras and more).',
      'Only have a picture of a graph? Press Use a graph image.',
      'No file at hand? Press Try with example data.',
      "Check each pattern's name and 2θ range in its card, then press Next.",
    ],
    render: (context) => <UploadStep {...context} />,
    validate: (data) =>
      data.patterns.length === 0
        ? 'Load at least one pattern to continue. "Try with example data" loads a synthetic one.'
        : null,
  },
  {
    id: 'clean',
    title: 'Clean data',
    guide: [
      'Every switch is optional: turn on only what your data need.',
      'Usually: remove the background, and strip Kα2 if your peaks look doubled at high angles.',
      'Watch the plot: it shows the result at once. Then press Next.',
    ],
    render: (context) => <CleanStep {...context} />,
  },
  {
    id: 'material',
    title: 'Choose material',
    guide: [
      'Click the elements of your sample in the periodic table, or type a formula (BiVO4) or COD number in the search bar.',
      'Press Search, then Add the structures that might be in your sample.',
      'Have a CIF file? Load it below. You can also skip this step.',
    ],
    render: (context) => <MaterialStep {...context} />,
  },
  {
    id: 'phases',
    title: 'Compare reference phases',
    guide: [
      "Each phase's reference lines are drawn under your pattern; solid lines have a peak in your data, dashed ones do not.",
      'Pick a phase under Compare to draw its lines through your pattern.',
      'Tick Use this phase for the phases that fit, then press Next.',
    ],
    render: (context) => <PhasesStep {...context} />,
  },
  {
    id: 'rietveld',
    title: 'Rietveld refinement (optional)',
    guide: [
      'This step is optional: press Next to skip it.',
      'To refine, keep the cleaned data, tick the phases and press Refine.',
      'Check that the difference curve under the plot is flat, then read the results table.',
    ],
    render: (context) => <RietveldStep {...context} />,
  },
  {
    id: 'fit',
    title: 'Fit peaks',
    guide: [
      'Peaks are found automatically (circles). Move the prominence slider to find more or fewer.',
      'Press Fit peaks. The fit adds peaks it missed and removes noise on its own; read the note it shows.',
      'Check that the residual under the plot is flat. To add or remove a peak by hand, pick Add or Remove above the plot and click.',
    ],
    render: (context) => <FitStep {...context} />,
  },
  {
    id: 'instrument',
    title: 'Instrument correction',
    guide: [
      'Peaks are widened by the instrument too; remove that part for a true crystallite size.',
      'Best: load a standard (LaB₆ or Si) measured on the same instrument. Or type a known instrument width.',
      'No standard? Choose skip: sizes are then lower limits, and the results say so.',
    ],
    render: (context) => <InstrumentStep {...context} />,
    validate: instrumentProblem,
  },
  {
    id: 'results',
    title: 'Results',
    guide: [
      'Read the At a glance box first.',
      'Switch between Size and strain, Phases, (hkl) and lattice, and Texture and crystallinity.',
      'Open a method (arrow) to see its plot and checks. Then press Next to download everything.',
    ],
    render: (context) => <ResultsStep {...context} />,
  },
  {
    id: 'export',
    title: 'Export for your paper',
    guide: [
      'Download the figure as SVG or PNG at the journal width you need.',
      'Copy the methods text and check it against your experiment.',
      'Download the tables (CSV) and the session file, which reopens this analysis later.',
    ],
    render: (context) => <ExportStep {...context} />,
  },
];
