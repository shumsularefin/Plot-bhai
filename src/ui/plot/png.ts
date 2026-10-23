/*
 * Writes the print resolution into a PNG so word processors and journals see 300 or 600 dpi
 * instead of the 72 or 96 dpi they assume otherwise. PNG layout (from the PNG specification,
 * ISO/IEC 15948): an 8-byte signature, then chunks of [length (4 bytes, big-endian), type
 * (4 ASCII bytes), data, CRC-32 of type + data]. The pHYs chunk holds pixels per unit for x
 * and y (4 bytes each) and a unit byte (1 = metre); it must come before the image data.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as used by PNG (reflected polynomial 0xEDB88320). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE_LENGTH = 8;

/** Returns a copy of the PNG with a pHYs chunk for the given dots per inch (any old one removed). */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: Uint8Array[] = [png.subarray(0, SIGNATURE_LENGTH)];
  // 1 inch = 0.0254 m, so pixels per metre = dpi / 0.0254.
  const perMetre = Math.round(dpi / 0.0254);
  let offset = SIGNATURE_LENGTH;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (type !== 'pHYs') parts.push(png.subarray(offset, end));
    if (type === 'IHDR') parts.push(physChunk(perMetre));
    offset = end;
  }
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function physChunk(perMetre: number): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  return chunk;
}
