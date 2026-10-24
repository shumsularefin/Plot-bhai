// End-to-end check of the XRD wizard in a real browser: example data through every step to
// export, then a session-file round trip. Run `npm run build` first; this starts `vite preview`.
// Playwright is not a project dependency: it is found in the global Node modules (see README).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const globalRoots = [process.env.PLAYWRIGHT_PATH, '/opt/node-tools/node_modules'].filter(Boolean);
function loadPlaywright() {
  for (const root of [undefined, ...globalRoots]) {
    try {
      return root
        ? require(require.resolve('playwright', { paths: [root] }))
        : require('playwright');
    } catch {
      /* try the next place */
    }
  }
  throw new Error('Playwright was not found. Install it globally or set PLAYWRIGHT_PATH.');
}
const { chromium } = loadPlaywright();

const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
const stop = () => server.kill();
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('The preview server did not start. Did you run npm run build?');
}

const executablePath = process.env.CHROMIUM_PATH;
await waitForServer();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));

const heading = () => page.locator('#wizard-step-heading');
const next = async (expected) => {
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.waitForFunction(
    (text) => document.querySelector('#wizard-step-heading')?.textContent === text,
    expected,
    { timeout: 10_000 },
  );
};
const step = (n) => console.log(`ok  ${n}`);

/** Example data through steps 1 to 7 and on to Export. */
async function walkToExport(log) {
  const note = log ? step : () => {};
  // 1 Upload
  await page.getByRole('button', { name: 'Try with example data' }).click();
  await page.getByText('Synthetic example A').first().waitFor();
  note('1 Upload: example data loaded');
  await next('Clean data');

  // 2 Clean data
  await page.locator('.plot-panel svg').first().waitFor({ timeout: 15_000 });
  note('2 Clean data: pattern drawn');
  await next('Choose material');

  // 3 Choose material
  await page.getByRole('searchbox').fill('ZnO');
  await page.locator('.family-button').first().click();
  note('3 Choose material: ZnO chosen');
  await next('Compare reference phases');

  // 4 Compare phases
  await page.getByLabel('Use this phase').first().check();
  note('4 Compare phases: first phase used');
  await next('Fit peaks');

  // 5 Fit peaks
  const fit = page.locator('.fit-actions .btn-primary');
  await fit.waitFor();
  await page.waitForFunction(
    () => !document.querySelector('.fit-actions .btn-primary')?.disabled,
    null,
    {
      timeout: 30_000,
    },
  );
  await fit.click();
  await page.locator('.peak-table').waitFor({ timeout: 60_000 });
  note('5 Fit peaks: peak table shown');
  await next('Instrument correction');

  // 6 Instrument correction: skip, which is allowed and warned about in the results.
  await page.getByLabel(/skip/i).first().check();
  note('6 Instrument correction: skipped');
  await next('Results tables');

  // 7 Results
  await page.getByText('Summary').first().waitFor({ timeout: 20_000 });
  note('7 Results tables shown');
  await next('Export');
}

try {
  await page.goto(`http://localhost:${PORT}/#/xrd`);
  await heading().waitFor();
  assert.equal(await heading().textContent(), 'Upload');

  await walkToExport(true);

  // 8 Export
  const text = await page.getByTestId('methods-text').textContent();
  assert.match(text, /Cu Kα/);
  assert.match(text, /generated example data/);
  assert.doesNotMatch(text, /NaN|undefined/);
  step('8 Export: methods text from the real settings');

  await page.getByRole('button', { name: 'Download SVG' }).waitFor({ timeout: 20_000 });
  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download SVG' }).click(),
  ]);
  const svg = readFileSync(await svgDownload.path(), 'utf8');
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /COD \d+/);
  step('8 Export: SVG figure with reference lanes and COD IDs');

  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'PNG 300 dpi' }).click(),
  ]);
  const png = readFileSync(await pngDownload.path());
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  step('8 Export: PNG 300 dpi');

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'All tables in one CSV' }).click(),
  ]);
  const csv = readFileSync(await csvDownload.path(), 'utf8');
  assert.match(csv, /## .*-peaks/);
  step('8 Export: all tables in one CSV');

  const [sessionDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download session (JSON)' }).click(),
  ]);
  const sessionPath = await sessionDownload.path();
  const sessionText = readFileSync(sessionPath, 'utf8');
  const first = JSON.parse(sessionText);
  assert.equal(first.app, 'xrd-toolkit');
  assert.ok(first.state.data.patterns.length >= 1);
  step('8 Export: session file written');

  // Round trip: reload (persisted state is kept), clear, import, export again, compare.
  await page.evaluate(() =>
    indexedDB.databases().then((dbs) => dbs.forEach((d) => indexedDB.deleteDatabase(d.name))),
  );
  await page.goto(`http://localhost:${PORT}/#/xrd`);
  await page.reload();
  await heading().waitFor();
  assert.equal(await heading().textContent(), 'Upload', 'state should be cleared');
  await walkToExport(false);
  await page.getByLabel('Session file to open').setInputFiles(sessionPath);
  await page.getByText(/Session restored/).waitFor();
  const [again] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download session (JSON)' }).click(),
  ]);
  const second = JSON.parse(readFileSync(await again.path(), 'utf8'));
  assert.deepEqual(second.state.data, first.state.data);
  step('8 Export: session JSON round-trips');

  // A damaged file is refused with a plain message.
  await page.getByLabel('Session file to open').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello": 1}'),
  });
  await page.getByText('This is not an XRD Toolkit session file.').waitFor();
  step('8 Export: a foreign JSON file is refused');

  assert.deepEqual(problems, [], `browser errors: ${problems.join('; ')}`);
  console.log('E2E passed.');
} catch (error) {
  await page.screenshot({ path: 'e2e-failure.png', fullPage: true }).catch(() => {});
  console.error('E2E failed:', error);
  console.error('Screenshot: e2e-failure.png');
  process.exitCode = 1;
} finally {
  await browser.close();
  stop();
}
