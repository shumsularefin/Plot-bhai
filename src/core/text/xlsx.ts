import { isZip } from './bytes';
import { listZip, readZipEntry, ZipError } from './unzip';

/**
 * Minimal, zero-dependency Excel (.xlsx) reader built on src/core/text/unzip.ts.
 *
 * Reads the first worksheet (xl/worksheets/sheet1.xml, or the first xl/worksheets/sheet*.xml)
 * together with xl/sharedStrings.xml when present, and serializes rows as tab-separated text so
 * any tool's delimited-table importer can read them directly. Runs in both main thread and Web
 * Workers (no DOMParser dependency).
 */

export type XlsxResult = { ok: true; text: string; sheet: string } | { ok: false; error: string };

export const LEGACY_XLS_ERROR =
  'Legacy .xls (Excel 97–2003) binary files cannot be read directly. In Excel, save the workbook as .xlsx or .csv and load that file.';

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const n = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    if (code.startsWith('#')) {
      const n = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return XML_ENTITIES[code] ?? m;
  });
}

/** Converts an Excel column letters prefix ("A" -> 0, "B" -> 1, "AA" -> 26) to a 0-based index. */
function columnIndex(ref: string): number {
  let idx = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) idx = idx * 26 + (c - 64);
    else if (c >= 97 && c <= 122) idx = idx * 26 + (c - 96);
    else break;
  }
  return idx - 1;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1] ?? '';
    let text = '';
    let tm: RegExpExecArray | null;
    tRe.lastIndex = 0;
    while ((tm = tRe.exec(inner)) !== null) {
      text += decodeXml(tm[1] ?? '');
    }
    out.push(text);
  }
  return out;
}

function parseSheetToTsv(xml: string, sharedStrings: readonly string[]): string {
  const lines: string[] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
  const refAttr = /\br="([A-Za-z]+)\d+"/;
  const typeAttr = /\bt="([^"]+)"/;
  const vTag = /<v\b[^>]*>([\s\S]*?)<\/v>/;
  const tTag = /<t\b[^>]*>([\s\S]*?)<\/t>/g;

  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowBody = rm[1] ?? '';
    const cells: string[] = [];
    let nextCol = 0;
    let cm: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(rowBody)) !== null) {
      const attrs = cm[1] ?? '';
      const body = cm[2] ?? '';
      const rMatch = refAttr.exec(attrs);
      const col = rMatch ? columnIndex(rMatch[1] as string) : nextCol;
      if (col < 0) continue;
      nextCol = col + 1;
      while (cells.length <= col) cells.push('');
      const type = typeAttr.exec(attrs)?.[1] ?? '';
      let value = '';
      if (type === 's') {
        const vm = vTag.exec(body);
        const idx = vm ? Number.parseInt((vm[1] ?? '').trim(), 10) : -1;
        value = idx >= 0 && idx < sharedStrings.length ? (sharedStrings[idx] as string) : '';
      } else if (type === 'inlineStr') {
        let tm: RegExpExecArray | null;
        tTag.lastIndex = 0;
        while ((tm = tTag.exec(body)) !== null) value += decodeXml(tm[1] ?? '');
      } else {
        const vm = vTag.exec(body);
        value = vm ? decodeXml((vm[1] ?? '').trim()) : '';
      }
      cells[col] = value.replace(/[\t\r\n]+/g, ' ').trim();
    }
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    if (cells.some((c) => c !== '')) lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

/** True when a ZIP archive's entry names look like an Excel .xlsx workbook. */
export function looksLikeXlsxEntries(names: readonly string[]): boolean {
  return names.some((n) => /^xl\/worksheets\/sheet\d*\.xml$/i.test(n));
}

/** True when bytes are a ZIP archive whose contents are an Excel .xlsx workbook. */
export function isXlsxZip(bytes: Uint8Array): boolean {
  if (!isZip(bytes)) return false;
  try {
    return looksLikeXlsxEntries(listZip(bytes).map((e) => e.name));
  } catch {
    return false;
  }
}

/** Unpacks the first worksheet of an .xlsx file into tab-separated text. */
export async function xlsxToDelimitedText(bytes: Uint8Array): Promise<XlsxResult> {
  if (!isZip(bytes)) return { ok: false, error: 'This file is not a valid .xlsx workbook.' };
  try {
    const entries = listZip(bytes);
    const sheetEntry =
      entries.find((e) => e.name.toLowerCase() === 'xl/worksheets/sheet1.xml') ??
      entries
        .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!sheetEntry) {
      return { ok: false, error: 'This .xlsx workbook contains no readable worksheet.' };
    }
    const decoder = new TextDecoder('utf-8');
    const sharedEntry = entries.find((e) => e.name.toLowerCase() === 'xl/sharedstrings.xml');
    const sharedStrings = sharedEntry
      ? parseSharedStrings(decoder.decode(await readZipEntry(bytes, sharedEntry)))
      : [];
    const sheetXml = decoder.decode(await readZipEntry(bytes, sheetEntry));
    const text = parseSheetToTsv(sheetXml, sharedStrings);
    if (text.trim() === '') {
      return { ok: false, error: 'The first sheet of this .xlsx workbook is empty.' };
    }
    return { ok: true, text, sheet: sheetEntry.name };
  } catch (error) {
    if (error instanceof ZipError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not read this .xlsx workbook. Try exporting as .csv.' };
  }
}
