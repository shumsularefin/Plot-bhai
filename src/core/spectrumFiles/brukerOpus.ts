import { dataView, evenAxis, latin1 } from './types';
import type { DataMessage } from '../xrd/types';
import type { InstrumentResult, InstrumentYKind } from './types';

/*
 * Bruker OPUS reader (.0, .1, … files). Written against the real file in
 * tests/fixtures-real/spectra (provenance in its README) and checked point by point against the
 * text export (.dpt) that OPUS wrote for the same measurement. Layout, little-endian:
 *
 *   0    magic 0A 0A FE FE       12 directory offset (i32)       20 number of blocks (i32)
 *   directory: 12-byte entries: data type (u8), channel (u8), text type (u8), (u8),
 *              length in 4-byte words (i32), offset (i32)
 *   a parameter block is a list of: name (3 letters and NUL), type (i16: 0 i32, 1 f64,
 *              2 to 4 text), size in 2-byte words (i16), value; it ends at "END"
 *
 * The final spectrum is the data block of type 15 ("AB"). The held file has two of them; the last
 * one is the spectrum OPUS exported to .dpt for the same measurement (the earlier one differs by
 * up to 0.017), so the last block is read. Its parameters are the first block of type 31 with
 * the same channel after it, or, when there is none, the type-0 entry just before the data. NPT is the
 * number of points, FXV and LXV the first and last x, CSF a scale factor for y, DPF the number
 * format (1 = float32, the only one held in a real file), DXU the x unit ("WN" = cm⁻¹, as in the
 * held file; an older parameter entry may leave it out). x runs evenly from FXV to LXV.
 *
 * The acquisition block (type 48) names the result spectrum in PLF; it is used as the y kind
 * only for the values a real file confirms: "AB" absorbance and "RFL" reflectance.
 */

const MAGIC = [0x0a, 0x0a, 0xfe, 0xfe];
const KINDS: Record<string, InstrumentYKind> = { AB: 'absorbance', RFL: 'reflectance' };

export const looksLikeBrukerOpus = (bytes: Uint8Array): boolean =>
  MAGIC.every((b, i) => bytes[i] === b);

interface Block {
  type: number;
  channel: number;
  words: number;
  offset: number;
}

function parameters(bytes: Uint8Array, block: Block): Map<string, number | string> {
  const view = dataView(bytes);
  const out = new Map<string, number | string>();
  const end = Math.min(bytes.length, block.offset + 4 * block.words);
  let at = block.offset;
  while (at + 8 <= end) {
    const name = latin1(bytes, at, 3);
    if (name === 'END' || name === '') break;
    const type = view.getInt16(at + 4, true);
    const size = 2 * view.getInt16(at + 6, true);
    const value = at + 8;
    if (size < 0 || value + size > end) break;
    if (type === 0 && size >= 4) out.set(name, view.getInt32(value, true));
    else if (type === 1 && size >= 8) out.set(name, view.getFloat64(value, true));
    else if (type >= 2 && type <= 4) out.set(name, latin1(bytes, value, size));
    at = value + size;
  }
  return out;
}

export function parseBrukerOpus(bytes: Uint8Array): InstrumentResult {
  const view = dataView(bytes);
  const damaged = { ok: false as const, error: 'This Bruker OPUS file is damaged or incomplete.' };
  if (bytes.length < 24) return damaged;
  const directory = view.getInt32(12, true);
  const count = view.getInt32(20, true);
  if (directory < 24 || count < 1 || directory + 12 * count > bytes.length) return damaged;
  const blocks: Block[] = [];
  for (let i = 0; i < count; i++) {
    const at = directory + 12 * i;
    blocks.push({
      type: bytes[at] as number,
      channel: bytes[at + 1] as number,
      words: view.getInt32(at + 4, true),
      offset: view.getInt32(at + 8, true),
    });
  }
  let index = -1;
  blocks.forEach((b, i) => {
    if (b.type === 15) index = i;
  });
  const data = blocks[index];
  if (!data) {
    return {
      ok: false,
      error:
        'This OPUS file holds no final spectrum (no absorbance or transmittance block), only raw single-channel data or interferograms. In OPUS, calculate the spectrum and save it, or export it as .dpt, then load that file.',
    };
  }
  const before = blocks[index - 1];
  const parameterBlock =
    blocks.find((b, i) => i > index && b.type === 31 && b.channel === data.channel) ??
    (before && before.type === 0 && before.channel === 0 ? before : undefined);
  if (!parameterBlock) return damaged;
  const p = parameters(bytes, parameterBlock);
  const points = p.get('NPT');
  const first = p.get('FXV');
  const last = p.get('LXV');
  const format = p.get('DPF') ?? 1;
  const scale = p.get('CSF') ?? 1;
  const unit = p.get('DXU');
  if (typeof points !== 'number' || typeof first !== 'number' || typeof last !== 'number') {
    return damaged;
  }
  if (format !== 1) {
    return {
      ok: false,
      error: `This OPUS file stores its values in number format ${String(format)}, which this site cannot read yet. In OPUS, export the spectrum as .dpt, then load that file.`,
    };
  }
  if (points < 2 || points > data.words || data.offset + 4 * points > bytes.length) return damaged;
  const factor = typeof scale === 'number' && scale !== 0 ? scale : 1;
  const y = new Float64Array(points);
  for (let i = 0; i < points; i++) y[i] = view.getFloat32(data.offset + 4 * i, true) * factor;

  const acquisition = blocks.find((b) => b.type === 48 && b.channel === 0);
  const result = acquisition ? parameters(bytes, acquisition).get('PLF') : undefined;
  const yKind = typeof result === 'string' ? KINDS[result] : undefined;
  const notes: DataMessage[] = [];
  if (unit === undefined) {
    notes.push({
      level: 'info',
      text: 'The OPUS file does not state the x unit, so it was read as wavenumber (cm⁻¹). Check the axis range below.',
    });
  }
  const wavenumber = unit === undefined || unit === 'WN';
  const sample = blocks.find((b) => b.type === 160);
  const title = sample ? parameters(bytes, sample).get('SNM') : undefined;
  return {
    ok: true,
    file: {
      format: 'Bruker OPUS',
      title: typeof title === 'string' ? title : '',
      xUnit: wavenumber ? 'wavenumber' : 'other',
      xLabel: wavenumber ? 'wavenumber (cm⁻¹)' : `x unit ${String(unit)}`,
      ...(yKind && { yKind }),
      yLabel: typeof result === 'string' ? result : 'not stated',
      spectra: [{ x: evenAxis(first, last, points), y }],
      notes,
    },
  };
}
