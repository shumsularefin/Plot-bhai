// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importFile } from '../src/core/xrd/import';

const folder = new URL('./fixtures-real/', import.meta.url);
const files = readdirSync(folder).filter((name) => name !== 'README.md');

describe('real instrument files in tests/fixtures-real', () => {
  // Reported as skipped (not passed) until a real file is added.
  if (files.length === 0)
    it.skip('no real file has been added yet (see the README there)', () => {});

  it.each(files)('%s loads without an error', (name) => {
    const result = importFile(name, new Uint8Array(readFileSync(new URL(name, folder))));
    expect(result.ok ? 'loaded' : result.error).toBe('loaded');
  });
});
