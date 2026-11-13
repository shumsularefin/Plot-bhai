// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { codeSpans, parseMarkdown } from '../src/ui/markdown';

describe('parseMarkdown', () => {
  it('reads headings, wrapped paragraphs, lists and tables', () => {
    const blocks = parseMarkdown(
      [
        '# Title',
        '',
        'First line',
        'second line.',
        '',
        '| Method | Result |',
        '| ------ | ------ |',
        '| A `x`  | pass   |',
        '',
        'Open:',
        '',
        '- one item',
        '  continued',
        '- two',
      ].join('\n'),
    );
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'paragraph', text: 'First line second line.' },
      { kind: 'table', header: ['Method', 'Result'], rows: [['A `x`', 'pass']] },
      { kind: 'paragraph', text: 'Open:' },
      { kind: 'list', items: ['one item continued', 'two'] },
    ]);
  });

  it('marks code spans', () => {
    expect(codeSpans('run `npm test` now')).toEqual(['run ', 'npm test', ' now']);
  });

  it('reads the whole validation record: every table row has as many cells as its header', () => {
    const blocks = parseMarkdown(readFileSync('docs/validation.md', 'utf8'));
    const tables = blocks.filter((b) => b.kind === 'table');
    expect(tables.length).toBeGreaterThanOrEqual(6);
    for (const table of tables)
      for (const row of table.rows) expect(row).toHaveLength(table.header.length);
    expect(
      blocks.filter((b) => b.kind === 'heading' && b.level === 2).length,
    ).toBeGreaterThanOrEqual(6);
  });
});
