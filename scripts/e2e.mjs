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

/** Example data through steps 1 to 8 and on to Export. */
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
  // A CIF file, so the run needs no network (the online COD search is tested with a stub).
  await page
    .locator('input[type=file][accept*=".cif"]')
    .setInputFiles('scripts/cif-cache/1577381.cif');
  await page
    .getByRole('list', { name: 'Candidate phases' })
    .getByRole('listitem')
    .first()
    .waitFor({ timeout: 20_000 });
  note('3 Choose material: ZnO (COD 1577381) loaded from its CIF');
  await next('Compare reference phases');

  // 4 Compare phases
  await page.getByLabel('Use this phase').first().check();
  note('4 Compare phases: first phase used');
  await next('Rietveld refinement (optional)');

  // 5 Rietveld refinement of the candidate (optional; run once to check it works in a worker).
  await page.getByRole('button', { name: 'Refine', exact: true }).click();
  await page.getByText('Refinement results (estimates)').waitFor({ timeout: 60_000 });
  const rwp = await page.locator('.result-summary dd').first().textContent();
  assert.match(rwp ?? '', /^\d+\.\d\d %$/);
  note(`5 Rietveld: refined, Rwp ${rwp}`);
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
  note('6 Fit peaks: peak table shown');
  await next('Instrument correction');

  // 6 Instrument correction: skip, which is allowed and warned about in the results.
  await page.getByLabel(/skip/i).first().check();
  note('7 Instrument correction: skipped');
  await next('Results');

  // 7 Results
  await page.getByText('Summary').first().waitFor({ timeout: 20_000 });
  note('8 Results shown');
  await next('Export for your paper');
}

try {
  await page.goto(`http://localhost:${PORT}/#/xrd`);
  await heading().waitFor();
  assert.equal(await heading().textContent(), 'Upload');

  await walkToExport(true);

  // 9 Export
  const text = await page.getByTestId('methods-text').textContent();
  assert.match(text, /Cu Kα/);
  assert.match(text, /generated example data/);
  assert.doesNotMatch(text, /NaN|undefined/);
  step('9 Export: methods text from the real settings');

  await page.getByRole('button', { name: 'Download SVG' }).waitFor({ timeout: 20_000 });
  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download SVG' }).click(),
  ]);
  const svg = readFileSync(await svgDownload.path(), 'utf8');
  assert.match(svg, /^<\?xml/);
  assert.match(svg, /COD \d+/);
  step('9 Export: SVG figure with reference lanes and COD IDs');

  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'PNG 300 dpi' }).click(),
  ]);
  const png = readFileSync(await pngDownload.path());
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  step('9 Export: PNG 300 dpi');

  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'All tables in one CSV' }).click(),
  ]);
  const csv = readFileSync(await csvDownload.path(), 'utf8');
  assert.match(csv, /## .*-peaks/);
  step('9 Export: all tables in one CSV');

  const [sessionDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download session (JSON)' }).click(),
  ]);
  const sessionPath = await sessionDownload.path();
  const sessionText = readFileSync(sessionPath, 'utf8');
  const first = JSON.parse(sessionText);
  assert.equal(first.app, 'xrd-toolkit');
  assert.ok(first.state.data.patterns.length >= 1);
  step('9 Export: session file written');

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
  step('9 Export: session JSON round-trips');

  // A damaged file is refused with a plain message.
  await page.getByLabel('Session file to open').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello": 1}'),
  });
  await page.getByText('This is not a Plot Bhai XRD session file.').waitFor();
  step('9 Export: a foreign JSON file is refused');

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

  // UV-Vis concentration and kinetics: made-up dye with k = 0.02 1/min and 0.18 L/(mg cm).
  await page.getByText('Concentration and kinetics').first().click();
  await page.getByRole('button', { name: 'Try with example data' }).click();
  await next('Wavelength');
  await next('Results and export');
  const kText = (await page.getByText(/^k = /).first().textContent()) ?? '';
  const k = Number(/k = ([\d.]+)/.exec(kText)?.[1]);
  assert.ok(Math.abs(k - 0.02) < 0.001, `rate constant ${k} should be near the made-up 0.02`);
  const [kinCsvUv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download kinetics (CSV)' }).click(),
  ]);
  assert.match(readFileSync(await kinCsvUv.path(), 'utf8'), /C\/C0/);
  await page.getByText('Band gap and spectra').first().click();
  step('UV-Vis concentration: example, k near 0.02 1/min, kinetics CSV');

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
  // The automatic finder must put the ends on the tick centres: 200 px, as drawn.
  await page.getByRole('button', { name: 'Find the scale bar automatically' }).click();
  await page.getByText(/Found a white bar/).waitFor();
  await page.getByText(/The bar you drew is 200 pixels long/).waitFor();
  await page.getByLabel('Length of the bar').fill('100');
  await page.getByText(/2 pixels per nm/).waitFor();
  step('Particles: scale bar found automatically, 200 px from tick to tick');
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
  // Hand measuring is part of the detection step: a typed line and a drawn one.
  await page.getByText('Enter coordinates instead of drawing').click();
  await page.getByLabel('First point x (px)').fill('300');
  await page.getByLabel('First point y (px)').fill('300');
  await page.getByLabel('Second point x (px)').fill('400');
  await page.getByLabel('Second point y (px)').fill('300');
  await page.getByRole('button', { name: 'Add the line' }).click();
  await page.getByRole('button', { name: 'Add a line', exact: true }).click();
  await page.locator('.image-viewer').scrollIntoViewIfNeeded();
  const viewerBox = await page.locator('.image-viewer').boundingBox();
  // The viewer opens fitted to the crop: the 1024 × 864 image without its bottom 96 px.
  const fitScale = Math.min(viewerBox.width / 1024, viewerBox.height / 768);
  const at = (x, y) => [
    viewerBox.x + (viewerBox.width - 1024 * fitScale) / 2 + x * fitScale,
    viewerBox.y + (viewerBox.height - 768 * fitScale) / 2 + y * fitScale,
  ];
  const [x0, y0] = at(500, 400);
  const [x1, y1] = at(600, 400);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 5 });
  await page.mouse.up();
  await page.getByText('Measured by hand (2)').waitFor();
  await page.getByLabel('Show sizes in').selectOption('nm');
  const hand = page.locator('section[aria-labelledby="hand-title"] tbody tr');
  const cells = await hand.allInnerTexts();
  assert.match(cells[0], /Line\s+50 nm/);
  assert.match(cells[1], /Line\s+5\d(\.\d+)? nm/);
  await page.getByText('12 of 12 particles shown').waitFor();
  step('Particles: hand lines in the detection step, typed (50 nm) and drawn (about 50 nm)');

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
  // Area fraction of the 12 discs (Σπr² = 75,497 px²) in the 1024 × 768 analysis area: 9.600 %.
  const stereo = page.locator('section[aria-labelledby="dist-stereology"] .peak-table tbody td');
  const fraction = parseFloat(await stereo.first().innerText());
  assert.ok(Math.abs(fraction - 9.6) / 9.6 < 0.03, `area fraction ${fraction} %`);
  await page.getByLabel('Crystallite size from XRD (nm)').fill('20');
  await page.getByText(/Estimate, not a proof/).waitFor();
  step('Particles: area fraction within 3 % of the true 9.60 %, XRD size comparison');
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

  // Steps 4 to 6: suggestions, calcination, results, session file round trip.
  await next('Assign events');
  await page.getByText(/TGA alone cannot identify the evolved species/).waitFor();
  const firstCard = page.getByRole('article').first();
  await firstCard.getByRole('button', { name: 'Accept this' }).first().click();
  await firstCard.getByText(/Your choice:/).waitFor();
  await page.getByLabel('Compare with step').selectOption('1');
  await page.getByText(/Difference, measured/).waitFor();
  step('Thermal: suggestions listed, one accepted, theoretical loss compared');
  await next('Calcination suggestion');
  await page.getByText(/not an optimal temperature/).waitFor();
  const minimum = await page.getByText(/Lowest temperature worth trying/).textContent();
  assert.match(minimum ?? '', /\d{3} °C/);
  step(`Thermal: calcination suggestion shown (${minimum?.slice(0, 50)})`);
  await next('Results and export');
  const acceptedEvents = await page.locator('table tbody tr').first().textContent();
  assert.ok(!/not assigned/.test(acceptedEvents ?? ''), 'accepted event is in the results table');
  assert.match(await page.getByLabel('Methods paragraph').inputValue(), /generated example data/);
  const [session] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download session (JSON)' }).click(),
  ]);
  const saved = JSON.parse(readFileSync(await session.path(), 'utf8'));
  assert.equal(saved.kind, 'thermal-session');
  assert.equal(Object.keys(saved.state.data.assignments).length, 1);
  step('Thermal: results table, methods text and session file');

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

  // DSC: switch technique, example run, events, glass transition, results with the convention.
  await page.getByText('DSC (heat flow)').click();
  await heading().waitFor();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText(/Load a run to continue/).waitFor();
  await page.getByRole('button', { name: 'Try with example data' }).click();
  await page.getByRole('heading', { name: 'Describe the run', exact: true }).waitFor();
  await next('Clean data');
  assert.equal(await page.getByLabel('Ramp').locator('option').count(), 3);
  await next('Baseline and events');
  await page.getByRole('heading', { name: /Event 2: endothermic/ }).waitFor();
  await page.getByText(/DSC alone cannot tell what happened/).waitFor();
  await page.getByRole('button', { name: 'Accept this' }).first().click();
  await next('Glass transition and crystallinity');
  const tg = await page
    .locator('tr', { has: page.getByText('Tg, midpoint (°C)') })
    .locator('td')
    .textContent();
  assert.ok(Math.abs(Number(tg) - 60) < 2, `Tg ${tg} is near the made-up 60 °C`);
  await page
    .locator('label', { hasText: 'ΔH0 of the 100 % crystalline polymer' })
    .locator('input')
    .fill('100');
  await page.getByText(/Xc ≈/).waitFor();
  await next('Combined interpretation');
  await page.getByText(/There is no mass curve/).waitFor();
  await next('Results');
  await page
    .getByText(/ΔH endothermic positive/)
    .first()
    .waitFor();
  const [dscCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download events (CSV)' }).click(),
  ]);
  assert.match(
    readFileSync(await dscCsv.path(), 'utf8'),
    /exo up on plots; ΔH endothermic positive/,
  );
  step(
    'DSC: technique switch, example, events with guidance, Tg near 60 °C, Xc, CSV with convention',
  );

  // Combined TGA-DSC: simultaneous example, correlation, re-ranked suggestion, calcination mark.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByRole('button', { name: 'Try with combined TGA-DSC example' }).click();
  await page.getByRole('heading', { name: 'Describe the run', exact: true }).waitFor();
  await next('Clean data');
  await next('Baseline and events');
  await page.getByRole('heading', { name: /Event 4: exothermic/ }).waitFor();
  await next('Glass transition and crystallinity');
  await next('Combined interpretation');
  await page
    .getByText(/Mass is lost .* while heat is absorbed/)
    .first()
    .waitFor();
  await page
    .getByText(/The mass does not change .* while heat is released/)
    .first()
    .waitFor();
  await page.getByText(/Heat flow: exo up/).waitFor();
  await page
    .getByText(/Partly verified/)
    .first()
    .waitFor();
  await page.getByText(/Check by XRD of samples calcined below and above 520/).waitFor();
  const accept = page.getByRole('button', { name: /Accept this Dehydration or evaporation/ });
  await accept.click();
  await page.getByText(/Your choice: Dehydration or evaporation/).waitFor();
  await next('Results');
  await page.getByText('Combined TGA-DSC (guidance)').waitFor();
  const [combinedCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download combined events (CSV)' }).click(),
  ]);
  const combinedText = readFileSync(await combinedCsv.path(), 'utf8');
  assert.match(combinedText, /exo up on plots; ΔH endothermic positive/);
  assert.match(combinedText, /Dehydration or evaporation/);
  const methodsValue = await page.getByLabel('Methods paragraph').inputValue();
  assert.match(methodsValue, /mass loss with an endotherm suggests dehydration/);
  assert.match(methodsValue, /confirmed experimentally/);
  const [staSession] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download session (JSON)' }).click(),
  ]);
  const staJson = JSON.parse(readFileSync(await staSession.path(), 'utf8'));
  assert.equal(staJson.kind, 'dsc-session');
  step(
    'Combined TGA-DSC: example, correlations, accepted suggestion, calcination mark at 520 °C, CSV, methods text, session',
  );

  // Kinetics: five synthetic runs of a made-up reaction with Ea = 150 kJ/mol, all three methods.
  await page.getByText('Kinetics (several heating rates)').click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByText(/at least three runs/i).waitFor();
  await page.getByRole('button', { name: 'Try with example data' }).click();
  await next('Method and window');
  await next('Results and export');
  const kissingerEa = await page
    .getByText(/Apparent activation energy Ea = /)
    .first()
    .textContent();
  const ea = Number(/Ea = ([\d.]+)/.exec(kissingerEa ?? '')?.[1]);
  assert.ok(Math.abs(ea - 150) < 4.5, `Kissinger Ea ${ea} is within 3 % of the made-up 150`);
  await page
    .getByText(/apparent/, { exact: false })
    .first()
    .waitFor();
  const [kinCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download CSV/ }).click(),
  ]);
  assert.match(readFileSync(await kinCsv.path(), 'utf8'), /Kissinger method/);
  assert.match(await page.getByLabel('Methods paragraph').inputValue(), /8\.314462618/);
  step('Kinetics: example, Kissinger Ea near 150 kJ/mol, CSV, methods text');

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

  // Graph image inside XRD: example figure through calibration and tracing, added to XRD.
  await page.goto(`http://localhost:${PORT}/#/xrd/image`);
  await heading().waitFor();
  await page.getByRole('button', { name: 'Try with example data' }).click();
  await page.locator('.shot-preview').waitFor({ timeout: 10_000 });
  await next('Calibrate axes');
  await next('Trace the curve');
  await page.locator('#trace-title').waitFor({ timeout: 10_000 });
  const range = await page.locator('.summary-grid dd').first().textContent();
  assert.match(range ?? '', /^10\.\d\d° to 79\.\d\d°$/);
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 0, `graph-image reader scrolls sideways by ${overflow}px at ${width}px`);
  }
  step(`Graph image: example traced over ${range}, no sideways scroll at 360 px`);
  await next('Add to XRD');
  await page.getByRole('button', { name: 'Add to my XRD analysis' }).click();
  await page.waitForFunction(() => location.hash === '#/xrd');
  await page.waitForFunction(
    () => document.querySelector('#wizard-step-heading')?.textContent === 'Upload',
  );
  await page.getByText('Digitized from a figure: approximate').first().waitFor();
  step('Graph image: pattern added to the XRD Upload step, marked approximate');

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
