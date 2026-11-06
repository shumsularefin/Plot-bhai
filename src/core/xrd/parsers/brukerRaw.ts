import type { DataMessage, ParseResult } from '../types';

/*
 * Bruker .raw reader, version 4 only (files starting "RAW4.00", written by DIFFRAC.SUITE and
 * its converters). Layout, all little-endian, taken from two independent readers that agree on
 * every offset used here: GSAS-II (imports/G2pwd_BrukerRAW.py) and geddes (src/bruker.rs).
 *
 *   0     "RAW4.00" signature
 *   61    header segments, each: u32 type, u32 length (bytes, including these 8)
 *           type 10: text field, name at +12 (24 bytes), value at +36
 *           type 30: X-ray source, Kα average, Kα1, Kα2, Kβ (f64) at +72, +80, +88, +96
 *   a segment of type 0 or 160 starts a range (scan):
 *     +32   scan type, 24 bytes of text ("Locked Coupled", …)
 *     +72   start angle, f64, degrees       +80  step, f64, degrees      +88  points, u32
 *     +136  bytes per data record, u32      +140 length of the range's extra header, u32
 *     +160  extra header, then the data: one record per point, intensity = first f32
 *
 * The angle of point i is start + i·step. GSAS-II reads the intensities as packed f32 values,
 * which is wrong when a record is longer than 4 bytes; geddes steps by the record size, and so
 * does this reader. Versions 1 to 3 have different layouts and no real test file is held for
 * them, so they are refused with a plain message rather than guessed.
 */

/** Scan types whose angle axis is 2θ (the list GSAS-II accepts). */
const TWO_THETA_SCANS = ['locked coupled', 'unlocked coupled', 'detector scan'];

export function looksLikeBrukerRaw(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, 3) === 'RAW';
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let s = '';
  for (let i = at; i < Math.min(bytes.length, at + length); i++) {
    const c = bytes[i] as number;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

export function parseBrukerRaw(bytes: Uint8Array): ParseResult {
  const signature = ascii(bytes, 0, 7);
  if (signature !== 'RAW4.00') {
    const version = signature === 'RAW1.01' ? 'version 3' : 'an older version';
    return {
      ok: false,
      error: `This Bruker .raw file is ${version}, which this site cannot read yet (only version 4 is read). In DIFFRAC.EVA or PowDLL, save it as .xy or .brml, then load that file.`,
    };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fits = (at: number, length: number) => at >= 0 && at + length <= bytes.length;
  const damaged = { ok: false as const, error: 'This Bruker .raw file is damaged or incomplete.' };

  const metadata: { key: string; value: string }[] = [];
  let wavelengthFromFileA: number | undefined;
  const ranges: {
    scanType: string;
    start: number;
    step: number;
    points: number;
    stride: number;
    data: number;
  }[] = [];
  let at = 61;
  while (at < bytes.length) {
    if (!fits(at, 8)) return damaged;
    const type = view.getUint32(at, true);
    if (type === 0 || type === 160) {
      if (!fits(at, 160)) return damaged;
      const points = view.getUint32(at + 88, true);
      const stride = view.getUint32(at + 136, true);
      const extra = view.getUint32(at + 140, true);
      const data = at + 160 + extra;
      if (stride < 4 || stride % 4 !== 0 || points === 0 || !fits(data, points * stride)) {
        return damaged;
      }
      ranges.push({
        scanType: ascii(bytes, at + 32, 24),
        start: view.getFloat64(at + 72, true),
        step: view.getFloat64(at + 80, true),
        points,
        stride,
        data,
      });
      at = data + points * stride;
      continue;
    }
    const length = view.getUint32(at + 4, true);
    if (length < 8 || !fits(at, length)) return damaged;
    if (type === 10 && length > 36) {
      const key = ascii(bytes, at + 12, 24);
      const value = ascii(bytes, at + 36, length - 36);
      if (key && value && key !== 'UTF') metadata.push({ key: titleCase(key), value });
    } else if (type === 30 && length >= 104) {
      const kAlpha1 = view.getFloat64(at + 80, true);
      if (Number.isFinite(kAlpha1) && kAlpha1 > 0) {
        // Stored as f64 but sometimes written from an f32 (1.5405999422…): round to 6 decimals.
        wavelengthFromFileA = Number(kAlpha1.toFixed(6));
      }
      const anode = ascii(bytes, at + 116, 4);
      if (anode) metadata.push({ key: 'Anode', value: anode });
    }
    at += length;
  }

  const range = ranges[0];
  if (!range) return { ok: false, error: 'This Bruker .raw file contains no scan.' };
  if (!TWO_THETA_SCANS.includes(range.scanType.toLowerCase())) {
    return {
      ok: false,
      error: `This Bruker .raw scan is a "${range.scanType}" scan, which does not move 2θ, so it is not a powder pattern.`,
    };
  }
  if (!Number.isFinite(range.start) || !Number.isFinite(range.step) || range.step === 0) {
    return damaged;
  }
  const twoTheta: number[] = new Array(range.points);
  const intensity: number[] = new Array(range.points);
  for (let i = 0; i < range.points; i++) {
    twoTheta[i] = range.start + i * range.step;
    intensity[i] = view.getFloat32(range.data + i * range.stride, true);
  }
  metadata.push({ key: 'Scan type', value: range.scanType });

  const notes: DataMessage[] = [];
  if (ranges.length > 1) {
    notes.push({
      level: 'warning',
      text: `This file contains ${ranges.length} scans. Only the first was loaded.`,
    });
  }
  return {
    ok: true,
    scan: {
      twoTheta,
      intensity,
      ...(wavelengthFromFileA !== undefined && { wavelengthFromFileA }),
      metadata,
      notes,
    },
  };
}

function titleCase(key: string): string {
  return key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ');
}
