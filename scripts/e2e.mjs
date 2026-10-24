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

  // UV-Vis: example data, blank subtraction, Tauc band gap, results, methods text.
  await page.goto(`http://localhost:${PORT}/#/uvvis`);
  await heading().waitFor();
  await page.getByRole('button', { name: 'Try with example data' }).click();
  await page.getByText('Example absorbance (synthetic)').first().waitFor();
  await next('Data type and cleaning');
  await page.getByRole('switch', { name: 'Blank subtraction' }).check();
  await page.getByLabel('Blank spectrum').selectOption({ label: 'Example blank (synthetic)' });
  await next('Band gap');
  const gapText = await page.getByLabel('Band gap result').textContent();
  const gap = Number(/(\d\.\d+)\s*±/.exec(gapText)?.[1]);
  assert.ok(Math.abs(gap - 3.2) < 0.02, `band gap ${gap} should be near the 3.2 eV of the example`);
  step('UV-Vis: Tauc band gap of the example is near 3.2 eV');
  await next('Results and export');
  const uvText = await page.getByLabel('Methods paragraph').inputValue();
  assert.match(uvText, /generated example data/);
  assert.match(uvText, /Tauc/);
  const [uvCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download results (CSV)' }).click(),
  ]);
  assert.match(readFileSync(await uvCsv.path(), 'utf8'), /Eg \(eV\)/);
  step('UV-Vis: results CSV and methods text');

  // FTIR: example data, baseline, peaks, accepted assignments, results, methods text, session.
  await page.goto(`http://localhost:${PORT}/#/ftir`);
  await heading().waitFor();
  await page.getByRole('button', { name: 'Try with example data' }).click();
  await page.getByText('Example absorbance (synthetic)').first().waitFor();
  await next('Clean data');
  await page.getByRole('switch', { name: 'Baseline correction' }).check();
  await next('Pick peaks');
  await page.locator('.peak-table tbody tr').first().waitFor();
  assert.equal(await page.locator('.peak-table tbody tr').count(), 6);
  step('FTIR: six peaks found in the example spectrum');
  await next('Assign groups');
  await page.getByRole('button', { name: /Accept the best suggestion for every peak/ }).click();
  await next('Results and export');
  const ftirText = await page.getByLabel('Methods paragraph').inputValue();
  assert.match(ftirText, /generated example data/);
  assert.match(ftirText, /not proof of the groups present/);
  const [ftirCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download peaks (CSV)' }).click(),
  ]);
  assert.match(readFileSync(await ftirCsv.path(), 'utf8'), /Assignment/);
  const [ftirSession] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download session (JSON)' }).click(),
  ]);
  const ftirFile = JSON.parse(readFileSync(await ftirSession.path(), 'utf8'));
  assert.equal(ftirFile.kind, 'ftir-session');
  assert.ok(Object.values(ftirFile.state.data.assignments).flat().length > 0);
  step('FTIR: peaks, accepted assignments, methods text and session file');

  // Particle size: example image, the example's scale bar, a typed circle and a drawn one.
  await page.goto(`http://localhost:${PORT}/#/particles`);
  await heading().waitFor();
  await page.getByRole('button', { name: 'Try with example data' }).click();
  await page.getByText('Shown at').waitFor({ timeout: 15_000 });
  await next('Crop and scale');
  await page.getByRole('button', { name: /Use the example's scale bar/ }).click();
  await page.getByText(/2 pixels per nm/).waitFor();
  // Keep the data bar out of the analysis area, then detect the 12 example particles.
  await page.getByLabel(/Remove a strip from the bottom/).fill('96');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await next('Detect particles');
  await page.locator('button.btn-primary', { hasText: 'Detect particles' }).click();
  await page.getByText(/12 of 12 particles shown/).waitFor({ timeout: 30_000 });
  const detected = await page
    .locator('.peak-table tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) => parseFloat(row.querySelectorAll('td, th')[3].textContent)),
    );
  const truth = [60, 70, 80, 90, 100, 110, 120, 80, 90, 100, 70, 85]
    .map((d) => d / 2)
    .sort((a, b) => a - b);
  detected
    .sort((a, b) => a - b)
    .forEach((d, i) => {
      assert.ok(
        Math.abs(d - truth[i]) / truth[i] < 0.03,
        `particle ${i}: ${d} nm should be near ${truth[i]} nm`,
      );
    });
  step('Particles: 12 particles detected, every diameter within 3 % of the true one');
  await next('Measure by hand');
  await page.getByText('Enter coordinates instead of drawing').click();
  await page.getByLabel('First point x (px)').fill('300');
  await page.getByLabel('First point y (px)').fill('300');
  await page.getByLabel('Second point x (px)').fill('400');
  await page.getByLabel('Second point y (px)').fill('300');
  await page.getByRole('button', { name: 'Add the measurement' }).click();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.locator('.image-viewer').scrollIntoViewIfNeeded();
  const viewerBox = await page.locator('.image-viewer').boundingBox();
  const fitScale = Math.min(viewerBox.width / 1024, viewerBox.height / 864);
  const at = (x, y) => [
    viewerBox.x + (viewerBox.width - 1024 * fitScale) / 2 + x * fitScale,
    viewerBox.y + (viewerBox.height - 864 * fitScale) / 2 + y * fitScale,
  ];
  const [x0, y0] = at(500, 400);
  const [x1, y1] = at(600, 400);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 5 });
  await page.mouse.up();
  await page.getByText('Measurements (2)').waitFor();
  const cells = await page.locator('.peak-table tbody tr').allInnerTexts();
  assert.match(cells[0], /Circle\s+50 nm/);
  assert.match(cells[1], /Line\s+5\d(\.\d+)? nm/);
  step('Particles: example image, scale, a typed circle (50 nm) and a drawn line (about 50 nm)');

  // Distribution: the true diameters are 30 … 60 nm (mean 43.96 nm, median 43.75 nm by hand).
  await next('Distribution and export');
  await page.getByText(/Only 12 particles/).waitFor();
  const numbers = await page.locator('.dist-step .peak-table tbody tr').first().allInnerTexts();
  const [count, mean, , median] = numbers[0].split('\t').map(parseFloat);
  assert.equal(count, 12);
  assert.ok(Math.abs(mean - 43.958) / 43.958 < 0.03, `mean ${mean} nm`);
  assert.ok(Math.abs(median - 43.75) / 43.75 < 0.03, `median ${median} nm`);
  const [histogramSvg] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download SVG' }).click(),
  ]);
  assert.match(readFileSync(await histogramSvg.path(), 'utf8'), /Number of particles/);
  const [summaryCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Summary (CSV)' }).click(),
  ]);
  assert.match(readFileSync(await summaryCsv.path(), 'utf8'), /D90/);
  const [annotated] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Annotated image (PNG)' }).click(),
  ]);
  assert.equal(
    readFileSync(await annotated.path())
      .subarray(1, 4)
      .toString(),
    'PNG',
  );
  await page.getByRole('button', { name: 'Save this image for pooling' }).click();
  await page.getByText(/example-particles-synthetic.png: 12 particles \(nm\)/).waitFor();
  assert.match(await page.getByLabel('Methods paragraph').inputValue(), /generated example/);
  step('Particles: distribution numbers, histogram SVG, summary CSV, annotated PNG, pooling');

  // Thermal: example run, then a 10,000-point semicolon/decimal-comma file typed up here.
  await page.goto(`http://localhost:${PORT}/#/thermal`);
  await heading().waitFor();
  await page.getByRole('button', { name: 'Try with example data' }).click();
  await page.getByRole('heading', { name: 'Describe the run', exact: true }).waitFor();
  await next('Clean data');
  await page.getByText(/points were left out/).waitFor();
  await next('Mass loss steps');
  const stepRows = page.locator('tr', { has: page.getByLabel(/start \(°C\)/) });
  await stepRows.first().waitFor();
  assert.equal(await stepRows.count(), 3);
  const firstLoss = async () => Number(await stepRows.first().locator('td').nth(5).textContent());
  const before = await firstLoss();
  assert.ok(before > 8.5 && before < 9.1, `first step loses ${before} %`);
  // A real drag of the first limit marker changes the number live.
  const marker = page.locator('svg circle').first();
  const box = await marker.boundingBox();
  assert.ok(box, 'a draggable limit marker is drawn');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.getByText(/You edited the step limits by hand/).waitFor();
  assert.notEqual(await firstLoss(), before);
  await page.getByRole('button', { name: 'Use the automatic limits again' }).click();
  step('Thermal: example run, ramp cut, three steps, marker drag updates the loss live');

  await page
    .getByRole('button', { name: 'Start over' })
    .click()
    .catch(() => {});
  const rows = [];
  for (let i = 0; i < 10000; i++) {
    const t = 30 + (i * 770) / 9999;
    const loss = 40 / (1 + Math.exp(-(t - 350) / 15));
    rows.push(
      `${t.toFixed(3).replace('.', ',')};${(i * 0.077).toFixed(3).replace('.', ',')};${(10 - loss / 10).toFixed(4).replace('.', ',')}`,
    );
  }
  const bigText = `Sample;big\nTemp./°C;Time/min;Mass/mg\n${rows.join('\n')}\n`;
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Start over' }).click();
  await heading().waitFor();
  await page.locator('input[type=file]').setInputFiles({
    name: 'big.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(bigText, 'latin1'),
  });
  await page.getByRole('heading', { name: 'Describe the run', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Time column (optional)').inputValue(), '1');
  const started = Date.now();
  await next('Clean data');
  await next('Mass loss steps');
  await stepRows.first().waitFor();
  const elapsed = Date.now() - started;
  assert.equal(await stepRows.count(), 1);
  assert.ok(elapsed < 4000, `10,000 points took ${elapsed} ms to reach the steps table`);
  step(`Thermal: 10,000-point semicolon file with decimal commas, steps table after ${elapsed} ms`);

  // No horizontal page scroll at phone width.
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    // Plots resize through a ResizeObserver, which needs a frame or two.
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px at ${width}px`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  step('Thermal: no horizontal page scroll at 360 and 1280 px');

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
