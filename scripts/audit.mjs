// Layout and accessibility audit: every tool at 360, 768, 1280 and 1920 px, on every wizard step
// reached with the example data. Reports sideways page scroll, touch targets under 44 px,
// controls without a name, and console errors. Run `npm run build` first. Exit code 1 on findings.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const roots = [undefined, process.env.PLAYWRIGHT_PATH, '/opt/node-tools/node_modules'];
function loadPlaywright() {
  for (const root of roots) {
    try {
      return root
        ? require(require.resolve('playwright', { paths: [root] }))
        : require('playwright');
    } catch {
      /* next */
    }
  }
  throw new Error('Playwright was not found. Install it globally or set PLAYWRIGHT_PATH.');
}
const { chromium } = loadPlaywright();

const PORT = 4180;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
process.on('exit', () => server.kill());
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 200));
}

const TOOLS = ['/', '/xrd', '/uvvis', '/ftir', '/particles', '/thermal'];
const WIDTHS = process.env.AUDIT_WIDTHS
  ? process.env.AUDIT_WIDTHS.split(',').map(Number)
  : [360, 768, 1280, 1920];

/** Runs in the page: returns the problems on the current screen. */
function inspect() {
  const found = [];
  const name = (el) => {
    const tag = el.tagName.toLowerCase();
    const text = (el.getAttribute('aria-label') || el.textContent || el.id || '')
      .trim()
      .slice(0, 40);
    if (!text)
      return (
        el.outerHTML.slice(0, 160) + ' << ' + (el.parentElement?.outerHTML ?? '').slice(0, 200)
      );
    return `${tag}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${text}"`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (overflow > 0) found.push(`page scrolls sideways by ${overflow}px`);
  const controls = document.querySelectorAll(
    'button, a[href], select, textarea, input:not([type=hidden]), [role=button], [role=tab]',
  );
  for (const el of controls) {
    if (el.closest('.visually-hidden') || el.classList.contains('visually-hidden')) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    // A radio or checkbox hidden behind its label is measured through the label.
    const box = el.closest('label') ? el.closest('label').getBoundingClientRect() : r;
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    if (!inline && (box.width < 43.5 || box.height < 43.5)) {
      found.push(`target ${Math.round(box.width)}x${Math.round(box.height)}: ${name(el)}`);
    }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && el.type !== 'file') {
      const labelled =
        [...(el.labels ?? [])].some(
          (l) => !l.contains(el) || l.querySelector('button, input, select, textarea') === el,
        ) ||
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        el.getAttribute('title');
      if (!labelled) found.push(`no accessible name: ${name(el)}`);
    }
    if (el.tagName === 'BUTTON' && !el.textContent.trim() && !el.getAttribute('aria-label')) {
      found.push(`button without name: ${name(el)}`);
    }
  }
  for (const img of document.querySelectorAll(
    'svg[role=img]:not([aria-label]):not([aria-labelledby])',
  )) {
    found.push(`svg role=img without a name`);
    void img;
  }
  return found;
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const report = new Map();
const add = (key, items) => {
  for (const item of items) {
    const k = `${key} ${item.replace(/[0-9a-f]{6,}(-[0-9a-f-]+)?|\d{3,}/g, '#')}`;
    report.set(k, (report.get(k) ?? 0) + 1);
  }
};
for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  for (const tool of TOOLS) {
    await page.goto(`http://localhost:${PORT}/#${tool}`);
    await page.waitForTimeout(400);
    const example = page.getByRole('button', { name: /^Try with/ }).first();
    if (await example.count()) await example.click().catch(() => {});
    for (let step = 0; step < 12; step++) {
      await page.waitForTimeout(350);
      add(`${width}px ${tool} step ${step}:`, await page.evaluate(inspect));
      const nextButton = page.getByRole('button', { name: 'Next', exact: true });
      if (!(await nextButton.count()) || (await nextButton.isDisabled())) break;
      await nextButton.click();
    }
  }
  add(`${width}px errors:`, errors);
  await context.close();
}
await browser.close();
for (const [line, count] of report) console.log(count > 1 ? `${line} (x${count})` : line);
console.log(report.size === 0 ? 'Audit clean.' : `${report.size} findings.`);
process.exit(report.size === 0 ? 0 : 1);
