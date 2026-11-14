// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importFileAsync } from '../src/core/xrd/import';

const folder = new URL('./fixtures-real/', import.meta.url);
// XRD files only: other tools' real files are in subfolders (uvvis/) with their own tests.
const files = readdirSync(folder, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name !== 'README.md')
  .map((entry) => entry.name);

describe('real XRD files in tests/fixtures-real', () => {
  // Reported as skipped (not passed) until a real file is added.
  if (files.length === 0)
    it.skip('no real file has been added yet (see the README there)', () => {});

  it.each(files)('%s loads without an error', async (name) => {
    const result = await importFileAsync(name, new Uint8Array(readFileSync(new URL(name, folder))));
    expect(result.ok ? 'loaded' : result.error).toBe('loaded');
  });
});
