import { describe, expect, it } from 'vitest';
import css from '../src/ui/tokens.css?raw';

/** Reads `--name: #rrggbb` declarations from the first block that follows `selector`. */
function colours(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start), css.indexOf('}', start));
  const result: Record<string, string> = {};
  for (const [, name, hex] of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)) {
    if (name && hex) result[name] = hex;
  }
  return result;
}

/** WCAG 2.x relative luminance and contrast ratio, https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum ratio]: 4.5 for text, 3 for non-text UI such as borders.
const PAIRS: [string, string, number][] = [
  ['color-text', 'color-bg', 4.5],
  ['color-text', 'color-surface', 4.5],
  ['color-text', 'color-surface-muted', 4.5],
  ['color-text-muted', 'color-bg', 4.5],
  ['color-text-muted', 'color-surface', 4.5],
  ['color-text-muted', 'color-surface-muted', 4.5],
  ['color-accent', 'color-bg', 4.5],
  ['color-accent', 'color-surface', 4.5],
  ['color-accent-hover', 'color-surface', 4.5],
  ['color-on-accent', 'color-accent', 4.5],
  ['color-on-accent', 'color-accent-hover', 4.5],
  ['color-danger', 'color-surface', 4.5],
  ['color-danger', 'color-bg', 4.5],
  ['color-border-strong', 'color-surface', 3],
  ['color-focus', 'color-bg', 3],
];

describe.each([
  ['light', ':root {'],
  ['dark', ":root[data-theme='dark']"],
])('%s theme colours', (_theme, selector) => {
  const tokens = colours(selector);

  it.each(PAIRS)('%s on %s meets %d:1', (fg, bg, minimum) => {
    const a = tokens[fg];
    const b = tokens[bg];
    expect(a, fg).toBeDefined();
    expect(b, bg).toBeDefined();
    expect(contrast(a as string, b as string)).toBeGreaterThanOrEqual(minimum);
  });
});

it('the dark theme is identical in the media query and the data-theme block', () => {
  expect(colours(":root:not([data-theme='light'])")).toEqual(colours(":root[data-theme='dark']"));
});
