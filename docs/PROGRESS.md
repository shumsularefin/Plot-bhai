# Progress

## Stage 3: peak detection and fitting (done)

Branch `stage-3-peaks`, built on `stage-2-preprocess`.

### What was built

- **Science code** (`src/core/xrd/peaks/`, `src/core/math/levenbergMarquardt.ts`). Every formula
  has a doc comment with the equation, the variables and the units.
  - **Profiles** (`profiles.ts`): Gaussian, Lorentzian and pseudo-Voigt, all written as
    f = A·[η L + (1 − η) G] with height A, centre x0, FWHM w and η. Includes analytic
    derivatives, and closed-form area and integral breadth (with gradients, for propagating
    uncertainties).
  - **Detection** (`detect.ts`): topographic prominence (the SciPy `find_peaks` definition) as a
    percentage of the intensity range, minimum separation, and width at half prominence. It
    runs in O(n log n), using a monotonic stack for the nearest higher points and a sparse table
    for range minima, so 50,000 noisy points take a few milliseconds.
  - **Fit regions** (`fit.ts`): each peak covers centre ± 3 × width; overlapping ranges merge
    into one region, fitted with its own straight background.
  - **Levenberg–Marquardt** (`levenbergMarquardt.ts`): unweighted least squares with box bounds
    (height ≥ 0, centre within one starting width, FWHM from one data step to the region width,
    0 ≤ η ≤ 1).
    - Uncertainties come from the covariance C = s² (JᵀJ)⁻¹, with s² = SSR / (n − m).
    - R² is reported per region.
    - Parameters that end on a bound are flagged.
  - **Peak table** (`table.ts`), with σ for each:
    - 2θ
    - d from Bragg's law, d = λ / (2 sin θ) with λ = Kα1, and σ_d by propagation
    - FWHM in degrees and radians
    - integral breadth
    - height and area
    - I/Imax by height
    - η
- **Plain-language notes** at the peak or region concerned: width at its lower limit, fewer than
  three points across the peak, height zero, centre at the edge of its range, η at 0 or 1, width
  uncertain by more than 20 %, no convergence, R² below 0.9. The step also warns when Kα2 is
  still in the data, and when smoothing is on (see Known issues).
- **Fit peaks step** (wizard step 5, `src/modules/xrd/FitStep.tsx`):
  - **Detection:** automatic on the first visit, with a prominence slider and a
    minimum-separation control. Changing them detects again; Undo restores the previous list.
  - **Plot editing modes:** Pan and zoom, Add (click), Remove (click a marker) and Move (drag a
    marker sideways). There is also an "Add a peak at 2θ" field for keyboard users, and "Remove
    all peaks".
  - **Profile choice:** Gaussian, Lorentzian, or pseudo-Voigt with η free or fixed.
  - **Fitting:** "Fit peaks" runs in a web worker (`src/workers/peaks.worker.ts`) with region
    progress and a Cancel button. After a fit, the fitted positions and widths become the
    starting values for the next fit. Changing peaks, profile, cleaning or radiation marks the
    results out of date.
  - **Plot overlay:** data, total fit and each component (dashed), with a residual panel below
    that shares the zoom.
  - **Results:** a region list with R², and a sortable peak table showing value ± σ. CSV export
    has a header line stating λ and units, plus σ columns, R² and notes.
- **Plot engine additions:** gaps for NaN values, series hidden from the legend and readout,
  clickable and draggable markers, a residual panel, and props bundled into one `interaction`
  object.
- **Refactor:** the processing-worker logic moved into a shared `useProcessed` hook, which also
  fixes a weak "same length means same pattern" check in Stage 2.
- **Saved sessions:** the format version is now 4. Stage 1 and Stage 2 sessions are migrated
  (tested).

### Known-answer tests (`tests/xrd-peaks.test.ts`, `tests/fitSupport.test.ts`)

Synthetic peaks on a flat background of 200 counts, step 0.01°, with seeded counting noise.

| Test                                                                                                  | Tolerance                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single noisy peak, for each of Gaussian, Lorentzian, pseudo-Voigt (η free) and pseudo-Voigt (η fixed) | centre within 0.003°; FWHM, height and area within 3 %; η within 0.1; R² > 0.99; truth within 4σ                                                         |
| Noise-free pseudo-Voigt                                                                               | centre within 0.001°, FWHM within 1 %, η within 0.02                                                                                                     |
| Two overlapping peaks, 0.25° apart with FWHM 0.3° each                                                | grouped into one region; centres within 0.005°; FWHM and heights within 5 %                                                                              |
| Calibration of σ (40 noisy repeats)                                                                   | true centre within 2σ in at least 33 of 40 (about 38 expected)                                                                                           |
| Detection                                                                                             | finds exactly the 4 synthetic peaks in noise; a higher threshold drops the small ones; prominence matches the SciPy definition on a hand-checked example |
| Linear least squares through Levenberg–Marquardt                                                      | parameters and σ match the closed-form textbook values                                                                                                   |
| Area and integral breadth                                                                             | closed form matches numerical integration within 0.05 %; analytic derivatives match finite differences                                                   |
| Bragg d                                                                                               | round trip exact; σ_d matches a finite difference                                                                                                        |
| Speed                                                                                                 | 30 peaks on 46,667 points fitted in under 3 s (about 0.2 s in practice); detection on 50,000 points under 0.5 s                                          |

### Decisions

- **Unweighted least squares**, the usual default in Origin, so the results can be compared
  with Origin.
- **Height-based parameters** (A is the peak height). Area and integral breadth are derived,
  with σ propagated through the full covariance matrix.
- **Relative intensity** uses height. Area is in the table and CSV for anyone who needs area
  ratios.
- **Regions** span ± 3 × the starting width around each peak.
- **No new dependencies.**

### Verification (real results)

- `npm run lint`: pass. `npm run typecheck`: pass.
- `npm test`: 138 tests pass and 1 is skipped (the real-file test, until you add a file).
- `npm run build`: pass. `npm run size`: initial JavaScript 8.2 KB gzipped (budget 150 KB). The
  XRD chunk is 23 KB and the peaks worker 3.6 KB; both load on demand.
- Browser check (headless Chromium, production build with the strict CSP):
  - The example data, after smoothing, SNIP and Kα2 stripping, gave 8 detected peaks. The
    prominence slider worked (5 peaks at 15 %, back to 8 at 3 %).
  - Fit in 68–130 ms. 8 regions with R² ≥ 0.998. The table sorts.
  - Add, Remove and drag (31 px) all worked. Three Undos restored the fitted state.
  - Out-of-date results were flagged. The CSV downloaded. A reload kept the fit.
  - No console errors.
- 30 peaks on 46,667 points: all 30 detected and fitted in 205 ms in the browser, with no long
  tasks on the main thread.
- No horizontal page scroll at 360, 768, 1280 or 1920 px in light or dark; the table scrolls
  inside its own box. All controls are at least 44 px tall.

### Known issues and to-dos

- **Waiting on you:** a real XRD file in `tests/fixtures-real/`, plus your Origin fit of the same
  file, so the results can be compared. A comparison is not claimed until that exists.
- **Smoothing makes the uncertainties too small.** The covariance assumes independent noise;
  Savitzky–Golay smoothing correlates neighbouring points. The app warns about this when
  smoothing is on.
- **Kα2 still in the data:** if Kα2 is not stripped, each peak is fitted as a single profile,
  so widths are too broad. The app warns about this; fitting Kα1/Kα2 doublets directly is not
  implemented.
- **Export:** the figure export does not include the residual panel yet.
- **Detection on raw, noisy, finely stepped data** finds extra peaks on the flanks of tall ones
  (38 instead of 30 in one test at 3 %). Smoothing first, or raising the prominence, avoids this.
  The UI says so.
- Carried over: wavelengths to verify; no Thermal card on the home page yet.

### Next stage

Stage 4: not started. Waiting for your go-ahead and the stage brief.

## Stage 2: XRD preprocessing (done)

Branch `stage-2-preprocess`, built on `stage-1-import`. `CLAUDE.md` was replaced with the
updated version you supplied, which adds thermal analysis as a fifth tool.

### What was built

- **Science code** (`src/core/xrd/`, no UI imports). Each formula has a doc comment giving the
  equation, the variables and the units.
  - **Radiation** (`radiation.ts`): Cu, Co, Cr, Fe, Mo and Ag, each with its Kα1 and Kα2
    wavelengths (Å) and a source. The Kα2/Kα1 ratio is editable, default 0.5. There is a
    "Kα1 only (monochromator)" option.
  - **Savitzky–Golay smoothing** (`process/savitzkyGolay.ts`): odd window, order 2–5. The end
    points are smoothed by evaluating the polynomial fitted to the first or last full window,
    so no points are lost.
  - **Background** (`process/background.ts`), three methods:
    - _Iterative polynomial_ (Lieber and Mahadevan-Jansen, "modified polyfit"), degree 1–8.
    - _SNIP_ (Ryan et al. 1988), using the LLS operator and a window that grows from 1 point to
      the chosen width in degrees.
    - _Manual anchors_: the user clicks the plot and a monotone cubic (Fritsch–Carlson PCHIP)
      passes through the points without overshooting.
  - **Kα2 stripping** (`process/kAlpha2.ts`): Rachinger (1948), point by point from low angle.
    It uses the exact Bragg-law position sin θ2 = (λ2/λ1) sin θ1, and handles steps larger
    than the Kα2 shift.
  - **Pipeline** (`process/pipeline.ts`): runs zero shift, smoothing, background, Kα2 and
    normalisation in that order. Each step has its own switch. Plain-language messages are
    attached to the step they concern, for example "Kα2 stripping works best after the
    background is removed".
- **Clean data step** (wizard step 2, `src/modules/xrd/CleanStep.tsx`):
  - **Per step:** a radiation selector, then one card per step with an on/off switch, a short
    plain-language description, its settings and a Reset button.
  - **Whole step:** Undo (every change, up to 50 steps), "Reset all steps" and "Use these
    settings for all patterns". Manual anchors are not copied between patterns.
  - **Views:** Before, After, or Before and after. The background is drawn as a dashed line.
  - **Anchors:** shown as circles, and can be removed one at a time or all at once.
  - **Wavelength check:** a warning appears if the XRDML file's stated Kα1 differs from the
    chosen anode.
- **Reversible:** processing never changes the stored data. Only the settings are saved, and
  the processed pattern is recomputed from the original each time. Switching every step off
  returns the original exactly (tested).
- **Worker:** processing runs in `src/workers/process.worker.ts`. Only one job runs at a time,
  and newer settings replace any queued ones, so quick changes never pile up.
- **Plot additions:** dashed series, markers, click-to-place in data coordinates, and an option
  to hide the normalise and offset controls.
- **Saved sessions:** the format version is now 3, and Stage 1 (version 2) sessions are
  migrated, keeping their patterns. The persisted store gained an optional `migrate` hook,
  which is tested.
- **Example data:** each synthetic peak now has a Cu Kα2 line (ratio 0.5), so stripping can be
  tried on the example.

### Known-answer tests (`tests/xrd-process.test.ts`)

Synthetic pseudo-Voigt peaks (FWHM 0.3°, step 0.01°) at 25°, 38°, 52° and 66°, with heights
3000, 8000, 2000 and 5000. Positions and heights are measured with a least-squares parabola
through the 17 points around each maximum.

| Test                                                            | Tolerance                                                                                                                                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Iterative polynomial on a known cubic background (noise-free)   | heights within 1 %, positions within 0.005°                                                                                                                                   |
| SNIP on a known exponential background (noise-free)             | heights within 2 %, positions within 0.005°; peak-free residual < 20 counts                                                                                                   |
| Rachinger on a known Cu Kα1 + Kα2 doublet (noise-free)          | Kα1 heights within 1 %, positions within 0.005°; Kα2 residue < 1 % of peak height                                                                                             |
| Rachinger when the step (0.05°) is larger than the Kα2 shift    | error < 2 % of peak height everywhere                                                                                                                                         |
| Smoothing, then SNIP, then Kα2 stripping on noisy data (seeded) | heights within 3 %, positions within 0.01°                                                                                                                                    |
| Savitzky–Golay                                                  | 5-point quadratic weights are (−3, 12, 17, 12, −3)/35; a cubic passes unchanged with order 3 (ends included); noise RMS falls below 60 % with the peak height kept within 1 % |
| Anchors                                                         | the curve passes through every anchor, is flat outside them, and does not overshoot                                                                                           |
| Reversibility                                                   | every step off returns the input exactly; zero shift and normalisation do exactly what they say                                                                               |
| Speed                                                           | 50,000 points with every step on (both automatic background methods) in under 1 s                                                                                             |

### Sources and items to verify

- **TODO(verify): wavelengths.** International Tables for Crystallography and Hölzer et al.
  (1997) could not be reached from this environment, so no value was typed from memory.
  - Cu Kα1 (1.54059292 Å), Cu Kα2 (1.544414 Å) and Mo Kα1 (0.70931713 Å) come from International
    Tables Vol. C, 2nd ed., p. 203, as quoted in the xrayutilities source.
  - All other values come from pymatgen's `WAVELENGTHS` table. pymatgen does not say where
    they come from.
  - The app shows the source next to the values and says they are still to be verified.
  - Please check every value against International Tables Vol. C, Table 4.2.2.1.
- **Kα2/Kα1 ratio:** 0.5 is the GSAS-II default (`GSASIIpwd.py`). Real tubes differ slightly,
  so it is editable.
- **Method references** (bibliographic details confirmed by web search; full texts not read):
  - Savitzky and Golay, Anal. Chem. 36 (1964) 1627–1639.
  - Ryan et al., Nucl. Instrum. Methods B 34 (1988) 396–402.
  - Lieber and Mahadevan-Jansen, Applied Spectroscopy 57 (2003). The starting page differs
    between sources (1362 or 1363), so no pages are given.
  - Rachinger, J. Sci. Instrum. 25 (1948) 254.
  - Fritsch and Carlson, SIAM J. Numer. Anal. 17 (1980) 238–246. This one is from memory, not
    checked.
- **SNIP variant:** the window grows from 1 point to the chosen width, as in common
  implementations. Ryan et al. also describe reducing the window in the final iterations; that
  variant is not implemented.

### Decisions

- **Order of steps:** zero shift first, so Kα2 positions use corrected angles. Kα2 stripping
  comes after background removal, because Rachinger also scales any remaining background by
  1/(1 + R).
- **Manual anchors use the clicked position** (2θ and intensity), not the nearest data point.
  This lets the user put the background exactly where they see it.
- **No new dependencies.** Linear algebra is a small Gaussian-elimination solver in
  `src/core/math/linear.ts`.

### Verification (real results)

- `npm run lint`: pass. `npm run typecheck` (app and tests): pass.
- `npm test`: 115 tests pass and 1 is skipped (the real-file test, until you add a file).
- `npm run build`: pass. `npm run size`: initial JavaScript 8.2 KB gzipped (budget 150 KB). The
  XRD chunk is 17.9 KB, the import worker 4.5 KB and the processing worker 2.8 KB; all load on
  demand.
- Browser check (headless Chromium, production build served with the `firebase.json` headers):
  - Every step switches on and off, and the dashed background appears.
  - Four manual anchors could be clicked onto the plot, removed one by one, and restored with
    Undo.
  - The radiation selector and the Kα1-only option work.
  - A reload keeps the settings. "Reset all steps" turns everything off. The Before, After and
    Before-and-after views draw the right curves.
  - No console errors or CSP violations.
- 50,000-point pattern in the browser:
  - Turning on smoothing, SNIP and Kα2 stripping, and then making six rapid changes to the SNIP
    width, settled in about 0.5 to 0.6 s.
  - The iterative polynomial took 43 ms.
  - No long tasks on the main thread.
- No horizontal scroll, and every control at least 44 px tall, at 360, 768, 1280 and 1920 px in
  light and dark.

### Known issues and to-dos

- **Waiting on you:** verify the wavelengths (see above), and add a real XRD file to
  `tests/fixtures-real/`.
- In "Before and after" with normalisation on, the processed curve is on a different scale from
  the original. A note explains this and points to the After view.
- Smoothing assumes an even step and warns when the step varies.
- The new CLAUDE.md lists five tools, but the home page still shows four. A Thermal card was left
  out because this stage was XRD preprocessing only.

### Next stage

Stage 3 (see above).

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

Stage 2 (see above).

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
