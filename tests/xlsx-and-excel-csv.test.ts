import { describe, expect, it } from 'vitest';
import { importFtirFileAsync, importFtirText } from '../src/core/ftir/import';
import { crc32 } from '../src/core/text/unzip';
import { LEGACY_XLS_ERROR, xlsxToDelimitedText } from '../src/core/text/xlsx';
import { importThermalFileAsync } from '../src/core/thermal/import';
import { importSpectraFileAsync } from '../src/core/uvvis/import';
import { importFileAsync } from '../src/core/xrd/import';

/** Builds a minimal valid stored (uncompressed) ZIP archive for testing .xlsx workbooks. */
function makeZip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const sum = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, sum, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, sum, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const count = Object.keys(files).length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, count, true);
  ev.setUint16(10, count, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of [...localParts, ...centralParts, eocd]) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function makeXlsx(headers: string[], rows: number[][]): Uint8Array {
  const ssXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<sst count="${headers.length}" uniqueCount="${headers.length}">` +
    headers.map((h) => `<si><t>${h}</t></si>`).join('') +
    '</sst>';
  const colLetter = (i: number) => String.fromCharCode(65 + i);
  const headerRow =
    '<row r="1">' +
    headers.map((_, c) => `<c r="${colLetter(c)}1" t="s"><v>${c}</v></c>`).join('') +
    '</row>';
  const dataRows = rows
    .map(
      (r, idx) =>
        `<row r="${idx + 2}">` +
        r.map((v, c) => `<c r="${colLetter(c)}${idx + 2}"><v>${v}</v></c>`).join('') +
        '</row>',
    )
    .join('');
  const sheetXml = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${headerRow}${dataRows}</sheetData></worksheet>`;
  return makeZip({
    'xl/sharedStrings.xml': ssXml,
    'xl/worksheets/sheet1.xml': sheetXml,
  });
}

describe('Zero-dependency .xlsx and Excel-exported CSV import', () => {
  it('reads Excel-exported FTIR CSVs with multiple trailing empty commas, quoted headers, and UTF-8 BOM', () => {
    const lines = [
      '\uFEFF"Wavenumber, cm-1","Transmittance, %",,,',
      ...Array.from({ length: 20 }, (_, i) => `${4000 - i * 100},${95 - i * 0.5},,,`),
    ];
    const res = importFtirText('excel-export.csv', lines.join('\r\n'), 'csv');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.spectra).toHaveLength(1);
      expect(res.spectra[0]?.wavenumber.length).toBe(20);
      expect(res.spectra[0]?.kind).toBe('transmittance');
    }
  });

  it('imports .xlsx workbooks into FTIR, UV-Vis, XRD, and Thermal', async () => {
    // 1. FTIR .xlsx
    const ftirBytes = makeXlsx(
      ['Wavenumber (cm-1)', 'Transmittance (%)'],
      Array.from({ length: 20 }, (_, i) => [4000 - i * 100, 92 - i * 0.4]),
    );
    const tsv = await xlsxToDelimitedText(ftirBytes);
    expect(tsv.ok).toBe(true);
    const ftir = await importFtirFileAsync('sample.xlsx', ftirBytes);
    expect(ftir.ok).toBe(true);
    if (ftir.ok) expect(ftir.spectra[0]?.wavenumber.length).toBe(20);

    // 2. UV-Vis .xlsx
    const uvBytes = makeXlsx(
      ['Wavelength (nm)', 'Absorbance'],
      Array.from({ length: 20 }, (_, i) => [250 + i * 20, 0.1 + i * 0.02]),
    );
    const uv = await importSpectraFileAsync('uv.xlsx', uvBytes);
    expect(uv.ok).toBe(true);
    if (uv.ok) expect(uv.spectra[0]?.wavelengthNm.length).toBe(20);

    // 3. XRD .xlsx
    const xrdBytes = makeXlsx(
      ['2Theta', 'Intensity'],
      Array.from({ length: 25 }, (_, i) => [10 + i * 2, 100 + (i === 10 ? 900 : 0)]),
    );
    const xrd = await importFileAsync('xrd.xlsx', xrdBytes);
    expect(xrd.ok).toBe(true);
    if (xrd.ok) expect(xrd.pattern.twoTheta.length).toBe(25);

    // 4. Thermal .xlsx
    const tgaBytes = makeXlsx(
      ['Temperature (C)', 'Mass (%)'],
      Array.from({ length: 20 }, (_, i) => [50 + i * 25, 100 - i * 1.2]),
    );
    const tga = await importThermalFileAsync(tgaBytes, 'tga.xlsx');
    expect(tga.ok).toBe(true);
    if (tga.ok) expect(tga.table.columns.length).toBe(2);
  });

  it('gives a clear plain-language message for legacy .xls binary files', async () => {
    const fakeXls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x00, 0x00, 0x00]);
    const res = await importFtirFileAsync('old.xls', fakeXls);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(LEGACY_XLS_ERROR);
  });
});
