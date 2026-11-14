import { BROAD_CM, intensityText, MEDIUM_PERCENT, STRONG_PERCENT } from '../../core/ftir/peakShape';
import type { TablePeak } from './analysis';
import { valueIn } from './quantity';

/** How a peak got into the table, as shown in tables, CSV files and the record. */
export const ORIGIN_TEXT: Record<TablePeak['origin'], string> = {
  picked: 'picked',
  hand: 'added by hand',
  shoulder: 'shoulder (accepted by hand)',
};

export const peakCsvNote = (prominencePercent: number, percentT: boolean) =>
  `FTIR peaks picked on the processed absorbance with a minimum prominence of ${prominencePercent} % of the absorbance range, plus peaks added or removed by hand. FWHM and area are measured above a straight local baseline through the lowest point on each side of the band; flagged widths and areas overlap a neighbour and are unreliable. Intensity classes: strong >= ${STRONG_PERCENT} %, medium >= ${MEDIUM_PERCENT} % of the highest band above its local baseline, broad FWHM >= ${BROAD_CM} cm-1 (thresholds chosen by this site).${percentT ? ' Transmittance (%) = 100 x 10^(-absorbance) of the processed spectrum.' : ''}`;

/** CSV columns of a peak table. */
export function peakColumns(percentT: boolean) {
  return [
    { header: 'Wavenumber (cm-1)', value: (p: TablePeak) => p.wavenumber },
    { header: 'Absorbance (processed)', value: (p: TablePeak) => p.height },
    ...(percentT
      ? [
          {
            header: 'Transmittance (%)',
            value: (p: TablePeak) => valueIn('transmittance', p.height),
          },
        ]
      : []),
    { header: 'Relative intensity (%)', value: (p: TablePeak) => p.relative },
    { header: 'Prominence', value: (p: TablePeak) => p.prominence },
    { header: 'Height above local baseline', value: (p: TablePeak) => p.shape?.heightAbove ?? '' },
    { header: 'FWHM (cm-1)', value: (p: TablePeak) => p.shape?.fwhm ?? '' },
    { header: 'Area (absorbance cm-1)', value: (p: TablePeak) => p.shape?.area ?? '' },
    {
      header: 'Intensity class',
      value: (p: TablePeak) => (p.intensity ? intensityText(p.intensity) : ''),
    },
    { header: 'Overlaps a neighbour', value: (p: TablePeak) => (p.overlap ? 'yes' : 'no') },
    { header: 'Origin', value: (p: TablePeak) => ORIGIN_TEXT[p.origin] },
  ];
}
