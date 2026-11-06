/**
 * A small ZIP reader for the packed instrument formats (Bruker .brml, Rigaku .rasx), which are
 * ordinary ZIP archives of XML and text files.
 *
 * Layout follows PKWARE's APPNOTE.TXT (sections 4.3.6, 4.3.7, 4.3.12 and 4.3.16): the
 * end-of-central-directory record at the end of the file points to the central directory,
 * whose entries give each file's name, compression method, CRC-32, sizes and the offset of its
 * local header; the data follows the local header. Only "stored" (method 0) and "deflate"
 * (method 8) entries are read, which is what both instrument formats use. Deflate data is
 * unpacked by the browser's own DecompressionStream, so no library is needed. ZIP64 and
 * encrypted archives are refused with a plain message. Every unpacked entry is checked against
 * its stored size and CRC-32, so a damaged file is reported rather than read wrongly.
 */

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  crc32: number;
  compressedSize: number;
  size: number;
  /** Offset of the entry's local header in the archive. */
  localOffset: number;
  encrypted: boolean;
}

export class ZipError extends Error {}

/** Entries larger than this are refused: the files read here are far smaller. */
const MAX_ENTRY_BYTES = 200 * 1024 * 1024;

const u16 = (b: Uint8Array, at: number) => (b[at] as number) | ((b[at + 1] as number) << 8);
const u32 = (b: Uint8Array, at: number) =>
  ((b[at] as number) |
    ((b[at + 1] as number) << 8) |
    ((b[at + 2] as number) << 16) |
    ((b[at + 3] as number) << 24)) >>>
  0;

/** Lists the entries of a ZIP archive from its central directory. */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  // The end record is 22 bytes plus a comment of up to 65535 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new ZipError('The packed file is incomplete (no ZIP directory found).');
  const count = u16(bytes, end + 10);
  const offset = u32(bytes, end + 16);
  if (count === 0xffff || offset === 0xffffffff) {
    throw new ZipError('The packed file uses ZIP64, which this site cannot read.');
  }
  const entries: ZipEntry[] = [];
  let at = offset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || u32(bytes, at) !== 0x02014b50) {
      throw new ZipError('The packed file is damaged (bad ZIP directory).');
    }
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    entries.push({
      name: new TextDecoder('utf-8').decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      method: u16(bytes, at + 10),
      crc32: u32(bytes, at + 16),
      compressedSize: u32(bytes, at + 20),
      size: u32(bytes, at + 24),
      localOffset: u32(bytes, at + 42),
      encrypted: (u16(bytes, at + 8) & 1) === 1,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 as used by ZIP (polynomial 0xEDB88320, reflected, initial and final XOR 0xFFFFFFFF). */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crcTable[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipError(
      'This browser cannot unpack the file. Use a current version of Chrome, Edge, Firefox or Safari.',
    );
  }
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // Written without awaiting, so reading below can drain the stream at the same time.
  const written = writer
    .write(data as Uint8Array<ArrayBuffer>)
    .then(() => writer.close())
    .catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > MAX_ENTRY_BYTES) throw new ZipError('A file inside the archive is too large.');
    }
  } catch (error) {
    if (error instanceof ZipError) throw error;
    throw new ZipError('The packed file is damaged (its compressed data cannot be unpacked).');
  }
  await written;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Unpacks one entry and checks its size and CRC-32. */
export async function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new ZipError('The packed file is password protected.');
  if (entry.size > MAX_ENTRY_BYTES) throw new ZipError('A file inside the archive is too large.');
  const at = entry.localOffset;
  if (at + 30 > bytes.length || u32(bytes, at) !== 0x04034b50) {
    throw new ZipError('The packed file is damaged (bad ZIP entry header).');
  }
  const start = at + 30 + u16(bytes, at + 26) + u16(bytes, at + 28);
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new ZipError('The packed file is incomplete.');
  const packed = bytes.subarray(start, end);
  let data: Uint8Array;
  if (entry.method === 0) data = packed;
  else if (entry.method === 8) data = await inflateRaw(packed);
  else {
    throw new ZipError(
      `The packed file uses ZIP compression method ${entry.method}, which this site cannot read.`,
    );
  }
  if (data.length !== entry.size || crc32(data) !== entry.crc32) {
    throw new ZipError(`The packed file is damaged (${entry.name} fails its checksum).`);
  }
  return data;
}

/** Reads the named entries (exact names) into a map; names not present are left out. */
export async function readZipFiles(
  bytes: Uint8Array,
  wanted: (name: string) => boolean,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const entry of listZip(bytes)) {
    if (wanted(entry.name)) out.set(entry.name, await readZipEntry(bytes, entry));
  }
  return out;
}
