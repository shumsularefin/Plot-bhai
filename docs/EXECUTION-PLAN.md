# Execution Plan: Plot-bhai (XRD Toolkit), Stage 6 to the end

This is the step-by-step runbook for finishing the project in Claude Code cloud sessions with
**Sonnet 5.5**. It builds on `CLAUDE.md` (the rules) and the stage prompts you already have. This
file adds three things: where the project stands today, a one-time clean-up so every new session
starts from the right code, and smaller, tighter prompts so a lighter model makes fewer mistakes.

Checked on 2026-10-23 in a cloud session.

---

## Status tracker (the session updates this table)

The next sub-stage is the first row that is not `done`. At the end of every session, the session
sets its row to `done` (or `blocked: reason`) in the same PR.

| Sub-stage | What                                                         | Status  |
| --------- | ------------------------------------------------------------ | ------- |
| 0–5       | Foundation, import, cleaning, peaks, instrument, size/strain | done    |
| 5.9       | Catch-up fixes                                               | todo    |
| 6a        | Reference library build (COD + cross-check)                  | todo    |
| 6b        | Choose material, compare phases                              | todo    |
| 6c        | hkl labels, combined table, lattice refinement               | todo    |
| 7a        | Texture, crystallinity, pattern character                    | todo    |
| 7b        | Figure builder, methods text, export, e2e                    | todo    |
| 8a        | UV-Vis import, conversions, cleaning                         | todo    |
| 8b        | Tauc, Urbach, results                                        | todo    |
| 9         | FTIR                                                         | todo    |
| 10a       | Particles: image, scale, manual                              | todo    |
| 10b       | Particles: automatic detection                               | todo    |
| 10c       | Particles: distribution, export                              | todo    |
| 11a       | TGA: import to step detection (Stage 11 items 1–5)           | todo    |
| 11b       | TGA: events, theory, calcination (items 6–9)                 | todo    |
| 12a       | DSC (Stage 12 items 1–6)                                     | todo    |
| 12b       | Combined TGA-DSC (items 7–8)                                 | todo    |
| 13        | Kinetics (optional; skip unless asked)                       | skipped |
| 14a       | Polish: responsive, Lighthouse, a11y, states (items 1–4)     | todo    |
| 14b       | About page, PWA, deploy, final status (items 5–8)            | todo    |
| 15        | Gemini (optional; only when asked)                           | skipped |

## The one prompt you paste in every new session

```text
Continue the project. Do the next sub-stage from the status tracker in docs/EXECUTION-PLAN.md,
following its prompt and the guardrail block in that file.
```

Or simply say "work" or "next stage": `CLAUDE.md` section 11 tells the session to do the same.
Then use the review prompt (section 3), test it yourself, and merge the PR into `main`.

---

## 0. Where the project stands (verified)

| Item                          | State                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                        | Stages 0–5 merged (was: papers only). Papers in `docs/papers/`.                                                                                                     |
| Stages 0–5                    | Built, on stacked branches: `stage-0-foundation` → `stage-1-import` → … → `stage-5-size-strain` → `verify-references`. Each branch contains all the ones before it. |
| Old pull requests             | #1 to #8 superseded by the consolidation merge and closed.                                                                                                          |
| Health of `verify-references` | `npm ci` OK, lint OK, type check OK, **182 tests pass / 1 skipped** (the real-file test, waiting for your file), build OK, bundle size within budget.               |
| `CLAUDE.md` on the branches   | Identical to the version you uploaded.                                                                                                                              |
| COD network access            | `www.crystallography.net` now answers **200** from this environment and returns real CIF files. Earlier sessions got 403. **Stage 6 is no longer blocked.**         |
| Materials Project             | Needs a personal API key, so we use **COD only**. That is enough and fits your "cite the reference ID" requirement.                                                 |

Every cloud session starts from a fresh clone of `main`, so always merge a sub-stage's PR before
starting the next one.

### Your open question: UV-Vis "UV plot mechanism"

Confirmed: what you described is the **Tauc plot** for the optical band gap. Plot (αhν)^(1/n)
against photon energy hν, fit the straight part of the absorption edge, and read the band gap where
that line meets the energy axis. Use n = 1/2 for direct allowed and n = 2 for indirect allowed
transitions. For powders measured by diffuse reflectance, the Kubelka–Munk function F(R) replaces α.
Stage 8 covers absorbance, transmittance and diffuse reflectance.

---

## 1. About using Sonnet 5.5 instead of Opus 5.5

The original prompts were written for Opus 5.5. Sonnet 5.5 is faster and cheaper but tends to make
mistakes on long, many-part tasks. Four changes make it reliable here:

1. **Smaller pieces.** The large stages (6, 7, 10, 11, 12) are split into sub-stages (6a, 6b, 6c …).
   Run one sub-stage per session.
2. **A fixed guardrail block** at the top of every prompt (section 3). It makes the model plan
   first, test after every piece, and never write scientific values from memory.
3. **Known-answer tests first.** For every formula, the test with the true answer is written before
   the UI.
4. **An independent cross-check** where it matters most. For example, reference patterns are
   compared with a second program (pymatgen) at build time.

If a sub-stage fails twice in a row on the same problem, switch the model picker to Opus 5.5 for that
one session, then go back to Sonnet.

---

## 2. One-time clean-up (do this first, once)

### Step 2.1: Put Stages 0–5 into `main` — DONE

Stages 0–5 and the reference check are merged into `main` (PRs #1–#8 are superseded and closed). The
papers are in `docs/papers/`. A SessionStart hook (`.claude/settings.json`) runs `npm ci` in each new
cloud session, so lint, tests and build work right away.

### Step 2.2: Give the project your real files (the best check you have)

Before Stage 6, add these to `tests/fixtures-real/` on `main` (upload them through the GitHub web
page: **Add file → Upload files**):

- one real XRD file of a sample you know, for example TiO₂ or ZnO (`.xy`, `.csv` or `.xrdml`);
- if you have one, a LaB₆ or Si standard measured on the same instrument;
- a screenshot or CSV of your Origin peak fit of the same XRD file (positions, FWHM).

Later stages ask for UV-Vis, FTIR, SEM, TGA and DSC files. Add each one when its stage starts.

### Step 2.3: Session settings (every time)

1. Go to claude.ai/code. Choose repository **shumsularefin/plot-bhai** and branch **main**.
2. Pick **Sonnet 5.5** in the model picker.
3. Use the **same environment** as this session, because its network can reach COD and the npm
   registry. If a session reports a 403 for `crystallography.net`, open the environment settings
   and add `www.crystallography.net` to the allowed domains.
4. The session may put its work on a branch it names itself (such as `claude/...`) instead of
   `stage-N-...`. That is fine. What matters is that you **merge its PR into `main` before starting
   the next sub-stage**.

---

## 3. The loop for every sub-stage

1. New session, from `main`, with Sonnet 5.5.
2. Paste the **Guardrail block**, then the sub-stage prompt directly below it. Send them as one
   message.
3. When it finishes, read its summary. Check it pasted **real** command output and listed anything
   that did not work.
4. Send the **Review prompt**.
5. Test it yourself, using the "You check" list for that sub-stage. A preview link comes from the
   Firebase preview workflow on the PR, or you can run `npm install && npm run dev` locally.
6. If something is wrong, send the **Fix prompt**. Repeat until it is right.
7. Merge the PR into `main` (merge commit). Only then start the next sub-stage.

### Guardrail block (paste at the top of every stage prompt)

```text
Read CLAUDE.md, docs/PROGRESS.md and docs/EXECUTION-PLAN.md before anything else.
Rules for this session:
- Do ONLY the sub-stage named below. Do not start the next one.
- First reply with a short plan: the files you will create or change, the tests you will add, and anything
  unclear. Then carry on without waiting, unless something is genuinely unclear, in which case ask me.
- Reuse what already exists (plot engine, wizard, export panel, peak fitter, worker pattern, persisted store).
  Search src/ before writing a new helper.
- Never write a scientific constant, database ID, citation, reference value or expected test value from memory.
  Get it from a source you can open in this session and cite it in a code comment, or mark it TODO,
  flag it for my verification, and tell me.
- Write the known-answer test for each formula before its UI. Tests build synthetic data with a known true answer.
- After each piece of work run: npm run lint && npm run typecheck && npm test. Fix failures before going on.
- Keep the initial bundle under budget: new tool code must be lazy-loaded.
- At the end run npm run lint, npm run typecheck, npm test, npm run build, npm run size, and paste the real
  summary lines, failures included.
- Update docs/PROGRESS.md: what was built, decisions, known issues, what you need from me, next sub-stage.
- Commit in small steps with clear messages, push, and open a pull request into main.
- If you are blocked (network refused, missing data, failing tool), stop and tell me. Do not fake it.
```

### Review prompt (after every sub-stage)

```text
Review your own work against CLAUDE.md and the acceptance list of this sub-stage. List every requirement not
fully met, every shortcut, and every number or data item you could not verify. Then try to break it: empty file,
wrong columns, a 50,000-point file, a 360 px wide screen, keyboard only, dark theme. Fix what breaks, add a test
for each fix, and report real output for lint, typecheck, tests, build and size.
```

### Fix prompt

```text
Problem: [what you saw, which file, which step, screenshot if possible].
Expected: [what should happen].
Find the root cause, fix it, add a test that would have caught it, update docs/PROGRESS.md, push to the same PR.
```

### Resume prompt (if a session loses track)

```text
Read CLAUDE.md, docs/PROGRESS.md and docs/EXECUTION-PLAN.md. Tell me in five lines where the project stands and
which sub-stage is next, then wait.
```

---

## 4. Stage 5.9: catch-up fixes (small, before Stage 6)

These are leftovers from the known-issues lists of Stages 0–5. Doing them now keeps them from
piling up.

```text
Sub-stage 5.9: catch-up fixes only, no new science.
1. Home page: show all five tool cards from CLAUDE.md (XRD, UV-Vis, FTIR, Particle size, TGA and DSC).
   Only XRD opens; the others say "Coming soon".
2. Plot: the mouse wheel must only zoom when the plot has focus or Ctrl/Cmd is held. Otherwise the page scrolls.
   Add a one-line hint on the plot.
3. Figure export: include the residual panel when it is visible (Fit peaks step).
4. Compact stepper below 1024 px: let the user tap a completed step to jump back to it.
5. If tests/fixtures-real/ contains files, make sure each one loads and report its summary card values.
Acceptance: the existing 182 tests still pass, new tests cover items 2-4, lint/typecheck/build/size pass.
```

**You check:** you can scroll the page over a plot, the PNG export includes the residuals, and the
home page shows five cards.

---

## 5. Stage 6: reference library and phase matching (3 sub-stages)

This is the riskiest part scientifically: wrong reference data means wrong hkl labels in your paper.
Split it into three sessions.

### 6a: Build-time reference library

```text
Sub-stage 6a: the reference library build script and data only. No UI.

Write scripts/build-reference-library.ts (run with: npm run build:refs). It runs on the developer machine or CI,
never in the browser.

1. Source: the Crystallography Open Database. Search with the COD REST interface
   (https://www.crystallography.net/cod/result?formula=...&format=json or the documented query options).
   Never take a COD ID from memory. For every candidate: download the CIF, check that the formula, space group
   and phase name match what is expected, and pick the entry with a room-temperature, ambient-pressure,
   fully occupied, well-refined structure (lowest R factor if several). Record: COD ID, mineral/phase name,
   formula, space group (H-M and number), crystal system, a b c alpha beta gamma, the journal reference from
   the CIF (_journal_name_full, _journal_volume, _journal_page_first, _journal_year, DOI if present).
   Save the raw CIFs in scripts/cif-cache/ so the build is repeatable offline.
2. Materials and phases (skip and list in PROGRESS.md any you cannot verify):
   TiO2 (anatase, rutile, brookite), ZnO (wurtzite), Fe3O4 (magnetite), alpha-Fe2O3 (hematite),
   gamma-Fe2O3 (maghemite), CuO (tenorite), Cu2O (cuprite), NiO, Co3O4, CeO2, SnO2 (cassiterite),
   WO3 (monoclinic), alpha-Al2O3 (corundum), gamma-Al2O3, SiO2 (alpha-quartz), CdS (hexagonal and cubic),
   ZnS (sphalerite and wurtzite), BaTiO3 (tetragonal and cubic), SrTiO3, CaCO3 (calcite and aragonite),
   MoS2 (2H), graphite, Si, LaB6, and fcc Au, Ag, Cu, Pt, Ni.
3. Powder pattern from each CIF (kinematic): expand the asymmetric unit with the symmetry operators, enumerate
   hkl up to a d-spacing of 0.8 Å, merge equivalent reflections (multiplicity), structure factor F(hkl) with
   neutral-atom scattering factors and the isotropic or anisotropic displacement parameters from the CIF,
   Lorentz-polarisation factor for a Bragg-Brentano diffractometer without monochromator.
   Atomic scattering factor coefficients: download the Cromer-Mann/Waasmaier-Kirfel table from a source you
   can open (for example the data file shipped in an open-source crystallography package) at build time,
   cite it, and store it in data/reference/scattering-factors.json. Never type the coefficients from memory.
   Store hkl, d (Å), multiplicity and relative intensity (100 = strongest at Cu Ka1). Note: the
   Lorentz-polarisation factor depends on angle, so store the intensities computed for Cu Ka1 and also |F|²
   times multiplicity, so the app can recompute intensities for other wavelengths.
4. Output: one compact JSON file per material family in data/reference/ (for example tio2.json) plus
   data/reference/index.json (family name, aliases and formula for search, phases, COD IDs). Lazy-loaded later.
5. Independent cross-check (required): in a separate script, scripts/crosscheck-refs.py, compute the same
   patterns with pymatgen's XRDCalculator (pip install pymatgen) from the same cached CIFs, Cu Ka1. For every
   phase, the 10 strongest peaks must agree in 2theta to 0.01 degrees and in relative intensity to 5 points.
   Report a table of the comparison in PROGRESS.md. If pymatgen cannot be installed, stop and tell me.
6. Tests (Vitest): the d-spacings of cubic Si, LaB6, Au and NaCl-type NiO follow from their lattice parameters
   (d = a/sqrt(h²+k²+l²)) exactly; systematic absences of fcc (h,k,l mixed) and of bcc/diamond rules are
   respected; multiplicities of cubic {100}, {110}, {111} are 6, 12, 8; the JSON validates against a schema.
If the network blocks COD, stop and tell me.
```

**You check:** open `docs/PROGRESS.md` and pick two phases you know well, such as anatase and
rutile. Click their COD IDs at `https://www.crystallography.net/cod/<ID>.html`. The page must show the
same phase. The strongest anatase peak should be (101) near 25.3° 2θ with Cu Kα, and rutile's
should be (110) near 27.4°.

### 6b: Choose material and compare phases (wizard steps 3 and 4)

```text
Sub-stage 6b: material selector and phase comparison UI, using data/reference from 6a.

1. Step 3 "Choose material": a searchable selector by name, alias or formula (e.g. "titania", "TiO2").
   After choosing a family, list its phases with crystal system and space group. Allow "I don't know"
   (shows every family whose strongest lines fall near the measured peaks, as a guide only).
2. Step 4 "Compare phases": compute 2theta from d for the selected radiation at runtime (Bragg's law, Ka1
   wavelength from radiation.ts). Draw each candidate as a stick pattern under the measured pattern in its own
   lane, colour-blind-safe colours, with a toggle per phase.
3. Match score per candidate: intensity-weighted fraction of the reference peaks stronger than 5 % that have a
   detected peak within a tolerance (default 0.15 degrees 2theta, adjustable), after the best single zero shift
   in the range -0.3 to +0.3 degrees. Show the score, the zero shift used and the matched/unmatched lines.
   Text next to the score: "A guide only. Works for simple, well-separated phases; not reliable for mixtures."
4. The user selects one or more phases. Save the choice in the persisted store (bump the session version with a
   migration and a migration test).
5. Optional field "JCPDS/ICDD card number (typed by you, not verified)".
Tests: build a pattern from the library itself (anatase, Cu Ka1) with a 0.05 degree shift and 2 % noise, run
detection, and check that anatase scores highest among anatase, rutile and brookite; a 50/50 anatase+rutile
synthetic mixture must show both above 0.5.
```

**You check:** load your real TiO₂ or ZnO file. The correct phase should score highest, and its
sticks should line up with your peaks.

### 6c: hkl labels, combined table and lattice parameters

```text
Sub-stage 6c: hkl assignment, labels, combined table and lattice refinement.

1. Assign each fitted peak (from step 5) to the nearest reference reflection of the selected phase(s) within the
   tolerance, after the zero shift. Peaks with no match are labelled "unassigned". Overlapping reflections
   within the tolerance are shown as e.g. (004)/(112) with a note.
2. Plot: (hkl) labels above assigned peaks (non-overlapping, leader lines when crowded), the strongest peak
   highlighted, and the legend shows "Anatase, COD 9xxxxxx" with the real ID.
3. Combined table: 2theta obs, 2theta ref, delta 2theta, d obs, d ref, hkl, I/I0 obs, I/I0 ref, FWHM, phase,
   COD ID, and the user-typed JCPDS number labelled "entered by user, not verified". CSV export.
4. Lattice parameter least squares from the assigned peaks: cubic (a), tetragonal (a, c), hexagonal (a, c),
   orthorhombic (a, b, c), using 1/d² linear in the reciprocal metric terms; optional zero-shift term.
   Report values with standard uncertainties, unit cell volume, and the difference from the reference cell in %.
   Refuse (with a plain reason) when there are fewer independent peaks than parameters.
5. Pass hkl to the Results step so per-peak E_hkl and the texture coefficient (Stage 7) can use them.
Tests: synthetic patterns from the library for cubic (Si), tetragonal (anatase), hexagonal (ZnO) and
orthorhombic (brookite) with a known strain of the cell (e.g. a +0.3 %) and noise must give back the cell within
3 sigma, and the correct hkl for every peak.
```

**You check:** the labelled figure looks like a paper figure. The lattice parameters are close to
the literature values for your material.

---

## 6. Stage 7: finish the XRD tool (2 sub-stages)

### 7a: Extra analyses

```text
Sub-stage 7a: texture coefficient, crystallinity, pattern character panel, cell volume in results.
1. Texture coefficient (Harris): TC(hkl) = [I(hkl)/I0(hkl)] / ((1/N) sum [I/I0]), using areas or heights
   (user choice) and the reference intensities of the selected phase; show TC per peak and a plain hint
   ("TC > 1 means more grains oriented with this plane parallel to the surface than in a random powder").
2. Crystallinity index: crystalline area / (crystalline + amorphous area) x 100 over a chosen 2theta range,
   with an adjustable amorphous hump (broad Gaussian or user anchor points) shown on the plot. Label it as a
   relative index that depends on the range and background choices.
3. "Pattern character" panel (estimate, never a verdict): rules such as one reflection family dominating
   (e.g. only 00l) suggests strong orientation or a thin film/epitaxial layer; most reference reflections present
   with near-reference intensities suggests a randomly oriented powder; very broad features suggest
   nanocrystalline or amorphous content. Each hint shows its reason and the words "estimate only; a powder
   pattern cannot prove single-crystal or layered structure".
4. Results page: add lattice parameters, unit cell volume, TC and crystallinity to the summary.
Tests: synthetic oriented patterns (00l x10) give TC(00l) > 1 and trigger the orientation hint; a known
crystalline/amorphous area ratio is recovered within 2 %.
```

### 7b: Figure builder, methods text, export, full flow

```text
Sub-stage 7b: publication figure builder, methods text, session export/import, final wizard order, e2e test.
1. Figure builder (step 8 Export): single or stacked patterns with offset, reference sticks under the pattern,
   hkl labels, legend with COD IDs, font Arial or Times, font size, line width, inward ticks, 2theta (degrees)
   and Intensity (a.u.) axis titles with proper symbols, presets 85 mm and 180 mm wide, SVG and PNG 300/600 dpi.
2. Methods text: a paragraph built only from the actual settings (instrument radiation and wavelength, step,
   smoothing, background method, Ka2 stripping, profile function, instrument correction method and standard,
   K value, methods used, reference phase and COD ID, software name). Copy button. No invented numbers.
3. Export everything: all CSV tables in one zip-free bundle (separate downloads or a combined CSV), figures,
   and a session JSON that restores the whole analysis on import (versioned, with migration).
4. Wizard order exactly as CLAUDE.md: 1 Upload, 2 Clean data, 3 Choose material, 4 Compare phases, 5 Fit peaks,
   6 Instrument correction, 7 Results, 8 Export. "Try with example data" works from step 1 to step 8.
5. End-to-end test with Playwright (Chromium is pre-installed; use executablePath /opt/pw-browsers/chromium if
   needed): example data → every step → export; check the session JSON round-trips.
```

**You check:** do one full run with your real file, from upload to the exported figure, the CSVs and
the methods paragraph. Compare the Scherrer size and the peak positions with your Origin numbers.
After merging, the XRD tool is complete.

---

## 7. Stage 8: UV-Vis (2 sub-stages)

### 8a: Import, conversions, cleaning

```text
Sub-stage 8a: UV-Vis module skeleton (src/core/uvvis, src/modules/uvvis), lazy-loaded, same wizard/plot/export.
Wizard: 1 Upload, 2 Data type and cleaning, 3 Band gap (8b), 4 Results and export.
1. Import csv/txt/xy: wavelength (nm) plus one or more sample columns; detect delimiter, decimal comma, headers.
2. Ask what y is: absorbance, %T or %R. Suggest from the value range; the user confirms.
3. Conversions (each in src/core with doc comment and test): A = 2 - log10(%T); T = 10^(-A);
   Kubelka-Munk F(R) = (1 - R)² / (2R) with R as a fraction; E (eV) = hc/lambda, with h, c and e taken from
   CODATA (cite) — 1239.84 eV nm is the rounded value.
4. Blank/baseline subtraction, optional Savitzky-Golay smoothing (reuse), overlay of samples, lambda max per sample.
5. Enable the UV-Vis card on the home page; "Try with example data" with a synthetic spectrum labelled synthetic.
```

### 8b: Tauc, Urbach and results

```text
Sub-stage 8b: Tauc band gap, Urbach energy, derivative method, results.
1. Tauc: y = (alpha·h·nu)^(1/n) vs h·nu, n = 1/2 direct allowed, 2 indirect allowed, 3/2 direct forbidden,
   3 indirect forbidden. alpha = 2.303·A/t when film thickness t is given, otherwise y axis labelled
   "proportional to alpha"; F(R) replaces alpha for reflectance data.
2. Linear fit region: automatic suggestion (the steepest straight stretch of the edge, by sliding-window R² and
   slope), draggable limits, extrapolation to y = 0, band gap with uncertainty from the fit covariance.
3. Show all four transition types side by side with R², labelled "guide only, choose from the literature for your
   material".
4. Optional Urbach energy (ln alpha vs E below the edge, Eu = 1/slope) and the derivative method (peak of
   dA/dE or d(ln alpha)/dE).
5. Results table (sample, lambda max, absorption edge, Eg, transition, R², method) with CSV; publication figures;
   methods text.
Tests: synthetic spectra built from a known Eg (direct and indirect, absorbance and reflectance) recover Eg within
0.02 eV; %T↔A round trip; K-M of R = 0.5 equals 0.25.
```

**You check:** put a real UV-Vis file and your Origin Tauc result into `tests/fixtures-real/`. The
band gap should agree within about 0.05 eV when you fit the same region.

---

## 8. Stage 9: FTIR (1 session)

Use the Stage 9 prompt from your file as written. Add these lines at the end:

```text
Extra rules: the functional-group table (data/ftir/groups.json) must cite a textbook or open reference for each
range that you can open in this session; if you cannot open one, include the range with "source: TODO, verify"
and list it in PROGRESS.md. Show "typical ranges, confirm against your literature" above the table.
Enable the FTIR card on the home page. Add an e2e happy-path test.
```

**You check:** use a real FTIR spectrum of something you know. Look at whether the suggested O–H,
C–H, C=O and metal–oxygen assignments make sense.

---

## 9. Stage 10: particle size from images (3 sub-stages)

### 10a: Image, scale and manual measuring

```text
Sub-stage 10a: particles module — image import (png, jpg; tif via a lazy-loaded, self-hosted decoder with the
dependency justified in PROGRESS.md; dm3/dm4 → export hint), canvas viewer with touch/mouse pan and zoom, crop
to remove the data bar, scale calibration (draw along the scale bar, type length and unit nm/µm, show
pixels per unit, keep for the session), manual tools (line, circle by diameter, ellipse) with IDs and a table.
Images over ~20 MP get a downscaled working copy; all results are mapped back to original pixels.
Enable the card on the home page. Tests: calibration math and measurement conversions.
```

### 10b: Automatic detection

```text
Sub-stage 10b: automatic particle detection in a Web Worker, plain TypeScript first (no OpenCV unless the
plain version is too slow on a 20 MP image — measure and report).
Pipeline: grayscale, optional invert, Gaussian/median denoise, threshold (Otsu, adaptive, manual slider),
morphological open/close, fill holes, connected components, distance transform + marker watershed to split
touching particles, filters (min/max area, circularity, exclude border-touching). Overlay outlines with IDs;
user can delete, merge, split and add particles. Per particle: area-equivalent diameter, max and min Feret,
aspect ratio, circularity.
Note on screen: "Automatic detection works best on well-separated particles with good contrast. Review the
outlines." Tests: synthetic images of discs with known diameters (separate and touching pairs) at a known scale
return the right count and diameters within 3 %.
```

### 10c: Distribution and export

```text
Sub-stage 10c: size distribution: histogram (Freedman-Diaconis, Sturges, manual bins), normal and lognormal fits
(maximum likelihood), mean, SD, median, D10, D50, D90, span (D90-D10)/D50, count, cumulative curve, warning below
100 particles, pooling several images. Export histogram SVG/PNG, particle CSV, annotated image PNG, methods text.
Tests: samples from a known lognormal distribution recover its parameters within tolerance; percentiles match a
hand-computed example.
```

**You check:** measure the same SEM image in ImageJ. The mean diameter and the count should be close
once the outlines have been reviewed.

---

## 10. Stages 11 and 12: thermal (4 sub-stages)

Use the Stage 11 and Stage 12 prompts from your file, split like this:

- **11a**: items 1–5 (import, describe the run, cleaning, DTG, step detection with onset, endset,
  mass loss, T5/T10/T50).
- **11b**: items 6–9 (event rule table, assignments, theoretical mass loss, calcination suggestion,
  plots and export). For `atomic-weights.json`, add: "download the current IUPAC standard atomic
  weights table from a page you can open and cite its URL and year; do not type values from memory".
- **12a**: Stage 12 items 1–6 (DSC only).
- **12b**: Stage 12 items 7–8 (combined TGA-DSC, re-ranking and the calcination update), plus the
  e2e test.

Start each with a line such as `Sub-stage 11a: Stage 11 items 1-5 only, as written in
docs/STAGE-PROMPTS.md`. Your stage-prompts file is saved in the repo as `docs/STAGE-PROMPTS.md`, and
the clean-up PR brings it into `main`.

**You check:** use a real TGA file of a precursor you know, for example a hydroxide or a plant
extract-based sample. The step mass losses should match your instrument software within about
0.5 %.

---

## 11. Stage 13 (optional), 14, 15 (optional)

- **Stage 13 (kinetics):** use your prompt as written. Only needed if you report activation
  energies.
- **Stage 14 (polish, audit, deploy):** use your prompt as written, in **two sessions**. First
  session: items 1–4 (responsive, Lighthouse, accessibility, states). Second session: items 5–8
  (About page, PWA, deploy workflow, final PROGRESS). Before Stage 14 you must have done the manual
  Firebase step: create the project, put its ID in `.firebaserc`, and add the
  `FIREBASE_SERVICE_ACCOUNT` secret on GitHub as the README describes.
- **Stage 15 (Gemini):** use your prompt as written. It must read the current Firebase AI Logic
  docs first. It also has to widen the CSP `connect-src` for the Firebase endpoints only, and keep
  the feature lazy-loaded.

---

## 12. Things that cause errors, and how this plan avoids them

| Risk                                                | Prevention                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| New session cannot see earlier work                 | Merge every PR into `main` before the next sub-stage (section 2.1, section 3 step 7).   |
| Invented COD IDs, constants or citations            | Guardrail block; 6a downloads and checks every CIF and cross-checks with pymatgen.      |
| Wrong hkl or reference intensities                  | 6a cross-check table; you check anatase (101) and rutile (110) by hand.                 |
| Model does too much at once and breaks things       | One sub-stage per session; plan first; tests after each piece.                          |
| Bundle grows and the site gets slow                 | Lazy-loaded modules; `npm run size` in CI fails the PR when over budget.                |
| Numbers look right on synthetic data, wrong on real | Your real files in `tests/fixtures-real/` plus your Origin/ImageJ numbers.              |
| Session ends before pushing                         | "Commit in small steps, push" is in the guardrail; ask "push now" if a session is long. |
| COD blocked in a new environment                    | Use this same environment, or allow `www.crystallography.net` in its network settings.  |

## 13. Order at a glance

1. Clean-up (2.1), real files (2.2)
2. 5.9 catch-up
3. 6a → 6b → 6c → 7a → 7b (XRD complete)
4. 8a → 8b (UV-Vis)
5. 9 (FTIR)
6. 10a → 10b → 10c (particles)
7. 11a → 11b → 12a → 12b (thermal)
8. 13 (optional)
9. 14 (two sessions) → deploy
10. 15 (optional)

That is about 20 sessions. Merge after every one.
