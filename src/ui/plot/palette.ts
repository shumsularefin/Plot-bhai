/**
 * Plot colours for exported figures, which cannot use CSS variables. Same order and values as
 * --plot-1 … --plot-8 in tokens.css (Okabe and Ito, "Color Universal Design", 2008), with
 * black as the eighth colour. tests/plot.test.ts keeps the two lists in sync.
 */
export const PRINT_COLORS = [
  '#0072b2',
  '#e69f00',
  '#009e73',
  '#d55e00',
  '#56b4e9',
  '#cc79a7',
  '#f0e442',
  '#000000',
] as const;

export const MAX_SERIES = PRINT_COLORS.length;
