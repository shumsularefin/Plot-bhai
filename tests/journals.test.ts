import { describe, expect, it } from 'vitest';
import { JOURNAL_STYLES, journalProblems, SCRIPT_SCALE } from '../src/ui/plot/journals';

describe('journal styles', () => {
  it('sets a font size that meets each publisher’s own text and superscript limits', () => {
    for (const style of Object.values(JOURNAL_STYLES)) {
      const fontSizePt = 'fontSizePt' in style ? style.fontSizePt : 8;
      for (const w of style.widths) {
        const height = 'maxHeightMm' in style ? style.maxHeightMm : 80;
        expect(journalProblems(style, { widthMm: w.mm, heightMm: height, fontSizePt })).toEqual([]);
      }
    }
  });

  it('flags a figure that breaks a rule, in plain language', () => {
    const nature = JOURNAL_STYLES.nature;
    const problems = journalProblems(nature, { widthMm: 200, heightMm: 180, fontSizePt: 8 });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('183 mm');
    expect(problems[1]).toContain('170 mm');
    expect(problems[2]).toContain('7 pt');
  });

  it('asks for a font size that brings superscripts to the smallest size allowed', () => {
    const [problem] = journalProblems(JOURNAL_STYLES.elsevier, {
      widthMm: 90,
      heightMm: 65,
      fontSizePt: 7,
    });
    expect(problem).toContain(`${(7 * SCRIPT_SCALE).toFixed(1)} pt`);
    expect(problem).toContain('7.5 pt');
  });
});
