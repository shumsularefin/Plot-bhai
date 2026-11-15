/** JSON helpers shared by the tools' session files. */

/**
 * JSON cannot hold typed arrays or non-finite numbers, so these are written as small tagged
 * objects and restored on import: Float64Array as $f64, Int32Array (particle outlines as runs)
 * as $i32, and ±Infinity or NaN as $num.
 */
export function sessionReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Float64Array) return { $f64: Array.from(value, encodeNumber) };
  if (value instanceof Int32Array) return { $i32: Array.from(value) };
  if (typeof value === 'number' && !Number.isFinite(value)) return { $num: encodeNumber(value) };
  return value;
}

const encodeNumber = (v: number): number | string => (Number.isFinite(v) ? v : String(v));
const decodeNumber = (v: unknown): number => (typeof v === 'string' ? Number(v) : (v as number));

export function sessionReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object') {
    const tagged = value as { $f64?: unknown; $i32?: unknown; $num?: unknown };
    if (Array.isArray(tagged.$f64)) return Float64Array.from(tagged.$f64, decodeNumber);
    if (Array.isArray(tagged.$i32)) return Int32Array.from(tagged.$i32 as number[]);
    if ('$num' in tagged) return decodeNumber(tagged.$num);
  }
  return value;
}
