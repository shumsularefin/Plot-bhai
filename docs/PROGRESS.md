# Progress

## Stage 1: XRD data import and plot (done)

Branch `stage-1-import`, built on `stage-0-foundation`.

### What was built

- **Import** (wizard step 1, `src/modules/xrd/UploadStep.tsx`): drag and drop, file picker
  (several files at once) and pasted text. Files are read in a web worker
  (`src/workers/import.worker.ts`), so large files never block the page. Up to 8 patterns can be
  loaded at once (one per plot colour).
- **Parsers** (`src/core/xrd/`):
  - Two- and three-column text (.xy, .xye, .dat, .txt, .csv, pasted). Detects tab, semicolon,
    comma or space delimiters, decimal commas, header and comment lines, quoted fields, CRLF line
    endings and UTF-16 files. The third column is read as the uncertainty (σ) only for .xye;
    otherwise extra columns are ignored with a note.
  - PANalytical .xrdml: `startPosition`/`endPosition`, `listPositions`, `<intensities>` and the
    older `<counts>` with `beamAttenuationFactors`, counting time and the Kα1 wavelength written
    in the file. Rocking curves (2θ held fixed) are refused with an explanation.
  - Rigaku .ras (ASCII): first scan, with a note when the file has more.
  - Binary or packed files (.raw, .brml, .rasx, .rd, .sd, or anything containing NUL bytes or a
    zip header) are refused with a message saying to export .xy or .csv. Nothing is guessed.
- **Validation** with plain-language messages shown on each pattern's card:
  - Refused at import: 2θ not increasing (scans recorded high to low are reversed instead), 2θ
    above 180°, fewer than 10 points, constant intensity.
  - Warnings and notes: values that look like radians (with a one-click conversion), varying or
    coarse step, few points, negative 2θ or intensity, and decimals while the unit is set to counts.
  - Counts versus counts per second: taken from the file when it says so (XRDML, or a column
    header such as "Intensity (cps)"). Otherwise it is guessed from whether all values are whole
    numbers, labelled as a guess, and changeable.
- **Data summary card:** 2θ range, step (marked "≈ … (varies)" when uneven), points, maximum
  intensity and where it is, plus the counting time and wavelength when the file states them.
  Patterns can be renamed and removed (with Undo).
- **Plot** (`src/ui/plot/`, shared by all tools):
  - SVG rendering.
  - Zoom by wheel, pinch or buttons; pan by drag or one-finger swipe. Vertical swipes still scroll
    the page.
  - Keyboard control: arrows pan, + and − zoom, 0 shows all.
  - Hover or tap readout and editable 2θ range inputs.
  - Normalise option, overlay of several patterns with an adjustable vertical offset, and a legend.
  - Publication-style axes: closed frame, inward ticks, "2*θ* (°)" with italic θ, and
    "Intensity (a.u.)" with no intensity numbers.
  - Large scans are reduced per pixel column with min/max decimation, which looks identical to
    drawing every point.
- **Figure export:** SVG, and PNG at 300 or 600 dpi (the dpi is written into the PNG's pHYs chunk).
  Presets for single column (85 mm) and double column (180 mm), editable height, Arial or Times
  New Roman, font size and line width in points. The export uses the range shown on screen.
- **Example data:** "Try with example data" loads two synthetic patterns (narrow and broad
  pseudo-Voigt peaks at arbitrary positions on a smooth background, with seeded counting noise).
  The UI labels them "Synthetic, not real data", and each card explains they are generated and
  not a measurement of any real material.
- **Wizard:** step 1 is Upload; step 2 (Clean data) is a placeholder that shows the loaded
  patterns. Saved state version is now 2, so Stage 0 sessions (sample name only) are discarded.
- **Stage 0 fix:** the preview-deploy workflow read `.firebaserc` with `require()`, which fails
  for a file without a `.json` extension. It now uses `JSON.parse`. That fix was pushed to
  `stage-0-foundation`.

### Format references

I could not find official specifications for XRDML or RAS. The element and keyword layout was
checked against the source code of two open-source readers, fetched during this stage:
xrayutilities (`io/panalytical_xml.py`, `io/rigaku_ras.py`) and GSAS-II
(`imports/G2pwd_Panalytical.py`, `imports/G2pwd_rigaku.py`). Points taken from them:

- XRDML `<intensities>` already include attenuation; older `<counts>` are multiplied by
  `beamAttenuationFactors` (xrayutilities does this).
- `startPosition`/`endPosition` are spread evenly over the number of intensity values.
- In RAS files, both readers take column 2 as the intensity and do not apply column 3 (the
  attenuator factor). This reader does the same and shows a warning when column 3 is not 1.

### Dependencies added

| Package         | Kind    | Why                                                                                                                                       |
| --------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| d3-array        | runtime | "Nice" tick positions (`ticks`, `tickStep`) for plot axes. It lives in the lazily loaded XRD chunk.                                       |
| @types/d3-array | dev     | Types for d3-array.                                                                                                                       |
| @types/node     | dev     | Lets tests read fixture files as bytes with `node:fs`. It is only in `tests/tsconfig.json`, so app code cannot use Node APIs by accident. |

### Decisions

- **Regex-based XRDML reader** rather than DOMParser, because DOMParser does not exist in web
  workers.
- **Intensity is stored as read.** No unit conversion is done; the unit is a label for now and
  for later noise estimates.
- **The y axis has no numbers.** Intensity is in arbitrary units, as in most published
  diffraction figures. The readout shows exact values.
- **Plot view is not saved.** The plot settings (normalise, offset, export options) are saved
  with the session; the zoom range is not.
- **The screen legend is HTML** (accessible, wraps on phones); exported figures draw the legend
  inside the plot.

### Verification (real results)

- `npm run lint`: pass. `npm run typecheck` (app and tests): pass.
- `npm test`: 97 tests pass and 1 is skipped (the real-file test, until you add a file). Every format has fixtures in `tests/fixtures/xrd/` (written by
  `make_fixtures.py`, synthetic). Tests also cover every friendly error, UTF-16 files, decimation,
  ticks, normalise and offset, the PNG CRC-32 and pHYs chunk, SVG export and the 50,000-point
  import.
- `npm run build`: pass. `npm run size`: initial JavaScript 8.2 KB gzipped (budget 150 KB). The
  XRD chunk is 13.5 KB and the import worker 4.5 KB; both load on demand.
- Browser check (headless Chromium, production build served with the `firebase.json` headers,
  so the strict CSP applies):
  - All 8 good fixtures load through the file picker. Every bad fixture, plus a binary .raw and a
    .brml, shows its friendly message. Paste, drag and drop, radians conversion, remove and Undo
    all work.
  - Export works: SVG, PNG at 600 dpi (2008 × 1535 px, pHYs = 600 dpi) and a double-column PNG
    at 300 dpi (2126 × 1181 px).
  - A reload keeps the patterns and settings. Step 2 shows the plot.
  - No console errors or CSP violations.
- 50,000-point file: imported and drawn in about 0.1 to 0.2 s. During wheel zoom, drag pan and
  hover, frame times were 16.7 ms at the median and the 95th percentile (60 fps), with no long
  main-thread tasks.
- Touch (360 px, emulated with Chrome DevTools touch events): two-finger pinch zooms, one-finger
  swipe pans and a tap shows the readout.
- No horizontal scroll at 360, 768, 1280 or 1920 px in light or dark, including with a help
  popover open.

### Known issues and to-dos

- **Waiting on you:** put at least one real instrument file in `tests/fixtures-real/`.
  `tests/realFiles.test.ts` checks that every file there loads. Until then it reports one skipped
  test. The XRDML and RAS fixtures are modelled on the reference readers, not copied from
  instruments, so a real file is the real test.
- RAS attenuator factors are not applied (see Format references). Please confirm this with your
  instrument documentation or a real file.
- Only the first scan of multi-scan XRDML and RAS files is loaded.
- Wheel zoom captures the mouse wheel over the plot, so scrolling the page with the pointer over
  the plot zooms instead.
- The wavelength from XRDML files is shown as written in the file; it is not used yet and has not
  been checked.
- Carried over from Stage 0: Okabe-Ito hex values to verify, no live-deploy workflow, CSP to widen
  for Gemini.

### Next stage

Stage 2: not started. Waiting for your go-ahead and the stage brief.

## Stage 0: project foundation (done)

Branch `stage-0-foundation`. No science code yet.

### What was built

- **Tooling:** Vite 8, TypeScript 6.0 in strict mode (plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`), Preact 11, ESLint 10 with typescript-eslint, Prettier, Vitest 5.
  Folder structure from CLAUDE.md; empty folders hold a `.gitkeep`.
- **Design system** (`src/ui/tokens.css`): neutral palette with one accent colour, system font
  stack, type scale, 4 px spacing scale, radii, a 44 px touch-target token and the Okabe-Ito
  colour-blind safe plot palette. Light and dark themes follow the OS by default; the header
  button switches between system, light and dark. `tests/tokens.test.ts` checks that every text
  colour pair meets WCAG AA (4.5:1) and that borders and the focus ring meet 3:1, in both themes.
- **App shell:** header, footer and a centred content column with a 16 px side gutter on phones
  (24 px from 768 px, 32 px from 1280 px). A hash router (`#/`, `#/xrd`) needs no server rewrites.
- **Home page:** four tool cards. XRD opens its wizard; UV-Vis, FTIR and Particle size show
  "Coming soon".
- **Wizard** (`src/ui/wizard/`): stepper (the full step list from 1024 px; a compact "Step 2 of 8"
  line with a progress bar on smaller screens), Back and Next, a per-step `validate` hook that
  returns a plain-language message, focus moved to the step heading on step change, "Start over"
  with confirmation, and a notice if the browser blocks saving.
- **Persistence** (`src/ui/persist/`): a small store mirrored to IndexedDB (debounced writes, an
  immediate write when the page is hidden, a version number so a later stage can discard
  incompatible saved data). A refresh resumes at the same step with the same data.
- **XRD placeholder:** the eight XRD steps in wizard order. Only "Upload" has content: a
  required sample name (to exercise validation and persistence) and a "What is 2θ?" help popover.
- **Help popover** (`src/ui/HelpTip.tsx`): "What is this?" button with a 44 px target. Closes with
  Escape (returning focus), the close button or a tap outside, and stays inside the viewport.
- **Hosting:** `firebase.json` (Hosting only, long cache for hashed assets, `no-cache` elsewhere,
  security headers and a strict CSP) and `.firebaserc` with the placeholder
  `YOUR_FIREBASE_PROJECT_ID`.
- **CI:** `ci.yml` runs lint, type check, tests, build and the bundle-size check on every pull
  request and on pushes to `main`. `preview.yml` deploys pull requests to a Firebase preview
  channel and skips itself until the setup in README.md is done.

### Dependencies and why

| Package                                        | Kind    | Why                                                                          |
| ---------------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| preact                                         | runtime | UI framework required by CLAUDE.md.                                          |
| vite                                           | dev     | Build tool and dev server.                                                   |
| typescript                                     | dev     | Type checking. Pinned to `~6.0` because typescript-eslint supports `<6.1`.   |
| vitest, jsdom                                  | dev     | Unit tests; jsdom provides a DOM for component tests.                        |
| @testing-library/preact                        | dev     | Renders components in tests and queries them by role and label.              |
| fake-indexeddb                                 | dev     | In-memory IndexedDB so persistence can be tested in Node.                    |
| eslint, @eslint/js, typescript-eslint, globals | dev     | Linting.                                                                     |
| eslint-plugin-react-hooks                      | dev     | Catches hook ordering and missing-dependency bugs (works with Preact hooks). |
| prettier, eslint-config-prettier               | dev     | Formatting, and turning off ESLint rules that conflict with it.              |

D3 submodules are not installed yet; they arrive with the first plot.

### Decisions

- **No `@preact/preset-vite`.** Vite compiles JSX itself using `jsxImportSource: "preact"` from
  tsconfig. This saves a Babel-based plugin and its dependencies. The cost is that the dev server
  does a full page reload on change instead of hot-swapping components; saved state survives
  reloads, so little is lost.
- **Own IndexedDB wrapper** (about 50 lines) rather than the `idb` package.
- **Hash routing** rather than a router library, because there are only a handful of routes.
- **Theme before first paint:** `public/theme-init.js` is a tiny external script, because the CSP
  forbids inline scripts. The theme choice lives in localStorage, as a per-browser convenience.
- **CSP:** `default-src 'none'`, with only same-origin scripts, styles, images (plus `data:`/`blob:`
  for later exports), fonts, connections and workers. `frame-ancestors 'none'`,
  `base-uri 'none'`, `form-action 'none'`, `object-src 'none'`.

### Verification (real results)

- `npm run lint`: pass. `npm run typecheck`: pass.
- `npm test`: 44 tests pass (store, wizard, help popover, colour contrast).
- `npm run build`: pass. `npm run size`: initial JavaScript 8.1 KB gzipped (budget 150 KB); the
  XRD chunk (about 3 KB) is lazy-loaded.
- Browser check in headless Chromium, serving `dist/` with the `firebase.json` headers, at 360,
  768, 1280 and 1920 px in light and dark: no horizontal scroll (including with the help popover
  open), no console errors or CSP violations. Validation blocks Next with its message; after
  filling the sample name, moving to step 3 and reloading, the wizard reopened on step 3 with the
  name kept. The XRD card opens with the keyboard alone.
- Lighthouse 13 (mobile, simulated throttling, local server): home page performance 100 (LCP 1.2 s,
  CLS 0, TBT 0 ms); XRD wizard performance 100 (LCP 1.4 s, CLS 0). Accessibility, best practices
  and SEO 100 on both. This was a local server, not Firebase; re-check on the first preview URL.
- `npm run dev` starts and serves the app.

### Known issues and to-dos

- **To verify:** the Okabe-Ito plot colours in `tokens.css` are from Okabe and Ito, "Color
  Universal Design" (2008). Please confirm the hex values against the source.
- The CI and preview workflows have not run on GitHub yet; the first pull request is their first
  run. The preview workflow needs the manual setup in README.md.
- No workflow deploys the live site on merge yet; live deploys are manual (see README).
- The CSP `connect-src 'self'` must be widened when the optional Gemini feature (Firebase AI
  Logic) is added in the last stage.
- Below 1024 px the stepper is compact, so earlier steps are reached with Back rather than by
  tapping a step.
- No "Try with example data" button yet (added in Stage 1).
- Undo per processing step is not built yet; the wizard only has "Start over". Undo belongs with
  the first processing step.

### Next stage

Stage 1 (see above).
