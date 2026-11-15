import type { ExportFont } from './export';

/**
 * Figure rules that publishers state for all their journals, so the export can be set up in one
 * click. Only what the publisher's own page says is used; anything a page does not state is left
 * to the user's own setting. A single journal can ask for more, so the screen always says to check
 * the journal's guide. Read on 11 November 2026 and checked by the owner.
 *
 * Not included, because their pages refuse automated reading and could not be checked:
 * ACS (pubs.acs.org/page/4authors/submission/graphics_prep) and RSC
 * (rsc.org, prepare-and-format/figures-graphics-images). TODO: add them once the owner has read
 * the official pages.
 */
export interface JournalStyle {
  label: string;
  /** Printed figure widths the publisher names, mm. */
  widths: readonly { label: string; mm: number }[];
  /** Widths outside this range are outside the publisher's rule, mm. */
  widthRangeMm?: readonly [number, number];
  maxHeightMm?: number;
  font?: ExportFont;
  /** Font size this site sets when the style is chosen, pt. */
  fontSizePt?: number;
  /** Smallest and largest text the publisher allows, pt. */
  minTextPt?: number;
  maxTextPt?: number;
  /** Smallest subscript or superscript the publisher allows, pt. */
  minScriptPt?: number;
  /** Resolution asked for line art (graphs) as a bitmap, dpi. */
  lineArtDpi?: number;
  /** The publisher's rules in plain language, shown on screen. */
  rules: readonly string[];
  source: string;
}

export const JOURNAL_STYLES = {
  /*
   * Elsevier artwork sizing (elsevier.com/about/policies-and-standards/author/
   * artwork-and-media-instructions/artwork-sizing): minimal 30 mm, single column 90 mm,
   * 1.5 column 140 mm, double column (full width) 190 mm. Artwork overview (…/artwork-overview):
   * fonts Arial (or Helvetica), Courier, Symbol, Times (or Times New Roman); "7 pt for normal text
   * and no smaller than 6 pt for subscript and superscript characters", called a rule of thumb;
   * line art 1000 dpi, combination art 500 dpi, halftones 300 dpi; EPS preferred for vector
   * graphics, PDF accepted.
   */
  elsevier: {
    label: 'Elsevier',
    widths: [
      { label: 'Single column', mm: 90 },
      { label: '1.5 column', mm: 140 },
      { label: 'Double column', mm: 190 },
    ],
    widthRangeMm: [30, 190],
    font: 'arial',
    // 7.5 pt keeps the 80 % superscripts (cm⁻¹) at 6 pt, Elsevier's smallest.
    fontSizePt: 7.5,
    minScriptPt: 6,
    lineArtDpi: 1000,
    rules: [
      'Widths: 90 mm single column, 140 mm 1.5 column, 190 mm double column.',
      'Fonts: Arial (or Helvetica), Times (or Times New Roman), Courier or Symbol.',
      'Text about 7 pt; subscripts and superscripts at least 6 pt (a rule of thumb).',
      'Graphs as a bitmap at 1000 dpi; a vector file (EPS preferred, PDF accepted) is better.',
    ],
    source:
      'https://www.elsevier.com/about/policies-and-standards/author/artwork-and-media-instructions/artwork-sizing',
  },
  /*
   * Nature research figure guide (research-figure-guide.nature.com/figures/
   * building-and-exporting-figure-panels/): printed widths 89 mm (single column) and 183 mm
   * (double column), maximum height 170 mm, fonts between 5 pt and 7 pt, standard fonts such as
   * Arial or Helvetica; main figures as vector files with editable layers (.ai, .eps, .pdf).
   * …/preparing-figures-our-specifications/: axis lines and tick marks included, units in
   * parentheses, no background gridlines or drop shadows, RGB colour.
   */
  nature: {
    label: 'Nature',
    widths: [
      { label: 'Single column', mm: 89 },
      { label: 'Double column', mm: 183 },
    ],
    widthRangeMm: [0, 183],
    maxHeightMm: 170,
    font: 'arial',
    fontSizePt: 7,
    minTextPt: 5,
    maxTextPt: 7,
    minScriptPt: 5,
    rules: [
      'Widths: 89 mm single column, 183 mm double column; at most 170 mm high.',
      'Arial or Helvetica, all text between 5 and 7 pt.',
      'Axis lines and tick marks, units in parentheses, no background gridlines, RGB colour.',
      'Main figures as vector files with editable text (.ai, .eps or .pdf): export SVG and save it as PDF or EPS in Inkscape or Illustrator.',
    ],
    source:
      'https://research-figure-guide.nature.com/figures/building-and-exporting-figure-panels/',
  },
  /*
   * Wiley figure preparation (authors.wiley.com/author-resources/Journal-Authors/Prepare/
   * manuscript-preparation-guidelines.html/figure-preparation.html): "between 80mm and 180mm in
   * width and between 300dpi and 600dpi"; line art 600 dpi, PDF preferred. Fonts and sizes are
   * left to each journal, so this style does not change them.
   */
  wiley: {
    label: 'Wiley',
    widths: [
      { label: 'Narrowest', mm: 80 },
      { label: 'Widest', mm: 180 },
    ],
    widthRangeMm: [80, 180],
    lineArtDpi: 600,
    rules: [
      'Width between 80 and 180 mm.',
      'Graphs at 600 dpi; PDF preferred.',
      'Fonts and text size are set by each Wiley journal; check its author guidelines.',
    ],
    source:
      'https://authors.wiley.com/author-resources/Journal-Authors/Prepare/manuscript-preparation-guidelines.html/figure-preparation.html',
  },
} as const satisfies Record<string, JournalStyle>;

export type JournalId = keyof typeof JOURNAL_STYLES;

/** Superscripts such as cm⁻¹ are drawn at this share of the font size (see FtirPlot, uvvis labels). */
export const SCRIPT_SCALE = 0.8;

export interface JournalCheck {
  widthMm: number;
  heightMm: number;
  fontSizePt: number;
}

/** Plain-language problems with the figure against a journal style; empty when it fits. */
export function journalProblems(style: JournalStyle, figure: JournalCheck): string[] {
  const out: string[] = [];
  const { widthRangeMm: range, maxHeightMm, minTextPt, maxTextPt, minScriptPt } = style;
  if (range && (figure.widthMm < range[0] || figure.widthMm > range[1]))
    out.push(
      `${style.label} figures are ${range[0] > 0 ? `${range[0]} to ` : 'up to '}${range[1]} mm wide; this one is ${figure.widthMm} mm.`,
    );
  if (maxHeightMm !== undefined && figure.heightMm > maxHeightMm)
    out.push(
      `${style.label} figures are at most ${maxHeightMm} mm high; this one is ${figure.heightMm} mm.`,
    );
  if (minTextPt !== undefined && figure.fontSizePt < minTextPt)
    out.push(
      `${style.label} text is at least ${minTextPt} pt; the font size is ${figure.fontSizePt} pt.`,
    );
  if (maxTextPt !== undefined && figure.fontSizePt > maxTextPt)
    out.push(
      `${style.label} text is at most ${maxTextPt} pt; the font size is ${figure.fontSizePt} pt.`,
    );
  const script = Math.round(figure.fontSizePt * SCRIPT_SCALE * 100) / 100;
  if (minScriptPt !== undefined && script < minScriptPt)
    out.push(
      `Superscripts such as cm⁻¹ come out at ${script} pt, below ${style.label}'s ${minScriptPt} pt. Raise the font size to at least ${Math.ceil((minScriptPt / SCRIPT_SCALE) * 2) / 2} pt.`,
    );
  return out;
}
