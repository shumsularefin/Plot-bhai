import type { WizardStep } from '../../ui/wizard/types';
import { CleanStep } from './CleanStep';
import type { UvvisData } from './data';
import { PlaceholderStep } from './PlaceholderStep';
import { UploadStep } from './UploadStep';

/** The UV-Vis wizard. Steps 3 and 4 are filled in by sub-stage 8b. */
export const uvvisSteps: readonly WizardStep<UvvisData>[] = [
  {
    id: 'upload',
    title: 'Upload',
    render: (context) => <UploadStep {...context} />,
    validate: (data) =>
      data.spectra.length === 0
        ? 'Load at least one spectrum to continue. "Try with example data" loads synthetic ones.'
        : null,
  },
  {
    id: 'clean',
    title: 'Data type and cleaning',
    render: (context) => <CleanStep {...context} />,
  },
  {
    id: 'bandgap',
    title: 'Band gap',
    render: () => (
      <PlaceholderStep what="The Tauc plot, band gap fit and Urbach energy will be here." />
    ),
  },
  {
    id: 'results',
    title: 'Results and export',
    render: () => (
      <PlaceholderStep what="The results table, figures, methods text and export will be here." />
    ),
  },
];
