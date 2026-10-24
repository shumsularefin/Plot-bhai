export interface Labels {
  /** 0 for background, otherwise 1 … count. */
  labels: Int32Array;
  count: number;
}

/** Connected components of the foreground (8-connected: pixels touching at a corner are joined). */
export function connectedComponents(mask: Uint8Array, width: number, height: number): Labels {
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  let count = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    count++;
    let top = 0;
    stack[top++] = start;
    labels[start] = count;
    while (top > 0) {
      const i = stack[--top] as number;
      const x = i % width;
      const y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
          const j = yy * width + xx;
          if (mask[j] && !labels[j]) {
            labels[j] = count;
            stack[top++] = j;
          }
        }
      }
    }
  }
  return { labels, count };
}
