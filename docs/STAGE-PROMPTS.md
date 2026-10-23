# XRD Toolkit: How to Build It with Opus 5.5, Stage by Stage

## Part A. One-time setup

1. Create a Firebase project on the free Spark plan (console.firebase.google.com) and note its project ID. Enable Hosting only.
2. On GitHub create a new repository (for example `xrd-toolkit`) and tick "Add a README" so it has a main branch.
3. Open claude.ai/code (or the Code tab in the Claude mobile app) and connect GitHub when asked. This installs the Claude GitHub App.
4. Create a cloud environment. Check its network access setting. Stage 6 needs to download open crystal data from the COD website (cod.crystallography.net). If the network blocks it, Opus will tell you. Then either allow that domain or download the files yourself.
5. Choose your repository in the selector below the input box, and choose Opus 5.5 in the model picker.
6. Send the first message below (Part B) to put the master brief into the repo.

Important: every cloud session starts from a fresh clone of the repo. Only committed and merged work carries over. After each stage, merge its pull request into main before you start the next stage.

## Part B. First message: save the master brief

Copy the full text of CLAUDE.md, then send this message with it pasted at the end:

```text
Create a file named CLAUDE.md at the repository root with exactly the content below. Commit it to a branch called setup-claude-md and open a pull request. Do nothing else and do not start building yet.

[PASTE THE FULL CLAUDE.md TEXT HERE]
```

Merge that pull request. From now on every session reads CLAUDE.md automatically.

## Part C. The loop for every stage

1. Start a new session (or continue if the chat is still short). Select the repo and Opus 5.5.
2. Paste the stage prompt. Do not combine stages.
3. Let it finish. Read its summary and its list of anything that did not work.
4. Test it: pull the branch and run `npm install && npm run dev`, or use the Firebase preview deploy from Stage 0.
5. Send the review prompt (Part D). Then send fix prompts if needed.
6. Merge the pull request. Start the next stage.

Tips:
- Put a few of your own real files in `tests/fixtures-real/` when a stage asks for them (an XRD file, a UV-Vis file, an FTIR file, an SEM image, a TGA file, a DSC file). Compare Opus's numbers with Origin or ImageJ on the same file. This is the best check you have.
- If a new session loses context, use the resume prompt in Part D.

## Part D. Reusable prompts

Review prompt (send after every stage):

```text
Review your own work against CLAUDE.md and the acceptance criteria of this stage. List every requirement that is not fully met, every shortcut you took, and every number or data item you could not verify. Then try to break the feature with bad input (empty file, wrong columns, huge file, tiny screen) and fix what breaks. Report real command output for lint, type check, tests and build.
```

Fix prompt template:

```text
Problem: [describe what you saw, with the file name or screenshot]. Expected: [what should happen]. Find the root cause, fix it, add a test that would have caught it, and update docs/PROGRESS.md.
```

Resume prompt (new session):

```text
Read CLAUDE.md and docs/PROGRESS.md. Tell me in five lines where the project stands, then wait for my next instruction.
```

## Stage map

- Stage 0: Foundation and app shell
- Stage 1: XRD import and plotting
- Stage 2: XRD data cleaning
- Stage 3: Peak detection and fitting
- Stage 4: Instrumental broadening correction
- Stage 5: Crystallite size and strain methods
- Stage 6: Reference library and phase matching
- Stage 7: Extra XRD analyses, report and full XRD flow
- Stage 8: UV-Vis tool
- Stage 9: FTIR tool
- Stage 10: Particle size from images
- Stage 11: TGA tool
- Stage 12: DSC tool and combined TGA-DSC
- Stage 13 (optional): Multi-heating-rate kinetics
- Stage 14: Polish, audit and deploy
- Stage 15 (optional): Gemini text assistant

If you run an optional stage after Stage 14, re-run the audit part of Stage 14 for the new feature.

## Part E. Stage prompts

### Stage 0: Foundation and app shell

```text
Read CLAUDE.md. Stage 0 only: project foundation. Do not implement any science yet.

Build:
1. Vite + TypeScript (strict) + Preact project with the folder structure from CLAUDE.md, ESLint, Prettier and Vitest.
2. Design tokens (colours, spacing, type scale, radii), light and dark themes, and a clean minimal layout that works from 360 px to 1920 px.
3. A home page with five tool cards (XRD, UV-Vis, FTIR, Particle size, TGA and DSC). Only XRD opens, to an empty wizard. The others show "Coming soon".
4. A reusable Wizard component: stepper (compact on mobile), Back and Next, per-step validation hook, progress indicator, and a state store persisted in IndexedDB so a refresh does not lose work. Include a reusable "What is this?" help popover component.
5. firebase.json for Hosting only, with long-cache headers for hashed assets and sensible security headers including a strict Content Security Policy. Leave the Firebase project ID as a placeholder I can fill.
6. GitHub Actions: on every pull request run lint, type check, tests, build and a bundle-size check against the budget in CLAUDE.md. Also add a Firebase Hosting preview-deploy workflow, and write clear instructions in the README for the manual secrets step I must do.
7. docs/PROGRESS.md and a README.

Acceptance: npm run dev, lint, test and build all pass. Lighthouse mobile performance 90+ on the empty shell. The wizard works with dummy steps and keeps its state after refresh. Stop when done and summarise.
```

### Stage 1: XRD import and plotting

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 1 only: XRD data import and plot.

Build:
1. File import by drag and drop, file picker and pasting text. Parsers for .xy, .xye, .dat, .txt and .csv (auto-detect delimiter, header lines, two or three columns), .xrdml (XML) and Rigaku .ras (ASCII). For binary formats you cannot parse (such as Bruker .raw or .brml) show a friendly message telling the user to export as .xy or .csv from the instrument software. Do not fake support.
2. Validation with plain-language messages: 2theta must increase, step size, point count, detect obviously wrong units, counts versus counts per second.
3. A data summary card (range, step, points, max intensity).
4. An SVG plot component: zoom, pan (touch and mouse), hover readout, 2theta range controls, normalise option, multiple pattern overlay with vertical offset, publication-style axes (2theta in degrees, intensity in a.u.).
5. Export of the plot as SVG and PNG (300 and 600 dpi) with single-column and double-column presets.
6. A "Try with example data" button using a synthetic pattern you generate. State clearly in the UI and the docs that it is synthetic.
7. Wire this as wizard step 1 and step 2 placeholder.

Tests: parser tests for every supported format using fixtures you create. Also ask me to put one real XRD file in tests/fixtures-real/ and test that it loads.

Acceptance: all formats load, bad files give friendly errors, a 50,000 point file stays smooth, lint/test/build pass.
```

### Stage 2: Data cleaning

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 2 only: XRD preprocessing in src/core with a clean UI step.

Build:
1. Radiation selector (Cu, Co, Cr, Fe, Mo, Ag K-alpha, with K-alpha1 and K-alpha2 wavelengths and intensity ratio). Use standard tabulated values and cite the source in comments. Flag them for my verification.
2. Smoothing: Savitzky-Golay with adjustable window and order.
3. Background removal: iterative polynomial, SNIP, and manual anchor points the user can click. Show the background curve live.
4. K-alpha2 stripping (Rachinger correction), optional.
5. Optional zero-shift correction and normalisation.
6. Before and after toggle, per-step enable switches, reset, and a short plain-language description of each option.

Tests: synthetic data with a known background and a K-alpha2 doublet. Show that the corrections recover the true peak heights and positions within stated tolerances.

Acceptance: processing a 50,000 point pattern updates smoothly (use a worker if needed). All steps reversible.
```

### Stage 3: Peak detection and fitting

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 3 only: peak detection and fitting.

Build:
1. Automatic peak detection with a prominence slider and minimum separation control.
2. Grouping of overlapping peaks into fit regions.
3. Levenberg-Marquardt fitting in a Web Worker for Gaussian, Lorentzian and pseudo-Voigt (mixing parameter free or fixed) with local linear background and parameter bounds. Report parameter uncertainties from the covariance matrix and R-squared per region.
4. Plot overlay of the total fit, each component, and a residual panel below.
5. The user can click to add, remove or drag peak positions and re-fit.
6. Peak table: 2theta, d-spacing (Bragg), FWHM (degrees and radians), integral breadth, height, area, relative intensity. Sortable, exportable to CSV.

Tests: synthetic noisy peaks with known parameters must be recovered within tolerance, including two overlapping peaks. Also ask me for a real file and compare against my Origin fit.

Acceptance: fitting 30 peaks completes in a few seconds without freezing the UI.
```

### Stage 4: Instrumental broadening correction

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 4 only: instrumental broadening correction.

Build three ways to provide the instrument contribution:
(a) the user types a constant instrumental FWHM,
(b) the user types Caglioti parameters U, V, W,
(c) the user uploads a standard pattern (LaB6 or Si). Reuse the Stage 3 peak fitting, then fit a smooth FWHM versus 2theta curve (Caglioti or a low-order polynomial) and show the curve with its points.

Correction methods the user can choose between: Gaussian (subtract squares), Lorentzian (subtract linearly) and an approximate Voigt correction. Default to Gaussian and explain in plain language when each is appropriate.

Warnings: if the corrected width is zero or negative, or the instrument width is a large fraction of the observed width, mark that peak as "limited by instrument resolution, size is a lower limit". Add a visible note that skipping this correction makes crystallite sizes come out smaller than reality.

Show a before and after table of FWHM per peak. Add a "skip correction" option that adds a persistent warning in the results.

Tests: synthetic peaks broadened by a known instrument function must give back the true width after correction.
```

### Stage 5: Crystallite size and strain methods

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 5 only: size and strain calculations in src/core with a results UI.

Implement, each with doc comments giving the equation and units:
1. Scherrer (K editable, default 0.9).
2. Monshi-Scherrer (ln beta versus ln(1/cos theta)).
3. Williamson-Hall: UDM, USDM and UDEDM (UDEDM needs a Young's modulus input, and per-direction modulus if the user provides it).
4. Size-Strain Plot.
5. Halder-Wagner.
6. Derived quantities: microstrain, stress or energy density where the method defines it, dislocation density (1 over D squared), and specific surface area (user enters density).

UI: one results table per method, the fit line plot for each plot-based method with R-squared, a summary table with the average and standard deviation per method, and a comparison bar chart. Add plain-language guidance on which method suits which sample. Detect and warn about physically meaningless results (negative strain, negative intercept) instead of silently displaying them.

Tests: build synthetic peak widths from a known size and strain and check that every method recovers them within a justified tolerance.

Acceptance: all numbers update live when the user changes K, the correction option or the peak selection. CSV export for every table.
```

### Stage 6: Reference library and phase matching

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 6 only: reference library, material selector, phase comparison, Miller indices.

Part 1, build script (scripts/build-reference-library.ts):
- Query the Crystallography Open Database for CIF files. Never use COD IDs from memory: search the database, then verify that the formula and space group match what I expect, and record the COD ID, formula, space group, lattice parameters and the entry's literature reference.
- Starter list: TiO2 (anatase, rutile, brookite), ZnO (wurtzite), Fe3O4, Fe2O3 (hematite), CuO, Cu2O, NiO, Co3O4, CeO2, SnO2, WO3, Al2O3, SiO2 (quartz), CdS, ZnS, BaTiO3, SrTiO3, CaCO3 (calcite), MoS2, graphite, Si, LaB6, and fcc metals Au, Ag, Cu, Pt. If an entry cannot be verified, skip it and list it in docs/PROGRESS.md.
- From each CIF compute a kinematic powder pattern (multiplicity, Lorentz-polarisation, structure factor using tabulated atomic scattering factors, Debye-Waller factors if present in the CIF). Store hkl, d-spacing and relative intensity, which do not depend on wavelength. Output compact JSON, one file per material family, lazy-loaded.
- If the network is blocked, stop and tell me.

Part 2, UI (wizard steps 3 and 4):
- A searchable material selector by name or formula. After choosing a family, list its phases (for example anatase, rutile, brookite).
- Compute 2theta for the selected radiation at runtime and draw reference stick patterns under the measured data.
- A match score per candidate: intensity-weighted fraction of strong reference peaks that line up with detected peaks within an adjustable tolerance, tolerant of a small zero shift. State clearly that the score is only a guide.
- The user selects one or more phases. Then label peaks with (hkl), highlight the strongest peak, and print the reference ID (COD ID) on the plot legend and in tables.
- A combined table: 2theta observed, 2theta reference, d observed, d reference, hkl, relative intensity, reference ID.
- Optional text box where the user types a JCPDS/ICDD number to show in tables. Label it "entered by user, not verified".
- Lattice parameter least-squares refinement for cubic, tetragonal, hexagonal and orthorhombic systems, with uncertainties and a comparison with the reference cell.
- A note on the page: automatic matching works for simple, well-separated phases and is not reliable for complex mixtures.

Tests: a pattern computed from the library itself, with a small random shift and noise, must match its own phase best and recover the lattice parameter.
```

### Stage 7: Extra analyses, report and full XRD flow

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 7 only: finish the XRD tool end to end.

Build:
1. Texture coefficient (Harris) against reference intensities, and a preferred-orientation hint.
2. Crystallinity index from crystalline versus amorphous area (with an adjustable amorphous hump fit).
3. A cautious "pattern character" panel: hints such as one dominant reflection family suggesting strong orientation or a thin film, and many reflections with reference-like intensities suggesting a randomly oriented powder. Label it clearly as an estimate and never as a verdict.
4. Unit cell volume and a combined results page with every table.
5. Publication figure builder: single pattern or stacked patterns, reference sticks under the pattern, hkl labels, legend with reference IDs, adjustable fonts and sizes, journal width presets.
6. Methods text generator based on the real settings used.
7. Export everything: figures, CSV tables, and a session JSON that can be re-imported to restore the whole analysis.
8. Wire all wizard steps in the final order from CLAUDE.md so a beginner can go from upload to export without leaving the wizard.

Acceptance: a full end-to-end run with the example data and with one real file. Write an end-to-end test for the happy path.
```

### Stage 8: UV-Vis tool

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 8 only: the UV-Vis module, using the shared wizard, plot and export system.

Build:
1. Import csv, txt and xy files (wavelength in nm, one or several sample columns). The user chooses whether the y values are absorbance, % transmittance or % reflectance (suggest from the value range, user confirms).
2. Conversions: absorbance from transmittance (A = 2 - log10 %T), Kubelka-Munk F(R) = (1 - R)^2 / (2R) for diffuse reflectance, photon energy from wavelength (E = 1239.84 / wavelength in nm).
3. Baseline and blank correction, optional smoothing, overlay of several samples.
4. Tauc plot for band gap with a selector for the transition type (direct allowed, indirect allowed, direct forbidden, indirect forbidden) and the matching exponent. Use F(R) in place of alpha for reflectance data. If the user enters film thickness, use alpha = 2.303 A / t, otherwise label the y axis clearly as proportional to alpha.
5. A draggable linear fit region with an automatic suggestion (steepest linear region), extrapolation to the energy axis, and band gap with its uncertainty. Show all four transition types side by side with their R-squared as a guide only.
6. Optional Urbach energy and derivative method for the absorption edge.
7. Results table (lambda max, absorption edge, band gap per sample) and publication-quality plots with export.

Tests: synthetic spectra with a known band gap must return it within tolerance. Ask me for a real file to compare against my Origin Tauc result.
```

### Stage 9: FTIR tool

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 9 only: the FTIR module.

Build:
1. Import csv, txt, dpt and JCAMP-DX (.jdx) files. For unsupported binary formats show an export hint, do not fake support.
2. Detect whether the data is absorbance or % transmittance (suggest, user confirms) and convert between them (A = 2 - log10 %T). Show the wavenumber axis reversed (high to low) as is standard, with a zoom to the fingerprint region.
3. Baseline correction (rubber-band, polynomial, asymmetric least squares), smoothing and normalisation, each with a before and after toggle.
4. Peak picking with a prominence slider, then a peak table (wavenumber, intensity, relative intensity).
5. A built-in functional group reference table stored as JSON (typical textbook wavenumber ranges for common groups such as O-H, N-H, C-H, C=O, C=C, C-O, metal-oxygen bands). Suggest assignments for each picked peak. The user can accept, edit or remove them. Label the table "typical ranges, confirm against your literature" and flag the ranges for my verification.
6. Plot labels with leader lines that avoid overlapping, overlay and stacked offset of several samples, and publication-quality export.

Tests: synthetic spectra with known peak positions and a known %T to A conversion.
```

### Stage 10: Particle size from images

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 10 only: the particle size distribution module.

Build:
1. Image import: png, jpg and tif (lazy-load a TIFF decoder). For proprietary formats such as dm3 or dm4 tell the user to export as png or tif.
2. A canvas viewer with touch and mouse pan and zoom, and a crop tool to remove the SEM or TEM data bar.
3. Scale calibration: the user draws a line across the scale bar and types its real length and unit (nm or um). Show the resulting pixels-per-unit and keep it for the session.
4. Manual measurement tools: line (length), click to draw a circle by diameter, and ellipse. Each measurement gets an ID and appears in a table.
5. Automatic mode: grayscale, optional invert for bright or dark particles, denoise, threshold (Otsu, adaptive or manual slider), morphological cleanup, fill holes, and splitting of touching particles with distance transform and watershed. Filters for minimum and maximum size and circularity, and an option to exclude particles touching the image border. Prefer lazy-loaded OpenCV.js in a Web Worker, self-hosted, with a plain TypeScript fallback if it harms the performance budget.
6. Overlay outlines with IDs. The user can click to delete a particle, merge or split, and add missed particles manually.
7. Per-particle metrics: area-equivalent diameter, maximum and minimum Feret diameter, aspect ratio. The user chooses which size metric defines the distribution.
8. Distribution output: histogram (Freedman-Diaconis, Sturges or manual bins), normal and lognormal fits, mean, standard deviation, median, D10, D50, D90, relative spread, count, and a cumulative curve. Warn when fewer than 100 particles are measured. Allow pooling several images.
9. Export histogram as SVG and PNG, particle table as CSV, and the annotated image as PNG.

Add a visible note that automatic detection works best on well separated particles with good contrast and that the user should review the outlines.

Tests: synthetic images with circles of known sizes and known scale must return the right distribution. Ask me for a real SEM image to try.
```

### Stage 11: TGA tool

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 11 only: the TGA module (src/core/thermal and src/modules/thermal), using the shared wizard, plot and export system. DSC comes in the next stage, so design the data model so that TGA, DSC and combined TGA-DSC files share one importer and one temperature axis.

Wizard steps: 1 Upload and describe the run, 2 Clean data, 3 Mass loss steps, 4 Assign events, 5 Calcination suggestion, 6 Results and export.

Build:
1. Import csv, txt and xy files, including plain-text exports from common instruments (header blocks before the data, tab or semicolon separators, comma decimal marks). The user maps columns: temperature (degrees C or K), mass (mg or %), optional time, optional heat flow. Do not fake support for binary vendor formats; tell the user to export text or csv.
2. A short "describe the run" form: atmosphere (nitrogen, argon, air, oxygen, other), heating rate in K per min, initial mass, and what the sample is (free text plus an optional category such as metal hydroxide or salt precursor, polymer, biomass or plant extract, composite, other). Convert mass in mg to percent of initial mass. Show everything the user entered in the results.
3. Cleaning: select the heating ramp (trim isothermal and cooling segments), smoothing, optional blank or buoyancy curve subtraction, and normalisation to the mass at a chosen start temperature (for example after moisture loss).
4. DTG curve (derivative of mass with respect to temperature, optionally time) using Savitzky-Golay with adjustable window, shown in a panel below or on a second axis.
5. Step detection from DTG peaks with prominence and minimum separation controls. For each step report: onset temperature (extrapolated tangent method: intersection of the baseline before the step with the tangent at the point of steepest slope), DTG peak temperature, endset temperature, mass loss in percent and in mg, and residual mass after the step. Also report T5%, T10% and T50%, and the residue at a temperature the user chooses. The user can drag step limits and see numbers update. Overlapping steps are reported as one region with a clear note, with an optional DTG deconvolution into Gaussian components (reuse the Stage 3 fitter) labelled as an approximation.
6. Event assignment from a JSON rule table (data/thermal/events.json) of typical temperature ranges for events such as: loss of adsorbed moisture and volatile solvents, loss of bound or crystal water, decomposition of organic capping agents and plant-extract biomolecules, polymer degradation, dehydroxylation of metal hydroxides, decomposition of nitrate, acetate or other precursor salts, decomposition of carbonates, and oxidation of carbon (only in oxidising atmospheres). Each rule has the event name, typical range, atmosphere condition and notes about overlap. Use standard textbook ranges, cite the sources inside the file, and flag the whole table for my verification.
   For each detected step show up to three ranked candidate assignments with a plain-language reason (temperature range, atmosphere, size of the mass loss, sample category) and a confidence label (low, medium or high; most should be low or medium). The user accepts, changes or rejects each one. Never present an assignment as certain. Show a note that TGA alone cannot identify the evolved species and that coupled MS or FTIR, or other characterisation, is needed for certainty.
7. Theoretical mass loss check: the user enters the precursor and expected product formulas and the reaction (for example a hydroxide losing water to give an oxide). The app computes the theoretical mass loss from molar masses (store IUPAC standard atomic weights in data/thermal/atomic-weights.json and cite the source) and compares it with the measured step, showing the difference. Include a few ready examples in a dropdown, each checked by hand in the tests.
8. Calcination suggestion: find the last significant mass loss step (adjustable threshold) and suggest a minimum calcination temperature equal to its endset temperature plus an adjustable safety margin (default 50 degrees C). Show the flat mass plateau above it. If DSC data is loaded (next stage), also mark exothermic events with no mass change above that temperature as possible crystallisation or phase transitions. Present a range with the reasoning, and propose three candidate temperatures for the user to test, so the user can confirm with XRD of the calcined samples. Add a visible warning that dynamic TGA temperatures depend on heating rate, sample mass and atmosphere, that hold time during calcination matters, and that the suggestion is a starting point and not an optimal temperature.
9. Plots: mass (%) versus temperature with the DTG curve, annotated steps with their numbers, shaded step regions, publication-quality export. Results table with CSV export. Methods text generator based on the real settings.

Tests: synthetic TGA curves built from known steps (known onset, mass loss and residue) must be recovered within tolerance. Theoretical mass loss examples must match hand calculations. Ask me for a real TGA file and compare with my instrument software or Origin.

Acceptance: a 10,000 point file stays smooth, all numbers update live when step limits move, lint, test and build pass.
```

### Stage 12: DSC tool and combined TGA-DSC

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 12 only: DSC and combined TGA-DSC in the thermal module. Reuse the Stage 11 importer, cleaning and plotting.

Wizard steps: 1 Upload, 2 Clean data, 3 Baseline and events, 4 Glass transition and crystallinity, 5 Combined interpretation, 6 Results and export.

Build:
1. Import with heat flow in mW, mW per mg or W per g. The user chooses the sign convention (exo up or exo down), and every plot and table shows it clearly. Normalise by sample mass when the user enters it. Detect heat-cool-heat segments from the temperature direction and let the user choose heating 1, cooling or heating 2, with an overlay option.
2. Baselines: linear, sigmoidal (for step changes) and spline, drawn between adjustable limits and shown live.
3. Peak detection for endothermic and exothermic events, reporting extrapolated onset, peak and endset temperatures and the enthalpy (integral between curve and baseline) in J per g, and J per mol if the user enters a molar mass.
4. Glass transition: half-height midpoint Tg, onset, endset and the heat capacity change.
5. Polymer crystallinity: Xc = (dHm - dHcc) / (w x dH0) x 100, with the melting enthalpy, the cold crystallisation enthalpy, the polymer weight fraction w, and dH0 (enthalpy of a fully crystalline polymer) entered by the user. Do not ship reference dH0 values unless you can verify them. If you add examples, flag them for my verification.
6. Event type guidance: for each DSC event list ranked possible interpretations (melting, dehydration or evaporation, crystallisation, oxidation, solid-solid transition, decomposition) with the reasoning (endotherm or exotherm, peak shape, temperature, atmosphere). The user confirms. Labelled as guidance.
7. Combined TGA-DSC: if one file has mass and heat flow (simultaneous thermal analysis), or the user uploads two files, align them on temperature by interpolation and show a dual panel or dual axis plot. Apply these correlation rules and show them in plain language: mass loss with an endotherm suggests dehydration, evaporation or decomposition; mass loss with an exotherm suggests combustion or oxidation; no mass change with an exotherm suggests crystallisation, a phase transition or structural ordering; no mass change with an endotherm suggests melting or a solid-solid transition. Use the DSC evidence to re-rank the Stage 11 event assignments, and update the calcination suggestion to mark a crystallisation exotherm above the last mass loss step. All of this is guidance, clearly labelled.
8. Export plots, CSV tables and a Methods text paragraph.

Tests: a synthetic DSC peak with a known area must give that enthalpy within tolerance, a synthetic sigmoidal step must return its known Tg midpoint, and switching exo up to exo down must flip the plot and the signs consistently. Ask me for a real DSC file and a real combined TGA-DSC file.

Acceptance: the combined view lines up the two curves exactly on temperature, and the end-to-end happy path has a test.
```

### Stage 13 (optional): Multi-heating-rate kinetics

Skip this stage if you do not need activation energies.

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 13 only: optional thermal kinetics from several heating rates.

Build:
1. Load three or more runs of the same sample at different heating rates (five is better). The user picks the event to analyse and the heating rate of each file.
2. Kissinger method: plot ln(beta / Tp^2) against 1 / Tp, where Tp is the peak temperature of the event, and obtain the apparent activation energy from the slope.
3. Flynn-Wall-Ozawa and Kissinger-Akahira-Sunose isoconversional methods for TGA data: compute the conversion alpha = (m0 - m) / (m0 - mf), then at fixed alpha plot ln(beta) against 1 / T (FWO, using the Doyle approximation with slope about -1.052 Ea / R) and ln(beta / T^2) against 1 / T (KAS, slope -Ea / R). Show Ea versus alpha with R-squared at each point.
4. Use the standard gas constant, cite the source in the code, and document each equation in the doc comments.
5. Plain-language warnings: the result is an apparent activation energy, it needs enough heating rates, and a strongly varying Ea against alpha means a multi-step process, so a single number is misleading.
6. Plots, tables and CSV export in the shared system, and a Methods text paragraph.

Tests: generate synthetic single-step data from a chosen activation energy and check that each method recovers it within tolerance.
```

### Stage 14: Polish, audit and deploy

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 14 only: polish, audit, deployment.

Do:
1. Audit every tool at 360, 768, 1280 and 1920 px. Fix overflow, tiny touch targets, plot readability and keyboard traps.
2. Run Lighthouse on mobile for the home page and each tool. Fix anything under 90. Check the bundle budget and code splitting.
3. Accessibility pass: labels, focus order, contrast AA, reduced motion.
4. Friendly empty states, error boundaries and loading states everywhere.
5. An About page with every equation used, the assumptions, the limitations (no Rietveld, automatic matching only for simple phases, thermal event assignments and calcination temperatures are suggestions, estimates are estimates), a privacy statement (data stays in the browser) and the COD attribution.
6. Optional: offline support as a PWA if it does not hurt the performance budget.
7. Finish the Firebase Hosting deployment workflow and write precise deployment steps in the README.
8. Update docs/PROGRESS.md with a final status, known issues and ideas for later.

Report honest Lighthouse and test numbers.
```

### Stage 15 (optional): Gemini text assistant

```text
Read CLAUDE.md and docs/PROGRESS.md. Stage 15 only: optional Gemini assistant.

First read the current Firebase AI Logic documentation, including the Gemini Developer API free tier, current rate limits and App Check setup. Do not rely on memory. Then tell me the exact limits and any risks before you build.

Build:
1. Two buttons per tool: "Explain my results in simple words" and "Draft a results and discussion paragraph".
2. Send only the final summary numbers and settings (tables), never the raw uploaded data.
3. A strict system prompt: use only the numbers provided, never calculate, never invent references or values, and mark the output as "AI-generated draft, check before using".
4. Graceful handling of quota errors, offline use and API failure. The whole site must keep working with the feature turned off.
5. Guide me through the manual setup steps I must do in the Firebase console (enable the API, App Check).

Acceptance: the feature is lazy-loaded and adds nothing to the initial bundle.
```
