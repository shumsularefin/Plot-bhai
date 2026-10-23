/*
 * Minimal CIF reader for crystal structures, as needed to compute a powder pattern.
 * It reads the first data block only. Values in a loop are kept as text and converted by the
 * helpers below. The format is described in Hall, Allen & Brown, Acta Cryst. A47 (1991)
 * 655–685 (CIF syntax) and the CIF core dictionary (https://www.iucr.org/resources/cif).
 */

/** One data item: text, or a column of text values for a loop. "?" and "." become null. */
type Cell = string | null;

export interface CifBlock {
  name: string;
  /** Single items, keyed by lower-case tag. */
  items: Map<string, Cell>;
  /** Loops: each is a list of rows keyed by lower-case tag. */
  loops: Map<string, Cell>[][];
}

/** Splits CIF text into tokens, keeping quoted strings and semicolon text fields whole. */
function tokenize(text: string): { value: string; quoted: boolean }[] {
  const tokens: { value: string; quoted: boolean }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith(';')) {
      // Semicolon text field: runs to the next line that starts with a semicolon.
      const parts = [line.slice(1)];
      i++;
      while (i < lines.length && !(lines[i] as string).startsWith(';')) {
        parts.push(lines[i] as string);
        i++;
      }
      // The value is the text between the two semicolons, without the line breaks next to them.
      if (parts[0] === '') parts.shift();
      tokens.push({ value: parts.join('\n'), quoted: true });
      continue;
    }
    let p = 0;
    while (p < line.length) {
      const c = line[p] as string;
      if (c === ' ' || c === '\t') {
        p++;
      } else if (c === '#') {
        break;
      } else if (c === "'" || c === '"') {
        // A quote ends the string only when followed by white space or the end of the line.
        let q = p + 1;
        while (
          q < line.length &&
          !(line[q] === c && (q + 1 === line.length || /\s/.test(line[q + 1] as string)))
        ) {
          q++;
        }
        tokens.push({ value: line.slice(p + 1, q), quoted: true });
        p = q + 1;
      } else {
        let q = p;
        while (q < line.length && !/\s/.test(line[q] as string)) q++;
        tokens.push({ value: line.slice(p, q), quoted: false });
        p = q;
      }
    }
  }
  return tokens;
}

/** Parses the first data block of a CIF. */
export function parseCif(text: string): CifBlock {
  const tokens = tokenize(text);
  const block: CifBlock = { name: '', items: new Map(), loops: [] };
  const asCell = (t: { value: string; quoted: boolean }): Cell =>
    !t.quoted && (t.value === '?' || t.value === '.') ? null : t.value;
  const isKeyword = (t: { value: string; quoted: boolean }) =>
    !t.quoted && /^(data_|loop_$|save_|global_$|stop_$)/i.test(t.value);
  let seenBlock = false;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i] as { value: string; quoted: boolean };
    if (!t.quoted && /^data_/i.test(t.value)) {
      if (seenBlock) break;
      seenBlock = true;
      block.name = t.value.slice(5);
      i++;
    } else if (!t.quoted && /^loop_$/i.test(t.value)) {
      i++;
      const tags: string[] = [];
      while (i < tokens.length && !tokens[i]?.quoted && tokens[i]?.value.startsWith('_')) {
        tags.push((tokens[i] as { value: string }).value.toLowerCase());
        i++;
      }
      const values: Cell[] = [];
      while (i < tokens.length) {
        const v = tokens[i] as { value: string; quoted: boolean };
        if (isKeyword(v) || (!v.quoted && v.value.startsWith('_'))) break;
        values.push(asCell(v));
        i++;
      }
      const rows: Map<string, Cell>[] = [];
      for (let r = 0; tags.length > 0 && r + tags.length <= values.length; r += tags.length) {
        rows.push(new Map(tags.map((tag, k) => [tag, values[r + k] as Cell])));
      }
      block.loops.push(rows);
    } else if (!t.quoted && t.value.startsWith('_')) {
      const v = tokens[i + 1];
      if (v) block.items.set(t.value.toLowerCase(), asCell(v));
      i += 2;
    } else {
      i++;
    }
  }
  return block;
}

/** Number from CIF text, ignoring a trailing standard uncertainty: "5.4309(3)" → 5.4309. */
export function cifNumber(value: Cell | undefined): number | null {
  if (value === null || value === undefined) return null;
  const match = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(value.trim());
  return match ? Number(match[0]) : null;
}

/** Rows of the first loop that contains the given tag. */
export function loopWith(block: CifBlock, tag: string): Map<string, Cell>[] {
  return block.loops.find((rows) => rows[0]?.has(tag)) ?? [];
}
