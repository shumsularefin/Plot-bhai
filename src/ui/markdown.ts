/*
 * A reader for the small part of Markdown that docs/validation.md uses: headings, paragraphs,
 * bullet lists, tables and `code` spans. It exists so the public validation page is built from
 * the same file the checks are recorded in, and cannot drift from it.
 */

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

/** Cells of one table line: "| a | b |" gives ["a", "b"]. A bar written "\\|" stays in its cell. */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll('\\|', '|'));
}

/** Splits Markdown text into blocks. Wrapped lines of a paragraph or list item are joined. */
export function parseMarkdown(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let open: MarkdownBlock | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4}) (.+)$/.exec(line);
    if (line.trim() === '') {
      open = null;
    } else if (heading) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] as string).length,
        text: heading[2] as string,
      });
      open = null;
    } else if (line.startsWith('|')) {
      if (open?.kind === 'table') {
        // The line of dashes under the header carries no content.
        if (!/^[|\s:-]+$/.test(line)) open.rows.push(cells(line));
      } else {
        open = { kind: 'table', header: cells(line), rows: [] };
        blocks.push(open);
      }
    } else if (line.startsWith('- ')) {
      if (open?.kind !== 'list') {
        open = { kind: 'list', items: [] };
        blocks.push(open);
      }
      open.items.push(line.slice(2));
    } else if (open?.kind === 'list') {
      open.items[open.items.length - 1] += ` ${line.trim()}`;
    } else if (open?.kind === 'paragraph') {
      open.text += ` ${line.trim()}`;
    } else {
      open = { kind: 'paragraph', text: line.trim() };
      blocks.push(open);
    }
  }
  return blocks;
}

/** Text split at `code` spans: the odd entries are code. */
export function codeSpans(text: string): string[] {
  return text.split('`');
}
