import type { Atmosphere, SampleCategory } from '../../core/thermal/types';

export const ATMOSPHERES: Record<Atmosphere, string> = {
  nitrogen: 'Nitrogen',
  argon: 'Argon',
  air: 'Air',
  oxygen: 'Oxygen',
  other: 'Other gas',
};

export const CATEGORIES: Record<SampleCategory, string> = {
  unspecified: 'Not specified',
  'hydroxide-or-salt': 'Metal hydroxide or salt precursor',
  polymer: 'Polymer',
  biomass: 'Biomass or plant extract',
  composite: 'Composite',
  other: 'Other',
};
