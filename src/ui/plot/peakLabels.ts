/** A text label above a peak, for example its (hkl) index. x and y are in data units. */
export interface PeakLabel {
  x: number;
  /** Height of the peak top; the label sits above it. */
  y: number;
  text: string;
  /** Drawn in bold (the strongest peak). */
  strong?: boolean;
}

/** Peak labels plus the key that explains them, for example "Anatase, COD 9009086". */
export interface PeakLabelSet {
  labels: readonly PeakLabel[];
  key: readonly string[];
}

/** Rows of labels that may be stacked above the tallest peak before they overlap the frame. */
export const LABEL_ROWS = 4;

/** Height in px reserved above the data for peak labels, from the font size. */
export function labelRoom(fontSize: number): number {
  return LABEL_ROWS * fontSize * 1.3;
}

/** Rough text width in px; digits and brackets in Arial or Times are about 0.55 em wide. */
export function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}

export interface LabelItem {
  /** Peak position and peak top, px from the plot's top left corner. */
  x: number;
  y: number;
  width: number;
}

export interface PlacedLabel {
  /** Centre of the text and its baseline, px. */
  x: number;
  baseline: number;
  /** Stacked above a neighbour, so a leader line joins it to the peak. */
  leader: boolean;
}

/**
 * Places labels above their peaks without overlap. The labels of the highest peaks are placed
 * first, as close to the peak as possible; a label that would overlap one already placed moves
 * up one row at a time (and gets a leader line down to its peak) until it is free. Rows are
 * lineHeight apart; a label never goes above minY (px), where the last row is used even if it
 * overlaps. Returns one placement per item, in the order given.
 */
export function placeLabels(
  items: readonly LabelItem[],
  lineHeight: number,
  minY = 0,
): PlacedLabel[] {
  const gap = lineHeight * 0.2;
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const result = new Array<PlacedLabel>(items.length);
  const order = items
    .map((_, i) => i)
    .sort((a, b) => {
      const A = items[a] as LabelItem;
      const B = items[b] as LabelItem;
      return A.y - B.y || A.x - B.x;
    });
  for (const i of order) {
    const item = items[i] as LabelItem;
    const left = item.x - item.width / 2;
    const right = item.x + item.width / 2;
    let row = 0;
    let box = { left, right, top: 0, bottom: 0 };
    for (;;) {
      const bottom = item.y - gap - row * lineHeight;
      box = { left, right, top: bottom - lineHeight, bottom };
      const free = placed.every(
        (p) =>
          p.right <= box.left || p.left >= box.right || p.bottom <= box.top || p.top >= box.bottom,
      );
      const higher = bottom - lineHeight * 2 >= minY;
      if (free || !higher) break;
      row++;
    }
    placed.push(box);
    result[i] = { x: item.x, baseline: box.bottom - lineHeight * 0.2, leader: row > 0 };
  }
  return result;
}
