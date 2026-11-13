// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  combinedMethods,
  sampleReportMarkdown,
  type ReportPart,
} from '../src/ui/report/sampleReport';

const xrd: ReportPart = {
  tool: 'XRD',
  data: ['sample.xy'],
  example: false,
  results: [{ title: 'Crystallite size', lines: ['Scherrer: size 20(2) nm'] }],
  methods: 'XRD methods.',
};
const ftir: ReportPart = {
  tool: 'FTIR',
  data: ['Example'],
  example: true,
  results: [],
  methods: 'FTIR methods.\n',
};

describe('sample report', () => {
  it('joins the methods paragraphs in order, one per technique', () => {
    expect(combinedMethods([xrd, ftir])).toBe('XRD methods.\n\nFTIR methods.');
  });

  it('lists each technique with its data and results, unchanged', () => {
    const text = sampleReportMarkdown(' ZnO 500 ', [xrd, ftir], '2026-11-12T00:00:00.000Z');
    expect(text).toContain('# Sample report: ZnO 500\n');
    expect(text).toContain('Techniques: XRD, FTIR.');
    expect(text).toContain(
      '## XRD\n\nData: sample.xy.\n\n### Crystallite size\n\n- Scherrer: size 20(2) nm',
    );
    expect(text).toContain('## FTIR\n\nData: Example.\n\nNo results yet.');
    expect(text).toContain('## Methods\n\nXRD methods.\n\nFTIR methods.\n');
  });

  it('warns about example data and names the technique', () => {
    const text = sampleReportMarkdown('', [xrd, ftir], 'now');
    expect(text).toContain('# Sample report: unnamed sample');
    expect(text).toContain('Warning: FTIR used generated example data, not measurements.');
    expect(sampleReportMarkdown('', [xrd], 'now')).not.toContain('Warning:');
  });
});
