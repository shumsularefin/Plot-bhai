/** Byte-level helpers shared by the file readers. */

/** Decodes file bytes to text, honouring a UTF-16 or UTF-8 byte-order mark. */
export function decodeText(bytes: Uint8Array, fallback: 'utf-8' | 'latin1'): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  return new TextDecoder(fallback).decode(bytes);
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function hasNulBytes(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, 4096);
  for (let i = 0; i < end; i++) if (bytes[i] === 0) return true;
  return false;
}
