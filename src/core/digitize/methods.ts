/**
 * The methods-text sentence for data digitized from figure images, or null when none were.
 * `noun` names one data set and several, for example ['spectrum', 'spectra'].
 */
export function digitizedSentence(
  count: number,
  total: number,
  noun: readonly [string, string],
): string | null {
  if (count <= 0) return null;
  const which =
    count === total
      ? count === 1
        ? `The ${noun[0]} was`
        : `All ${noun[1]} were`
      : `${count} of the ${total} ${noun[1]} ${count === 1 ? 'was' : 'were'}`;
  return `${which} digitized from figure images, so the positions, values and widths derived from ${count === 1 ? 'it' : 'them'} are approximate.`;
}
