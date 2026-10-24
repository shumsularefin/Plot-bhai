/** "(101)", or "(1 0 -1)" when an index is negative or has two digits. */
export function formatHkl(hkl: readonly (readonly [number, number, number])[]): string {
  return hkl
    .map((h) => {
      const plain = h.every((v) => v >= 0 && v <= 9);
      return `(${plain ? h.join('') : h.join(' ')})`;
    })
    .join(' / ');
}
