import type { WizardStep } from '../../ui/wizard/types';
import { AxesStep } from './AxesStep';
import { CurveStep } from './CurveStep';
import type { ShotData } from './data';
import { calibrationOf } from './digitized';
import { ImageStep } from './ImageStep';
import { SendStep } from './SendStep';
import type { DigitizeTarget } from './target';

/** The graph-image wizard, worded for the target tool. */
export function digitizeSteps({ axes, tool, figure }: DigitizeTarget): WizardStep<ShotData>[] {
  return [
    {
      id: 'image',
      title: 'Image',
      guide: [
        `Drop or paste a picture of ${figure}, or press Choose an image.`,
        'Turn it if needed and crop to the plot area.',
        'Then press Next.',
      ],
      render: (context) => <ImageStep {...context} />,
      validate: (data) =>
        data.image === null
          ? 'Load a figure image to continue. "Try with example data" draws a synthetic one.'
          : null,
    },
    {
      id: 'axes',
      title: 'Calibrate axes',
      guide: [
        `Click two labelled ticks on the ${axes.x} axis and type their values.`,
        `Do the same for two ticks on the ${axes.y} axis.`,
        "Check the dashed grid matches the figure's ticks, then press Next.",
      ],
      render: (context) => <AxesStep {...context} />,
      validate: (data) => {
        const outcome = calibrationOf(data, axes);
        return 'problem' in outcome ? outcome.problem : null;
      },
    },
    {
      id: 'curve',
      title: 'Trace the curve',
      guide: [
        'Click on the curve to trace it.',
        'Fix mistakes with erase boxes or by adding points.',
        'Check the trace on the image, then press Next.',
      ],
      render: (context) => <CurveStep {...context} />,
      validate: (data) =>
        data.curve.color === null ? 'Click on the curve to digitize it before going on.' : null,
    },
    {
      id: 'send',
      title: `Add to ${tool}`,
      guide: [
        `Check the name, then add the curve to your ${tool} analysis.`,
        'It is marked as approximate, because it was read from a picture.',
      ],
      render: (context) => <SendStep {...context} />,
    },
  ];
}
