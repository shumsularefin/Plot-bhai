# Progress

## Owner feedback round, stage 6 of 6: Validate button and counters (done)

Branch `claude/zen-edison-acnmco`. No new dependencies (the Worker test uses Node's built-in
`node:sqlite`). Setup steps for the owner: docs/feedback.md.

### What was built

- **Validate button** in the header of every analysis wizard, highlighted in the accent colour.
  Its pop-up says the tool is an early testing version and asks "Did it work for your data?"
  (It worked / Something is wrong) with an optional comment of up to 1000 characters, and says
  exactly what is sent. Escape, the Close button and a click outside close it.
- **No validation without an analysis:** reaching the last step of a wizard records a finished
  analysis with the service and keeps its proof (an HMAC of the analysis ID, browser ID and
  section) in local storage. Without a proof the pop-up asks the user to finish an analysis
  first and offers no Send button; the service checks the proof again, accepts one validation
  per analysis and only from the same browser and section, on the day of the analysis or the next.
- **Limits** per day: 30 analyses and 5 validations per browser, 100 analyses and 20 validations
  per IP address, 20 browsers counted as visits per IP; a browser's visit counts once a day.
  IP addresses and browser IDs are stored only as HMAC hashes (the IP hash includes the day), and
  the limit rows are deleted after two days.
- **Comments are published only after approval:** validations with a comment are stored as
  pending; the owner lists, approves or rejects them with the admin token (curl commands in
  docs/feedback.md). Validations without a comment are counted straight away.
- **Home page "Testing so far":** visit, analysis and validation counters and the approved
  comments. Hidden while the service cannot be reached.
- **Service:** `worker-feedback/` (Cloudflare Worker, D1 database `plot-bhai-feedback`,
  `schema.sql`), deployed by `.github/workflows/feedback-worker.yml`, which finds or creates the
  database, creates the tables, deploys and sets the two secrets. It skips itself until the
  secrets exist. Writes are accepted only from the site's origins; without secrets it answers 503.
- CLAUDE.md section 2, the About privacy note and the CSP `connect-src` updated for the second
  backend.

### Decisions

- The limits and the two-day proof window are my choice; they are constants in
  `worker-feedback/feedback.js`.
- A finished analysis is "reached the last step of the wizard", the same for every tool.
- The site works fully without the service: every request fails quietly, the counters are
  hidden, and the pop-up says validation is unavailable when the service is switched off.

### Checked

- `tests/feedback-worker.test.ts` (7 tests): a visit once per browser a day, validation only
  with the proof from the same browser, one per analysis, comments private until approved and
  the admin token, daily limits per browser and IP, bad input and writes from other sites
  refused, no IP or browser ID stored in clear, 503 without secrets.
- `tests/feedback-ui.test.tsx` (5 tests): pop-up without an analysis, send with proof and
  trimmed comment, refusal message, home counters and comments, hidden when switched off.
- e2e with the service stubbed: XRD run → Validate → comment sent with the proof; home counters
  shown.
- Type check, lint, 892 tests (1 skipped), build, bundle size and e2e pass.

### Known issues and owner actions

- **The service is not deployed yet.** Add the D1 permission to the Cloudflare token and the
  secrets `FEEDBACK_PROOF_SECRET` and `FEEDBACK_ADMIN_TOKEN`, then run the "Feedback worker"
  workflow (docs/feedback.md). Until then the counters stay hidden and Send reports that the
  service could not be reached.
- Still open from stage 5: verify the Ditmars sapphire table, the Starink constants, the E928
  fraction range and the Swanepoel equation numbers; confirm the FTIR step 3 flicker fix.

### Next

All six stages of the owner feedback round are done.

## Owner feedback round, stage 5 of 6: remaining science (done)

Branch `claude/zen-edison-acnmco`. No new dependencies. Two new wizards (UV-Vis "Plasmon and
thin film", thermal "DSC: Cp, purity, OIT"), each lazy-loaded, plus additions to existing tools.

### What was built

- **Kinetics (thermal):** Starink isoconversional method, ln(β/T^1.92) = C − 1.0008·Ea/(RT)
  (constants from Balogun et al., Sci. Rep. 11 (2021) 13862, eq. 8; TODO, verify against
  Starink 2003); Friedman differential method, ln(β·dα/dT) against 1/T with dα/dT from the DTG;
  Coats–Redfern for each run with eleven reaction models (F1, F2, A2–A4, R2, R3, D1–D4; g(α)
  from Qin 2022 Table 3 and Tang 2025), ranked by R², with A from the intercept. Tables, plots,
  CSV and methods sentences for each.
- **FTIR ATR correction** (Clean step, first in the order): A·ν̃/ν̃_ref, with the Harrick
  penetration depth dp = λ/(2π n₁ √(sin²θ − (n₂/n₁)²)) reported at the reference and at
  3000 cm⁻¹, and a warning when sin θ ≤ n₂/n₁. Saved FTIR state version 3 (older sessions get the
  correction switched off).
- **DSC heat capacity (sapphire method, ASTM E1269 style):** blank, sapphire and sample runs,
  cp = cp,sapphire·(D_s/D_st)·(m_st/m_s) every chosen step. Sapphire values from Ditmars et al.,
  J. Res. NBS 87 (1982) 159, Table 2 (SRM 720), in `data/thermal/sapphire-cp.json` (200 to
  1000 K, linear interpolation). **TODO, verify:** the table was typed in by hand from a scan;
  please check each row. The page says so next to every result.
- **DSC purity (van ’t Hoff, ASTM E928 style):** partial areas above a straight baseline give
  the fraction melted F; T_s against 1/F is fitted over F = 0.1 to 0.5 (adjustable; the default
  is TODO, verify against E928), giving T₀ and x₂ = −slope·ΔH_f/(R T₀²) with ΔH_f from the whole
  peak and the molar mass. Labelled an estimate: no linearisation or thermal-lag correction.
- **Oxidation induction time:** time from the gas switch to the intersection of the tangent at
  the steepest rise with a baseline fitted after the switch. Time and heat flow are read
  straight from the columns, so isothermal exports with a constant temperature work.
- **TGA evolved gas (TGA–MS or TGA–FTIR):** a results section that loads a file with a
  temperature or time column and signal columns, maps time onto the TGA run's own
  time-temperature columns, lays every signal (scaled to its maximum) over the DTG, and lists the
  temperature of each maximum and the step containing it. The page and the methods text say that
  naming the gas behind a signal is the user's interpretation. Saved TGA state version 4.
- **UV-Vis plasmon band fit:** absorbance fitted on the photon energy axis (E = hc/λ) with
  Lorentzian, Gaussian or pseudo-Voigt bands plus a straight background, in the peaks worker
  (`fitBandRegion`, now shared with the FTIR band fit). Centre and FWHM in eV and nm. The help
  says that turning them into a particle size needs a model the site does not provide.
- **UV-Vis Swanepoel thin-film method** (Swanepoel, J. Phys. E 16 (1983) 1214): fringe extrema,
  linear envelopes, n from N = 2s(T_M − T_m)/(T_M T_m) + (s² + 1)/2, a first thickness from
  neighbouring extrema of the same kind, one consistent series of order numbers, the final
  thickness and refined index. Substrate index typed or from the bare substrate transmittance.
  Absorption coefficients are not calculated. TODO, verify the equation numbers in the paper.

### Checked

- Known-answer tests: Starink and Friedman within 3 % of the synthetic 150 kJ/mol, Coats–Redfern
  picks F1 for a first-order run; ATR depth equals the Harrick expression and scales with λ;
  sapphire method recovers cp = 1.2 + 0.001(T − 20) J/(g·K) to 3 decimals with either sign
  convention; van ’t Hoff recovers x₂ = 0.005 within 5 % (4 % here, because the ideal peak starts
  at F = 0.002 and ends between two grid points), T₀ within 0.05 °C, ΔH_f within 2 %; OIT 27 min
  exactly on a piecewise-linear exotherm; plasmon centre 2.38 eV and width 0.30 eV of a Lorentzian
  on a sloped background; the envelope formula inverts the exact non-absorbing film transmittance
  exactly (checked algebraically and numerically), and the synthetic 1000 nm film comes out
  within 1 % in thickness and index.
- Type check, lint, 880 tests (1 skipped), build, bundle size (shell 17.0 KB of 150 KB) and e2e
  pass. New e2e checks: plasmon fit in the worker, Swanepoel thickness, and all three DSC
  methods on their examples.

### Known issues

- Swanepoel uses linear envelopes; Swanepoel recommends a smoother interpolation, so expect
  about 1 % error where fringes are far apart. The strongly absorbing region must be cut off by
  hand.
- The purity fit has no linearisation correction, so curved plots give a rough value.
- Evolved gas signals are not corrected for the transfer-line delay.

### Next stage

Stage 6: Validate button, pop-up and counters (Cloudflare Worker + D1).

## Owner feedback round, stage 4 of 6: FTIR bands (done)

Branch `claude/zen-edison-acnmco`. No new dependencies. A new wizard step 4, **Bands**, sits
between Pick peaks and Assign groups; every section in it is optional.

### What was built

- **Spectrum subtraction:** A_diff = A_sample − k·A_reference on the sample's wavenumbers, the
  reference interpolated linearly, both after the processing of step 2. "Find k in this range"
  gives the least-squares k = Σ A_s·A_r / Σ A_r² over a range where only the reference absorbs.
  The difference can be added as a new spectrum (source "computed", processing off, a note
  says how it was made), which then goes through peaks and assignment like any other.
- **Second derivative:** Savitzky–Golay derivative (new `savitzkyGolayDerivative`, any
  derivative order, ends from the first and last full window). Minima below zero and deeper
  than a chosen percentage of the deepest are listed and can be taken as starting bands for the
  fit. Refused, with a message, for unevenly spaced data.
- **Band fitting** over a chosen region: Gaussian, Lorentzian or pseudo-Voigt (η fitted) bands
  plus a straight background, by the same bounded Levenberg–Marquardt fitter as XRD
  (`fitRegion`), in the peaks web worker. Starting positions typed, from the picked peaks or
  from the second derivative; starting widths from the half-height width, capped at the
  distance to the nearest other band (otherwise overlapping bands start as one broad band and
  the fit fails). Table of centre, FWHM, height, η, area with standard errors and each band's
  share of the fitted area; R², χ²ν and the fitter's warnings; plot with the components; CSV.
  A fit made before the processing changed is marked out of date.
- **Band areas and ratios:** trapezoid integral above a straight line joining the spectrum at
  the two ends of each range (ends interpolated), highest point, ratio to a band marked as
  reference; warnings for ranges outside the data and negative areas; CSV.
- Methods text sentences for difference spectra, fits (profile, number of bands, R², and the
  derivative settings when the starting positions came from it) and band areas.
- Saved state version 2 (version 1 sessions get empty band settings and their step moves past
  the new step). The fitter's messages now take a unit (`unit` option, default °).

### Checked

- Known-answer tests: exact first and second derivatives of a quadratic and a cubic, ends
  included; two Lorentzians 16 cm⁻¹ apart (below Γ/√3, one maximum) resolved into two
  derivative minima within 3 cm⁻¹; the area of a Gaussian on a sloped line equals
  h·w·½√(π/ln 2); subtraction recovers k = 0.7 and the remaining band; two overlapping Gaussians
  on a sloped baseline recovered exactly; a Lorentzian fitted with a pseudo-Voigt gives η > 0.95.
- UI tests for subtraction (k found, difference added), areas and ratios, derivative minima as
  starting bands, methods text and the version 1 migration.
- Type check, lint, 840 tests (1 skipped), build, bundle size and e2e pass. New e2e check: the
  example's 1720 cm⁻¹ band fitted in the worker within 1 cm⁻¹.

### Known issues

- Only one fit region per spectrum is kept.
- The derivative's window and the 5 % depth default are my choices, adjustable on screen.

## Owner feedback round: thermal tables checked against Gaisford, Kett & Haines (2016)

The owner supplied _Principles of Thermal Analysis and Calorimetry_, 2nd edn, ed. S. Gaisford,
V. Kett and P. Haines (RSC 2016, ISBN 978-1-78262-051-8) in `docs/papers`. I read the TGA (ch. 3),
DSC (ch. 5), simultaneous techniques (ch. 10) and SCTA (ch. 11) chapters against the three rule
tables in `data/thermal`.

- **What the book supports (now cited by section in each `source` field):**
  - DSC directions and scans: melting endothermic, sharp for a single crystalline material and
    broad for polymers, fats and waxes (§5.5.1); crystallisation exothermic, on cooling or as cold
    crystallisation on heating (§5.5.3); loss of volatiles endothermic and easily confused with
    melting (§5.5.5); moisture gives a small broad endotherm at about 50–80 °C in a vented pan
    (§5.5.6); oxidation of carbons exothermic (§11.2.6); decomposition with mass loss can be
    endothermic or exothermic (§3.5, Fig. 3.19); melting shows no mass change (§3.5).
  - Usual direction of moisture, bound water and carbon oxidation in `combined-rules.json`
    (new `directionSources` map).
  - Worked examples named in the TGA notes: proximate analysis of charcoal (§3.3.2), calcium
    oxalate dihydrate water → CO → CO₂ (§10.3.1), CuSO₄·5H₂O dehydration (§5.5.5).
- **Changed because of the book:** the melting and dehydration rules no longer claim a usual
  peak shape (`shape: "any"`), because the book gives broad melting for polymers and sharp
  dehydration peaks with a pinhole lid. The in-app notes now say "partly verified".
- **Still TODO, verify:** every temperature range (TGA and DSC). The book is about principles and
  gives no general table of typical event temperatures, so no range could be checked. The
  solid-solid row and the usual direction of capping agents, polymer degradation,
  dehydroxylation, nitrate, acetate and carbonate are not covered either. A handbook table
  (for example Brown, _Introduction to Thermal Analysis_, or the ICTAC kinetics and
  nomenclature recommendations) would be needed for the ranges.
- **Copyright note:** the PDF is a full commercial textbook and is committed to the repository.
  I did not copy any text from it beyond short section references. Consider keeping it outside
  the repository.

## Owner feedback round, stage 3 of 6: particles (area fraction, intercepts, scale bar, XRD) (done)

Branch `claude/zen-edison-acnmco`. No new dependencies. Pooling several images into one
distribution already existed (sub-stage 10c), so this stage added the other particle items.

### What was built

- **Scale bar found automatically** (step 2, "Find the scale bar automatically"): the bottom 40 %
  of the image is scanned for a thin, straight, uniformly white or black bar (2 px or more
  thick, under 6 % of the height, 3–70 % of the width, standing out from the rows above and
  below). With end ticks (|———|) the ends go to the tick centres. The user checks it and types
  the printed length. `src/core/particles/scaleBar.ts`.
- **Area fraction** of the detected regions in the analysis area (Delesse: A_A estimates V_V;
  the areal porosity when the regions are pores). Particles cut by the edge are counted; the
  size and shape filters of step 3 apply.
- **Mean lineal intercept (ASTM E112-13, Heyn method):** evenly spaced horizontal and vertical
  test lines, one intercept per region crossed and one half at a line end (§13.3). For grains
  filling the image ℓ̄ = L_T/N (Table 6, A1.1.1.3); for one phase on a background
  ℓ̄_α = V_V·L_T/N_α (eq. 25) with V_V taken as the line fraction, i.e. the mean chord length.
  Horizontal, vertical and both together; a warning below 50 intercepts (§13.1) and when the two
  directions differ by more than 25 %. ASTM G = −6.643856 log₁₀ ℓ̄(mm) − 3.288 (Table 6) when the
  image has a scale. `src/core/particles/stereology.ts`; only the test-line pixels are read.
- **Comparison with the XRD crystallite size:** the user types the XRD size and method; the table
  shows particle mean and median, the crystallite size and their ratio, with a note labelled
  "Estimate, not a proof" (ratio near 1 fits one crystallite per particle, clearly above 1
  several crystallites or aggregates).
- CSV of all these numbers; sentences added to the methods text. Saved state version 5 (older
  sessions get the default settings).

### Checked

- ASTM E112-13 text read (Table 4, Table 6, §13, eq. 25). Tests: G = 0, 8 and 14 for
  ℓ̄ = 0.3200, 0.0200 and 0.0025 mm (Table 4); +2 when ℓ̄ halves; square grains 10 px wide give
  ℓ̄ = 10 px in both directions with the half-intercept rule; discs give the mean chord πr/2;
  area fractions exact for rectangles and within 3 % for digital discs; bar finder on white,
  black and ticked bars and on an image without a bar.
- Type check, lint, 820 tests (1 skipped), build, bundle size and e2e pass. Two new e2e checks:
  the example's scale bar is found as 200 px from tick to tick, and the area fraction is within
  3 % of the true 9.60 %.

### Known issues

- The XRD size is typed by hand; it is not read from the XRD tool.
- Test lines are not drawn on the image yet.

## Owner feedback round, stage 2 of 6: UV-Vis concentration and kinetics (done)

Branch `claude/zen-edison-acnmco`. No new dependencies.

### What was built

- The UV-Vis tool has a second analysis, "Concentration and kinetics" (switch at the top,
  remembered in the browser, loaded on demand), a three-step wizard:
  1. Standards of known concentration and/or samples over time: loaded spectra (absorbance or
     transmittance) or absorbances typed by hand; any concentration unit.
  2. Wavelength: the absorption maximum of the reference spectrum (t = 0, else the earliest
     sample, else the strongest standard) inside an optional search range, or typed / clicked;
     optional averaging over ± a few nm.
  3. Results: Beer–Lambert calibration line (free or through zero), absorptivity ε = slope / b
     with its standard error, a warning when samples fall outside the standards' range;
     pseudo-first-order kinetics ln(C₀/C) = k t through the origin with C/C₀ = A/A₀ (dark-period
     points before t = 0 listed, not fitted), k ± σ, R², half-life, removal %; C/C₀ and
     ln(C₀/C) plots; CSV files, methods text and session file.
- `src/core/uvvis/concentration.ts` (`absorbanceAt`, `calibrate`, `concentrationFrom`,
  `firstOrderKinetics`), `src/modules/uvvis/concentration/`.
- Example: a made-up dye band (660 nm, 0.18 L mg⁻¹ cm⁻¹, k = 0.02 min⁻¹), five standards and a
  degradation series with a dark period, all marked synthetic.

### Checked

- Known answers: exact ε, intercept and unknown concentration from noise-free standards; path
  length division; k, half-life and removal from an exact exponential decay; the example's k and
  ε are recovered within 0.1 % and 0.5 % with noise. UI test and an e2e check of the example.
- Type check, lint, 803 tests (1 skipped), build, bundle size and e2e pass; no sideways scroll at
  360 px.

### Known issues

- Only the pseudo-first-order model; no pseudo-second-order or Langmuir–Hinshelwood fit yet.

## Owner feedback round, stage 1 of 6: compare TGA runs of several samples (done)

Branch `claude/zen-edison-acnmco`. No new dependencies. The owner set the order on 2026-10-28:
science features first (this stage; then UV-Vis photocatalysis kinetics and Beer–Lambert; several
images per particle distribution; FTIR band fitting, second derivative, subtraction and band
areas; the remaining items), and the Validate button with counters last (Cloudflare Worker with
D1, analysis proof plus per-browser and hashed-IP limits, comments public only after the owner
approves them).

### What was built

- UV-Vis and FTIR already overlay several spectra with normalise and offset, so only TGA needed
  this. The TGA Results step has a new "Compare with other samples" section: load the runs of
  other samples (or two synthetic example samples); each is cleaned with this analysis's
  settings, without a blank, with its first mass value as 100 %. The section overlays the mass
  curves and lists T5, T10, T50, the temperature of the fastest mass loss (DTG maximum), the
  residue at the chosen temperature and the total loss, with a CSV download.
- `src/core/thermal/compare.ts` (`summariseRun`). Saved state version 3 (adds `compare`).

### Checked

- Synthetic known answers: one 40 % step at 400 °C (σ 20 °C) gives the DTG maximum at 400 °C,
  its height within 1 % of 40 / (σ √(2π)) (the local quadratic flattens it by about 0.7 %), a
  residue of 60 % and T5 at 400 − 1.150 σ; a flat curve gives no DTG peak.
- Type check, lint, 791 tests (1 skipped), build, bundle size and e2e pass. At 360 px the page
  has no sideways scroll; the table scrolls inside its frame.

## Reference and citation check (done as far as open sources allow)

Branch `claude/zen-edison-acnmco`. No new dependencies.

### Checked and closed

- **Scherrer (1918):** the supplied 1918 Göttingen volume (`docs/papers/PPN252457811_1918_compressed.pdf`,
  PDF pages 103–105) holds the paper, Nachr. Ges. Wiss. Göttingen, Math.-Phys. Kl. (1918) 98–100.
  On p. 99: h = 2 √(ln 2 / π) · (λ / Λ) · 1 / cos(θ / 2), θ the scattering angle, Λ the cube edge,
  so K = 0.94 for cubes with the full width at half maximum. The app's form and its K setting agree.
- **Halder–Wagner angle form:** T. C. Paul, J. Podder and L. Paik, arXiv:2103.03521, eq. (7), read:
  (β / tan θ)² = (K λ / D) · β / (tan θ sin θ) + 16 ε², the same as the code.
- **Manual anchors (Fritsch–Butland slopes):** the background equals SciPy 1.18.1
  `PchipInterpolator` (Fritsch & Butland 1984 plus Moler's end slopes) to 6 × 10⁻¹⁴; a test now
  pins SciPy's values. The 1984 paper itself was not read.
- **arPLS (Baek, Park, Ahn & Choo 2015):** agrees with pybaselines 1.2.1 `arpls` to 0.0005 on a
  noisy synthetic pattern; a test pins its values. The paper itself (paywalled) was not read.
- **SNIP variant, increasing window:** this is the `kBackIncreasingWindow` option of Morháč's own
  ROOT `TSpectrum::Background`, which cites Morháč et al., NIM A 401 (1997) 113–132.
- **FTIR group table:** all 65 functional-group rows and 13 metal-oxide rows match Tables 3 and 2
  of Pasieczna-Patkowska et al. (2025), read again from the PubMed Central full text. The note now
  says the transcription is checked and that the ranges are one review's typical values.
- **Atmospheric bands:** CO₂ 2349 and 667 cm⁻¹, H₂O 1595, 3657 and 3756 cm⁻¹ match NIST CCCBDB.
- **Mo and Ag wavelengths:** already from NIST (Deslattes et al. 2003); the "still unverified"
  notes in older sections below are out of date.

### Closed with the papers the owner supplied on 2026-10-28 (not committed: publisher copyright)

- **Sahadat–Scherrer:** Hossain et al., Chem. Pap. (2022), "Model 2": cos θ against 1/FWHM,
  intercept set to zero, D = K λ / slope (eq. 7). Same as the code.
- **SNIP LLS operator:** Morháč & Matoušek, Appl. Spectrosc. 62 (2008) 91–106, eq. (3) is the
  operator used here (credited to Hampton, Lian & McHarris, NIM A 353 (1994) 280); eq. (4) the
  clipping step; increasing and decreasing windows are both described.
- **Doyle 1.052:** Doyle, J. Appl. Polym. Sci. 6 (1962) 639–642, eq. (12),
  log p(x) ≈ −2.315 − 0.4567 x, and 0.4567 · ln 10 = 1.0516.

The only TODO(verify) left in the code is Eilers (2003) for the arPLS width-to-λ relation.

### Still open (needs the owner)

- **Thermal tables** (`data/thermal/events.json`, `dsc-events.json`, `combined-rules.json`): no
  open, citable table of typical TGA or DSC event temperatures was found, so the ranges stay
  placeholders. They need a textbook or review the owner can supply (for example Brown, Handbook
  of Thermal Analysis and Calorimetry, or Haines, Principles of Thermal Analysis and
  Calorimetry), with the page for each range.
- **Also open, not in the owner's list:** Eilers (2003) λ–width relation for arPLS.

### Checks

Type check, lint and 787 tests (1 skipped) pass.

## Owner feedback round: hand measuring inside Detect particles, separating clumps (done)

Branch `claude/zen-edison-acnmco`. No new dependencies.

### What was built

- The particle wizard has four steps: the separate "Measure by hand" step is gone. Detect
  particles now has an "Add a line" tool next to Select, Add a circle, Add an ellipse, Cut and
  Move. Lines (and typed coordinates) are listed under "Measured by hand" in the same step, with
  delete, delete all and CSV; the step's "Undo the last edit" also takes lines back. Circles and
  ellipses measured in older sessions are still listed. Saved sessions are upgraded (version 4):
  a session on the old last step opens on the new last step.
- New splitting choice for clumped and overlapping particles (agglomerates in TEM):
  `src/core/particles/detect/clusters.ts`. Particle centres are found with a circular Hough
  transform on the edges (gradient-direction voting, radii 0.7 to 1.3 of the typical radius),
  kept when their votes reach a set share of a whole, clear outline at the image's contrast, at
  least 0.6 diameters apart; each mask pixel then goes to the nearest centre that reaches it
  through the mask. The typical diameter is typed, taken from the last line drawn ("Use the last
  line drawn"), or estimated from the mask (twice the median distance-transform maximum). The
  step suggests clumps when one outline holds over 30 % of all particle area. The methods text
  describes the method, the diameter used and whether it was estimated.
- `gaussianBlurExact` (fractional grey levels) added; `gaussianBlur` now rounds it.

### Checked

- The TEM image from the owner's screenshot (a crop of it, not committed): the neck watershed
  gave 9 particles; clumps gave about 130 to 200 regions of particle size that follow the
  particles. Synthetic tests: six overlapping spheres (2 × 3 grid, 28 px apart, 40 px wide) are
  all found where the neck watershed finds one; flat overlapping discs in a row split into 3;
  a single particle stays whole. A dense 4 MP image with about 5,000 particles takes about 4 s
  in the worker (neck watershed about 3 s).
- Type check, lint, 784 tests (1 skipped), production build, bundle size and e2e all pass.

### Known issues

- The estimated diameter comes out too large when nearly every particle is in a clump, and a
  little small on rough-edged TEM particles (the owner's image: 26 px estimated, about 35 px by
  eye), which over-splits large particles. Drawing a line across a typical particle and pressing
  "Use the last line drawn" is the reliable route; the help text says so.
- Very heavy overlaps (centres closer than about 0.65 diameters) are still merged. The result
  is an estimate and the outlines must be reviewed, as the step says.

## Owner feedback round: graph images inside every tool, Plot Bhai name, home page (done)

Branch `claude/zen-edison-acnmco`. No new dependencies.

### What was built

- The separate "XRD from a screenshot" tool is gone. Its reader is now shared
  (`src/modules/digitize/`) and opens from inside each tool: the Upload steps of XRD, FTIR,
  UV-Vis, TGA and DSC show "From a data file" and "From a graph image" side by side, and after
  data are loaded a link under "Add more files" adds a curve from a graph image. Routes:
  `#/xrd/image`, `#/ftir/image`, `#/uvvis/image`, `#/thermal/image` (the old
  `#/xrd-screenshot` link still opens the XRD reader, with its saved work).
- Each tool's reader names its own axes (2θ, wavenumber, wavelength, temperature), draws its
  own synthetic example figure from the site's existing generators, and ends with "Add to my …
  analysis", which adds the curve to that tool's saved session and opens its Upload step.
  FTIR and UV-Vis ask what the y axis shows (suggested from the values with the existing
  `suggestKind`); TGA/DSC asks whether the curve is mass (% or mg) or heat flow, and the
  temperature unit. A wavenumber axis drawn high on the left raises no warning.
- Digitized data keep a "From a graph image" badge and an "approximate" note, and the methods
  text of FTIR, UV-Vis, TGA and DSC now says when data were digitized (XRD already did).
- Core: `calibrationError` / `calibrationWarnings` take the axis names; `toPattern` became
  `toCurve` with generic `x` / `y`; `degreesPerPixel` became `xPerPixel`;
  `digitizedSentence` added. The tool stores moved to their own modules (`ftirStore.ts`,
  `uvvisStore.ts`, `tgaStore.ts`, `dsc/dscStore.ts`) so the reader can write to them.
- The site is now called Plot Bhai (header with a small logo, page title, manifest, PDF
  producer, software name in records and methods text). XRD session files keep their old
  internal id, so earlier files still load.
- New home page: title and tagline, three short points, tool cards with icons and the kinds of
  input each takes, and a three-step "How it works". Footer: "© 2026 Shumsul Arefin. All rights
  reserved." The About page has a short section on data from graph images.

### Verification (real results)

- Type check: clean. Lint and Prettier: clean.
- Tests: 776 passed, 1 skipped (new `tests/digitize-targets.test.ts`: reversed wavenumber axis,
  axis names in messages, x always increasing, methods sentence).
- Production build: passes. Bundle size: initial JavaScript 16.8 KB gzipped (budget 150 KB);
  each reader loads on demand.
- E2E: passes, including the XRD graph-image flow (example traced over 10.30° to 79.70°, added
  to the XRD Upload step, marked approximate, no sideways scroll at 360 px).
- By hand in Chromium: the example figure of each tool (XRD, FTIR, UV-Vis, TGA) traced and
  added to its tool with no page errors; home, UV-Vis and thermal pages have no sideways
  scroll at 360 and 1280 px.

### Known issues and TODO

- A TGA-DSC figure with both curves must be read twice (once per curve); the combined view
  then uses a separate TGA file.
- UV-Vis figures must be plotted against wavelength in nm (not photon energy).

## Owner feedback round: fitting check, clearer lanes, upload and search layout, step instructions (done)

Branch `claude/zen-edison-acnmco`. No new dependencies.

### What was built

- Peak fitting checked on the owner's BV-03 pattern (default settings). The fits converged with
  R² 0.97 to 0.998 on the strong peaks, but three problems were found and fixed:
  - Kα2 was left in the data by default and not modelled, so widths were too broad (24 % at
    76.5° on a synthetic test) and sizes too small. When the data still contain Kα2, each peak
    is now fitted as a Kα1 + Kα2 pair: same profile, width and η, height × the Kα2 ratio, at
    the Kα2 position from Bragg's law (`kAlpha2Copy` in `src/core/xrd/peaks/fit.ts`, with its
    analytic Jacobian). Positions and widths are those of Kα1. The instrument standard is fitted
    the same way. Saved fits made before this show as out of date (the fit key has a model
    version). Test: synthetic Kα1 + Kα2 data at 28.9° and 76.5° give back position, width and
    height within 1 %.
  - Unresolved pairs (58.89 / 59.57°) were fitted as one 1.4°-wide peak, and a noise blip at
    70° as a peak one data step wide. Fit peaks now does one automatic refinement: it removes
    peaks that shrank to one data step, adds the peaks the residual shows were missed, removes a
    very broad peak (over 4 × the median width) that an added peak falls inside, and fits
    again. A note lists what changed; Undo restores the earlier peaks. On BV-03 the 58–61°
    region then fits to within the noise (χ²ν 1.1).
- Compare reference phases: lanes are 72 px tall with thicker lines, the five strongest lines of
  each phase carry an (hkl) tag, line heights on screen are on a square-root scale (stated in
  the key) so weak lines stay visible, and a key explains solid (peak found) and dashed (no
  peak) lines. With one phase shown, its lines are drawn as guides through the pattern by
  default. Exported figures keep linear heights and no tags.
- Upload (XRD, FTIR, UV-Vis): once data are loaded, the large drop zone, example button and
  screenshot link give way to the loaded files, followed by a one-line "Add more files" bar and
  the paste box (shared `src/ui/FileDrop.tsx`).
- Choose material: the periodic table comes first, then the search bar with a Search button
  (Enter or Search searches at once; typing still searches after a pause), then the results.
- Every wizard step of every tool has a short "How to do this step" box (`guide` in the step
  definitions, `src/ui/wizard/StepGuide.tsx`). "Hide tips" hides them in all tools; the choice
  is kept in this browser only.

### Verification (real results)

- typecheck, lint: clean. Unit tests: 72 files passed, 1 skipped; 770 tests passed, 1 skipped.
- Build and bundle-size check: within budget. `node scripts/e2e.mjs`: passed.
- Browser, with BV-03 and clinobisvanite (COD 9012062): lanes, key and guides as above; the
  automatic refinement added 56.25, 58.89 and 59.57° and removed 59.22 and 69.98°. No
  sideways scroll at 360 px on Upload, Clean, Choose material, Compare and the other tools'
  first steps; no page errors.

### Known issues and to-dos

- The automatic refinement runs one extra pass only; peaks still missed after it are listed
  with an "Add and fit again" button as before.
- TODO: natural-polymer library, waiting for the owner's CIF files.

## Owner feedback round: Materials Project-style search, polymer library, comparison, Results (done)

Branch `claude/zen-edison-acnmco`, from the owner's annotated screenshots. No new dependencies.

### What was built

- Choose material (step 3) works like the Materials Project: one search bar, a periodic table
  under it and the results under the table. Clicking elements fills the bar ("Bi-V-O" for only
  those elements, "Bi V" for at least those), and the bar also takes a formula, a COD number, a
  space group or a name. The same query searches the natural-polymer library and COD (through
  the lookup Worker). Each table cell shows Z and symbol, is coloured by category (alkali
  metals, alkaline earth metals, transition metals, post-transition metals, metalloids,
  nonmetals, halogens, noble gases, lanthanides, actinides) with a legend, and on hover or
  keyboard focus shows the name, Z, category, period, group, block and the CIAAW standard
  atomic weight (`src/core/elements.ts`, names checked against `data/thermal/atomic-weights.json`
  by a test).
- The 70 inorganic phases were removed from the app. Their JSON files moved to
  `tests/fixtures/cod-reference/` and stay as the validation set of the pattern calculator,
  matcher, Rietveld engine and tables (the build script writes there now). `data/reference/`
  keeps the scattering factors and an empty natural-polymer library index.
- Compare reference phases (step 4): a "Compare" selector focuses one phase: its reference
  lines are drawn as dashed guides through the pattern, the other lanes fade and only its
  calculated profile is overlaid. Lanes are taller, striped, named "phase · COD id · score",
  and each stick shows (hkl), 2θ and intensity on hover. Each phase card lists its strongest
  reference lines with no measured peak, and a line under the plot lists the measured peaks no
  shown phase explains (`unexplainedPeaks` in `src/core/xrd/reference/match.ts`, tested).
- Rietveld refinement now refines the cleaned data of step 2 by default (Kα2 stripping is then
  respected), with a choice of the uploaded, unprocessed data; the plot, refinement and methods
  text follow the choice. Normalisation is never applied, so counts stay counts.
- Results (renamed from "Results tables"): an "At a glance (estimates)" box, then three views:
  Size and strain (settings, method guide, summary table and charts, peaks used, each method),
  Phases, (hkl) and lattice, and Texture and crystallinity. Checks and notes of the summary,
  each method and the texture coefficients are a compact list that opens on demand (open from
  the start when it holds a problem). The assigned-peaks table is compact: (hkl), 2θ, Δ2θ, d,
  intensities, FWHM and notes, with the phase column only for several phases and the structure
  source and JCPDS number listed once above it; the CSV keeps every column.
- Every collapsible section in the app has a chevron that turns when it opens.
- Export is renamed "Export for your paper" and says it collects the figure, methods text,
  tables, record and session file, while Results is for reading and checking the numbers.
- A CIF whose only name is a crystal system (COD 1577381 names ZnO "hexagonal") is named by its
  formula, for example "OZn (hexagonal)".

### Decisions

- Element categories follow the common periodic-table convention. Borderline choices, flagged
  for the owner to check: B, Si, Ge, As, Sb and Te are metalloids; Po is a post-transition
  metal; Zn, Cd and Hg are transition metals.
- The polymer library ships empty (TODO). COD holds no structures for the natural polymers, and
  the publishers' supplementary files cannot be fetched from here. The owner chose to supply
  the CIF files (cellulose Iα, Iβ, II and III; chitin and chitosan; starch and amylose A, B and
  V; silk fibroin; collagen; others) with their papers; each phase will cite its paper.
- The Results views are tabs (a segmented control) rather than one long page, so a beginner
  sees one topic at a time; per-table CSV buttons stay, and Export gathers everything.

### Verification (real results)

- `npm run typecheck`, `npm run lint` (ESLint and Prettier on tracked files): clean.
- `npm test`: 71 files passed, 1 skipped; 767 tests passed, 1 skipped.
- `npm run build` and `npm run size`: built, bundle within budget.
- `node scripts/e2e.mjs`: passed (all tools).
- In a browser at 1280 and 360 px: no sideways scroll on Choose material, Compare and Results;
  the Rietveld plot shows the background-removed pattern with "Cleaned data" and the sloped
  raw background with "Uploaded data"; the live COD search from localhost returned 23 Bi-V-O
  entries.

### Known issues and to-dos

- TODO: natural-polymer library, waiting for the owner's CIF files.
- The owner should check the element category borderline choices above.

## XRD from a screenshot: digitize a published figure and check its sizes (done)

Branch `claude/zen-edison-acnmco`, from the owner's "Add Screenshot-Based XRD Analysis Feature"
request. A new lazy-loaded tool (`#/xrd-screenshot`, card on the home page, link in the XRD
Upload step) reads an XRD pattern off a figure image and hands it to the existing XRD wizard.
No new dependencies; everything runs in the browser.

### What was built

- Step 1, Image: PNG, JPEG or WebP by file, drop or paste (checked by content, not extension;
  images larger than 4000 px a side are scaled down with a note). Rotate by 90° steps or a fine
  angle, crop by dragging (box editable), and a preview of the cropped, straightened image. The
  file is kept in IndexedDB, so a refresh keeps the work. "Try with example data" draws a
  synthetic figure (made-up peaks whose widths match 18 nm by Scherrer, a red reference curve,
  gridlines, legend) and fills in every step.
- Step 2, Calibrate axes: click two labelled 2θ ticks and two intensity ticks and type their
  values; linear or logarithmic intensity. The positions can be typed too. The calibration is an
  affine map, so a slightly rotated or skewed scan still maps correctly; tilt over 1°, skew,
  marks too close together and a reversed 2θ axis are warned about. Preview: a dashed grid at
  round values drawn from the calibration over the image, to check against the figure's ticks.
- Step 3, Digitize the curve: click the curve. Its colour is taken from the click; pixels of
  that colour are kept, straight lines spanning the plot (axes, gridlines) are dropped, and the
  trace follows the connected line from the click, so a legend, labels or another curve of the
  same colour are not followed. Steep flanks are read across rows, so narrow peaks keep their
  apex and width. Inward tick marks touching a low baseline are cut off. Corrections: extra
  start points, erase boxes, points added by hand, colour tolerance. The trace is drawn over the
  image; a plot of the digitized pattern; CSV export (2θ, intensity, marked approximate).
  Warnings: few points, poor coverage, gaps, pixel resolution (widths under 5 pixels), thick
  lines, negative intensities.
- Step 4, Analyse in XRD: add the pattern to the current XRD analysis or start a new one; the
  XRD wizard opens at Clean data. The XRD store moved to `src/modules/xrd/xrdStore.ts` so both
  tools share it.
- In the XRD tool, a digitized pattern is labelled "Digitized from a figure: approximate" with
  the image name, degrees per pixel and line width; the methods text says the data were
  digitized from figure images and are approximate. Background, Kα2, peak finding, fitting,
  instrument correction, all size methods, plots and exports are the existing ones, unchanged.
- XRD Results, "Compare with the paper" (digitized patterns only): tick the peaks the paper
  used, type its FWHM and sizes, its K, λ, instrument width and correction. Sizes are
  recalculated with the paper's settings from the fitted widths, by the existing Scherrer and
  Williamson–Hall UDM functions (`src/core/xrd/size/compare.ts` only combines them). Shown:
  difference (over 15 % highlighted), the FWHM the paper's size implies, possible explanations
  of a large difference (FWHM in degrees used as radians, cos 2θ instead of cos θ, Å for nm,
  half width instead of full width; tested only to within 5 %), warnings (widths under 5
  pixels, no instrument width) and the calculation details. CSV export.

### Decisions

- A separate tool rather than a tenth XRD step: images need their own steps, and the XRD
  wizard stays as it was for measured data.
- Tracing runs on the main thread: it is a few linear passes over the cropped area, and the
  20 MP images of the particle tool are not expected here (larger images are scaled to 4000 px
  a side). Very large screenshots may make the curve step pause briefly.
- No OCR of tick labels: the user types the values. OCR would need a large library or a
  network service.
- Upward narrow spikes are never removed automatically (they may be real peaks); labels
  touching a peak are erased by hand.

### Verification (real results)

- Unit tests (`tests/digitize.test.ts`, `tests/paperCompare.test.ts`, 15 tests) on images drawn
  in the test with known curves: calibration round trip including a 7° rotation, log axis,
  error messages; black curve with gridlines (RMS error < 0.4 % of range); 3 px line (heights
  and FWHM within 8 %); two colours with a legend; two stacked curves of one colour; noise and
  blur; inward ticks touching the baseline (fails without the fix: 36 counts off, passes: under
  12); screenshot to fit to Scherrer, D = 15 nm recovered within 8 %; comparison agreement,
  instrument correction round trip, degrees/radians slip detection, W–H size and strain.
- Browser (Playwright, production build): the example figure through all steps, sent to XRD,
  fitted, and compared: recalculated Scherrer sizes 17.4–17.7 nm (mean 17.6 nm) for the true
  18 nm. A separate figure made with matplotlib (serif font, inward ticks, two stacked curves of
  the same colour, hkl labels, JPEG quality 70, 0.04° per pixel, peaks for D = 25 nm), uploaded,
  cropped, calibrated and traced by clicking: mean 24.6 nm (24.3–24.9 per peak) for 25 nm. No
  browser errors. These test figures are generated, not taken from papers.
- `npm run e2e` has a new screenshot section: example traced over 10.3–79.7°, no sideways scroll
  at 360 and 1280 px, pattern handed to Clean data and marked approximate.
- Lint, type check, 761 unit tests, build and bundle-size budget pass (the tool is its own
  chunk, about 14 KB gzipped).

### Known issues and limitations

- Accuracy is limited by the image: one pixel is the finest 2θ step, and widths of peaks under
  about 5 pixels are rough. Thick lines round off narrow apexes (heights a few per cent low).
- Curves of the same colour that cross or overlap, dashed or dotted curves, and labels touching
  a peak need extra start points or erasing. Gridlines of the curve's colour that do not span
  the crop are not removed automatically.
- Tick values are typed by the user (no OCR). Figures with a broken (split) axis are not
  supported.
- Intensities are in the figure's units (often arbitrary), so intensity-based results
  (crystallinity, texture) from a digitized pattern are approximate at best.
- Not checked against real published figures: no paper figures are bundled, so all tests use
  generated images with known answers.

## Owner feedback round: peaks, fit plot, figure editor, crop, undo, more XRD methods (done)

Branch `claude/zen-edison-acnmco`, from the owner's list of problems (with screenshots) and the
"complete guide to information obtainable from powder XRD data".

### What was built

- XRD Fit peaks: the prominence slider redraws the found peaks live while dragging (saved on
  release, one undo step). "Find peaks automatically" in Edit peaks. After a fit, peaks the fit
  missed are found in the residual (`src/core/xrd/peaks/missed.ts`) and offered with "Add these
  and fit again". New warnings: a peak that grew much wider than it started or than the other
  peaks of its region, and a region whose straight background lies well below the data at its
  ends (`backgroundTooLow`), both signs that a broad peak is standing in for the background.
- Fit plot: the dashed lines were each region's straight local background, drawn under every
  component and tilted by unfitted shoulder peaks. The background is now its own quiet
  "Local background" series, and components are drawn only where they are above 1 % of their
  height. Miller indices from the chosen phase label the fit plot automatically; they are edited
  in the figure editor, whose "Peak labels (Miller indices)" group moved to the top.
- Figure editor: "Add marker" (and the other annotation buttons) stays active, so you can click
  several times, until Done, Escape or pressing the button again. Marker shapes: circle, square,
  triangle, diamond, cross and short tick line, chosen before placing and per marker.
- SEM/TEM crop: the crop box is now drawn and edited in step 2 (drag inside to move, drag an
  edge or corner to resize, handles shown), the outside is shaded darker, and later steps open
  zoomed to the crop.
- Undo everywhere: every wizard has Undo and Redo buttons and Ctrl/Cmd+Z, Ctrl+Y and
  Ctrl/Cmd+Shift+Z (`src/ui/wizard/history.ts`; 100 steps, changes within 600 ms are one step;
  text boxes keep their own undo).
- Flicker: the dock's scroll area and the page reserve the scrollbar space
  (`scrollbar-gutter: stable`), which stops a loop where the scrollbar appearing narrowed the
  plot, which changed its height, which hid the scrollbar again.
- Two size methods on cos θ against 1/β (`src/core/xrd/size/methods.ts`): the linear
  straight-line Scherrer method (free line, D = Kλ/slope; Rabiei et al., Nanomaterials 10 (2020)
  1627, eq. 3) and the Sahadat–Scherrer method (line through the origin; Hossain et al., Chem.
  Pap. 76 (2022) 7245). `originFit` added to `src/core/math/linearFit.ts`.
- X-ray density ρ = ZM/(N_A V) (`src/core/xrd/analysis/density.ts`) from the phase's cell
  contents and the refined cell volume, in the lattice table and the summary CSV, with a button
  that puts it into the density used for the specific surface area. The lattice table explains
  that the difference of a cell edge is the lattice strain (a − a₀)/a₀. The atomic weights
  (CIAAW 2024, already in `data/thermal/`) are shared with the Rietveld step.

### The guide, item by item

- Already present before this round: Bragg d-spacings, (hkl) assignment, lattice parameters and
  volume with uncertainties, phase matching against COD, Scherrer, Monshi–Scherrer, W–H UDM, USDM
  and UDEDM, size–strain plot, Halder–Wagner, microstrain, dislocation density, specific surface
  area, texture coefficient, crystallinity index, instrument correction (Gaussian, Lorentzian,
  approximate Voigt), FWHM and integral breadth, basic Rietveld with weight fractions.
- Added now: linear straight-line Scherrer, Sahadat–Scherrer, X-ray density, lattice strain
  shown as such.
- Not added, and why: Warren–Averbach (needs Fourier analysis of several orders of one
  reflection with a deconvoluted instrument profile); sin²ψ residual stress (needs scans at
  several tilt angles ψ); thermal expansion (needs patterns at several temperatures); pair
  distribution function (needs high-Q total scattering data); ODF texture (needs pole figures);
  stacking-fault probability (needs specific peak-shift analysis per structure); RIR
  quantification (needs I/Ic values, which come from ICDD cards we may not bundle). The
  "three-peak average" of Scherrer sizes is not an established, citable method, so it was not
  added as one; the Scherrer table already gives the size per peak and their mean.

### Checks

- New tests: `missedPeaks.test.ts` (5), `particles-crop.test.ts` (4), `history.test.ts` (5),
  `scherrer-lines.test.ts` (4: pure size broadening for D = 25 nm comes back as 25 nm from both
  methods; negative slope gives no size; the origin line against its closed form),
  `xray-density.test.ts` (2). `figure.test.tsx` updated for the new placement message.
- In a headless browser with visible scrollbars: the slider changes the peak count while
  dragging; BV-03 gets missed-peak suggestions; the crop box resizes; "(103)"-style labels appear
  on the fit plot; three markers in a row; Ctrl+Z, Ctrl+Y and the Undo button work. BV-03 with
  tetragonal BiVO4 (COD 9011741): X-ray density 6.279 ± 0.018 g/cm³ from the refined cell,
  6.127 g/cm³ from the library cell (by hand: 4 × 323.92 g/mol / (N_A × 351.15 Å³) = 6.127).
- Lint, typecheck, 746 tests (1 skipped), build and bundle budget pass.

### Known issues

- TODO(verify): the Sahadat–Scherrer equation is taken from its statement in Kawsar et al.,
  Heliyon 10 (2024) e25347, eq. 30, not from the 2022 paper itself (paywalled).
- FTIR step 3 flicker: not fully proven fixed. With the owner's FTIR file, visible scrollbars and
  a 1 px width sweep (1000–1960 px at 621 and 736 px height), the old build kept changing while
  idle (about 700 DOM changes per 0.2 s) at 1266–1297 × 621 and 1872–1904 × 736 in one of two
  identical runs; the new build stayed still in every run. The loop is intermittent, so the owner
  should confirm on the deployed site.

## Fix: endless re-processing and flicker in XRD steps (done)

Reported with a screen recording of step 4 (Compare reference phases): the page kept switching
between "Finding peaks…" and the result, and the reference lanes kept disappearing and coming back.

- Cause: `processingFor` and `peaksFor` (`src/modules/xrd/data.ts`) built a new settings object on
  every call once the user had changed a setting in step 2 or step 6. `useProcessed` and
  `useMeasured` restart the worker job when their settings object changes, so every result caused
  a render, which created new objects, which started the job again, without end. The example data
  uses the shared default objects, so the e2e run never showed it.
- Fix: the filled-in settings are cached per stored object (WeakMap), so the same stored settings
  always give the same object.
- Checked in a headless browser on step 4 after changing one cleaning setting: 2,684 worker
  messages in 3 idle seconds before the fix, 0 after. Unit test in `tests/fitSupport.test.ts`.

## Basic Rietveld refinement (done)

Branch `claude/zen-edison-acnmco`. Approved by the owner in October 2026 (CLAUDE.md sections 8 and
9 updated): a basic refinement, not a structure refinement.

### What was built

- `src/core/xrd/rietveld/`: whole-pattern model (`model.ts`: Chebyshev background, Kα1/Kα2,
  Lorentz-polarisation, pseudo-Voigt with Caglioti widths, March–Dollase, overall B, zero shift and
  sample displacement), cell constraints per crystal system (`cell.ts`), reflection families with
  all their members found from the lattice metric (`reflections.ts`), staged weighted
  least squares with R_p, R_wp, R_exp, χ², R_Bragg, Hill–Howard weight fractions and propagated
  uncertainties (`refine.ts`), and values with uncertainties in the s.u. notation plus methods
  sentences (`report.ts`). The refinement chooses a starting width from four values and lines up
  each cell by isotropic changes of ±1.5 % before least squares.
- Reference phases now store their unit-cell contents (`cellContents`), needed for weight
  fractions: added by the library builder (all JSON files regenerated offline from the committed
  CIF cache; only the new field changed, checked file by file) and by the CIF reader.
- XRD step 5 "Rietveld refinement (optional)": phases to refine, Refine runs in a web worker
  (`rietveld.worker.ts`) with stage progress and Cancel; "What to refine", preferred direction,
  background terms and 2θ range under Advanced; pinned plot with measured, calculated,
  background, difference and refined reflection positions; agreement indices, refined cells,
  weight fractions and R_Bragg with plain-language warnings (poor fit, not raw counts, parameters
  at a limit, phase possibly absent); profile parameters and stages under Advanced; results and
  pattern CSV; a methods paragraph, also appended to the Export methods text.
- Session version 10: older sessions move to the right step (the new step sits before Fit peaks).
- Uses the original data (counts), not the cleaned copy, because the weights need raw counts.

### Checks

- `tests/rietveld.test.ts`: cell symmetry, family expansion (cubic {511}/{333}), Hill–Howard
  formula and uncertainty, synthetic recoveries (cubic cell, zero, η, χ² ≈ 1; two-phase weight
  fraction; tetragonal cell 0.6 % off and March–Dollase r), s.u. notation.
- `tests/rietveld-gsas.test.ts`: refines a pattern simulated by GSAS-II (fixture in
  `tests/fixtures/rietveld/`, scripts and the side-by-side table in `scripts/validation/rietveld/`):
  cells within 1e-4 Å, zero within 0.002°, anatase weight fraction 0.7680 against the true 0.7692
  (GSAS-II's own refinement of the same data: 0.7684).
- Owner's BV-03 pattern (not committed) with monoclinic BiVO4 (COD 9013437) fetched through the
  lookup: the main phase fits (R_wp 36 %, R_exp 12.5 %); peaks near 11.8, 23.5, 32.4, 37.3, 48.5
  and 55.5° are not explained by that phase and the app says the GOF is high. 2.9 s for 3,500
  points in Node.
- Lint, typecheck, 725 tests (1 skipped), build and bundle budget pass; e2e passes with the new step.

### Known issues

- No peak asymmetry, anisotropic broadening, absorption or surface-roughness corrections; atom
  parameters are fixed; |F|² is not recalculated when the cell changes.
- A full scan of about 50,000 points takes tens of seconds (it runs in a worker).

## UI pass: always-visible Next, export with the plot, basic vs Advanced (done)

Branch `claude/zen-edison-acnmco`, from the owner's request that beginners see only the basics,
that exporting a figure needs no scrolling and that Next is always reachable.

### What was built

- Wizard footer (Back, "n of N: step", Next) is sticky at the bottom of the screen on every tool;
  above the plot panel on narrow screens.
- The pinned plot panel now holds the export buttons (SVG, PNG 300 and 600 dpi, PDF, journal
  width); custom size, font and line width moved under Advanced "Figure size and font". The
  view switches that change the plot (XRD and FTIR "Show" before/after, FTIR fingerprint region
  and absorbance/transmittance, overlay normalise/offset) moved into the panel too, and a "Show the
  whole range" button appears when zoomed. The typed plot range moved under Advanced.
- Redundant controls removed: the dock note "Show it here instead" (same as Unpin) and FTIR
  "Whole range" (same as "Show the whole range"). The full step list is shown compact while a plot
  is pinned and the screen is under 1800 px.
- Moved under Advanced: XRD Kα2/Kα1 ratio, XRD peak minimum separation (with the noise filter),
  XRD "Add a peak by its position", TGA DTG window, minimum separation and DTG unit, particle
  noise smoothing.
- Fixed a phone-width sideways scroll caused by the footer's text.

### Checks

- Lint, typecheck, 715 tests (1 skipped), production build and bundle budget pass; e2e passes,
  including no horizontal scroll at 360 and 1280 px. Every step of every tool checked at 360 px for
  sideways scroll (none) and by screenshot at 360, 768, 1280 and 1920 px.

### Next

- Basic Rietveld refinement (approved by the owner): plan, core engine, validation, wizard step.

## Online COD search through a Cloudflare Worker (done)

Branch `claude/zen-edison-acnmco`. The owner approved relaxing the "no backend" rule for one
read-only COD lookup (CLAUDE.md section 2 updated).

### What was built

- `worker/lookup.js` (handler) and `worker/index.js` (entry with Cloudflare's cache), deployed by
  `.github/workflows/worker.yml` with wrangler 4.152.0. Two routes only: `/search` (elements,
  optionally only those, or an exact Hill formula) and `/cif/<7 digits>`. Inputs are validated
  before COD is contacted; COD's `format=count` is asked first and searches over 300 results are
  refused with their count (COD has no result limit: Fe + O "contains" is 24,133 entries, 37 MB,
  which would exceed the free plan's CPU time to parse). CORS only for the live site, its preview
  channels and localhost. Setup steps: docs/cod-lookup.md.
- XRD step 3: "Search COD online" with a clickable periodic table (44 px cells, scrolls sideways
  in its box on phones), "only these elements" or "these and any others", exact formula (converted
  to COD's Hill order), result filter, and Add: the CIF is downloaded and calculated in the
  browser by the same worker and checks as uploaded CIFs. Hidden while `COD_API` is empty.
- `hillFormula` moved to `src/core/xrd/reference/search.ts`; `readCifText` in `cifClient.ts`;
  re-adding a removed CIF phase replaces the old copy instead of duplicating its id.

### Checks

- `tests/cod-lookup.test.ts` (8 tests, COD stubbed) and `tests/cod-search.test.tsx` (5 tests,
  real CIF reader).
- Handler run against the live COD from Node and inside `wrangler dev` (Cloudflare's runtime):
  Bi-V-O only → 23 entries, BiVO4 formula → 9, Fe-O only → 154, Fe-O contains → refused (24,133).
- Browser walkthrough at 1280 and 360 px against a local copy: search, add COD 9013437, the phase
  appears as a candidate; no console errors, no horizontal page scroll.

### Deployed

- The owner added the Cloudflare secrets; the Worker runs at
  `https://plot-bhai-cod.plot-bhai.workers.dev` (checked live: Bi-V-O only → 23 entries, CIF
  9013437 served, no CORS header for a foreign origin, Fe-O contains → refused with 24,133).
- `COD_API` and the CSP `connect-src` point to it.

## Research-readiness audit against the user's data (done)

Branch `claude/zen-edison-acnmco`. Run at the user's request with their files: an X'Pert XRD scan
(BV-03, Cu, 10–80°, 0.02°), three FTIR %T spectra (TiO2 400 C, Au/TiO2, citrate-capped Au), a TiO2
UV-Vis DRS file given as absorbance, Au colloid spectra (15, 30, 50 nm) and a 2048 × 2048 TEM image
of Au/TiO2 with a 20 nm scale bar. The files are not committed (tests/fixtures-real/README: only
publicly shareable files); waiting for the user's permission.

### Bugs found and fixed (root causes)

- FTIR: the final graph always showed absorbance. Every spectrum is converted to absorbance on
  import (correct for processing), but Results drew `absorbance` directly and no step carried the
  user's display choice. New `src/modules/ftir/quantity.ts` keeps the choice separate from the data;
  every step shows %T or A (T = %T/100, A = −log₁₀T), tables list both, methods text states what is
  shown. Normalised spectra stay in absorbance with a stated reason.
- XRD import ignored the X'Pert `[Measurement conditions]` header (wavelength, time per step).
  `readHeader()` now reads it into `metadata` and shows it.
- Peak detection had no noise criterion: about 100 false peaks per pure-noise scan. Added a local
  noise estimate (MAD of second differences) with minimum SNR 3 and width 3 steps: about 0.1.
- Levenberg–Marquardt: an infinite bound counted as "at bound", parameters on a bound got
  meaningless σ, and a near-singular matrix gave huge σ instead of a flag. Fixed; σ is n/a with a
  message in those cases; reduced χ² against the local noise added to every region.
- Reference library builder read "K" temperature units as °C (regex), which rejected
  clinobisvanite wrongly (it is still rejected, correctly, for a negative U in COD 9013437).
- Late Preact cleanup touched `document` after jsdom teardown (unhandled error in wizard.test).

### Built

- XRD phases: library grown to 70 phases in 48 families (all pass the Waasmaier–Kirfel check,
  docs/reference-crosscheck.md); search by formula, chemical system, elements, space group, COD ID
  or name; several candidates; CIF upload calculated in a worker; calculated overlay with
  non-negative scales and a difference curve; COD and Materials Project links. A live database
  search is impossible here: both send no CORS headers (checked with a preflight) and there is no
  server. State version 9 with migrations from 6–8.
- Background: arPLS (shared Whittaker solver with AsLS) is now the default for XRD and FTIR, chosen
  by tests/baseline-validation.test.ts (numbers in the About page); cut-into-data warning; SNIP noise
  bias noted. XRD background stays step 2, before phases and fitting.
- Figure editor (separate from data, saved per figure): series colour, width, dash, opacity, fills,
  legend names and visibility; text, arrows, markers, vertical and horizontal lines, shaded regions
  (placed by clicking, editable and removable); peak label edits; axis titles and y limits; ticks;
  grid; legend position; custom width; PDF export (600 dpi raster in a hand-written PDF); a
  minimum-height warning.
- FTIR atmospheric CO2/H2O flags (NIST CCCBDB); UV-Vis warnings when the derivative maximum is at
  the edge of the data and when a DRS-named file is treated as absorbance; particle threshold
  sensitivity (±10 grey levels).
- Analysis records (Markdown) for XRD, FTIR and UV-Vis: header metadata, SHA-256 of the data, every
  step with settings and warnings, results with σ, methods text, build id (git commit and date).
- Plots stay in view while settings change (`src/ui/Dock.tsx`): a column on the right from 1100 px,
  a panel along the bottom on narrower screens, with Minimise and Unpin (a per-browser preference).
  One figure per page: the first, or the one the user picks; secondary plots (method details) only
  when asked. Used by every plot panel, the particle detection image and the size histogram. This
  exposed a latent bug: the particle image viewer never refitted when its box changed size; it now
  refits unless the user has zoomed or panned.
- Shared `Advanced` collapsible sections. There was no Beginner/Intermediate/Expert selector in
  the code, so nothing was removed.

### Results on the user's data (summary; details in the final report to the user)

- BV-03: 26 peaks; no library BiVO4 polymorph explains it without a shift; clinobisvanite from the
  COD 9013437 CIF matches 19 of 34 lines after +0.26° (possible displacement or zero error, check
  with a standard); peaks at 23.6, 32.4, 37.4, 48.5, 55.4, 66.2, 78.2° unexplained, so a second phase
  is likely but unidentified. Scherrer sizes (no instrument standard) are lower limits.
- FTIR, UV-Vis, Au colloid and TEM numbers as reported; the files look synthetic (smooth bands,
  perfect discs, an R² = 1.0000 Tauc line).

### Known issues

- arPLS citation and the width-to-λ relation are marked TODO(verify).
- PDF is raster; SVG stays the vector format.
- The calculated overlay refines no positions, cell or profile; it is not Rietveld.
- Clinobisvanite is not in the bundled library (COD entry has a negative U); load it as a CIF.

## Stage 13: Multi-heating-rate kinetics (done)

Branch `claude/friendly-cray-f64dgw`. Optional stage, run at the user's request.

### What was built

- Third wizard on the thermal page ("Kinetics (several heating rates)"), lazy-loaded:
  1 Upload runs and heating rates, 2 Method and window, 3 Results and export.
- `src/core/thermal/kinetics.ts`: peak temperature (parabola through the highest point), Kissinger,
  Flynn-Wall-Ozawa (Doyle approximation) and Kissinger-Akahira-Sunose at fixed conversion, with the
  equations in the doc comments, standard errors from the straight-line fit, R² per conversion level,
  and plain-language warnings (fewer than 3 or 5 rates, narrow rate range, poor R², Ea varying more
  than 20 % over conversion, "apparent" energy).
- Kissinger works on TGA (DTG maximum) or DSC runs (peak up or down in the file, so no exo/endo
  assumption is made); FWO and KAS need mass in every run.
- Results: headline Ea ± standard error, table, plot (1000/Tp line, or Ea against α) in the shared plot
  panel with SVG/PNG export, table CSV, methods text from the settings used, session file
  (`kinetics-session`).
- About page now lists the kinetics equations.
- `scripts/audit.mjs` now reloads before each tool, so CSS left over from an earlier tool no longer hides
  missing imports, and it also visits the DSC and Kinetics wizards. That exposed a real bug: the particle
  tool used `.check` (touch-target size) without loading `plot.css` on a direct visit. Fixed.

### Known-answer results

A first-order reaction (made-up: Ea = 150 kJ/mol, A = 1e14 per minute, 40 % mass loss) integrated with
Runge-Kutta at 2, 5, 10, 20 and 40 K/min: Kissinger, FWO and KAS all recover Ea within 3 % (tests assert
this; Kissinger is exact for peaks placed on its line to 6 decimals). The Kissinger and Doyle
approximations are not exact for first-order kinetics, which is why the tolerance is 3 %.

### Decisions

- R = 8.314 462 618 J mol⁻¹ K⁻¹ read from the NIST CODATA 2022 page (exact) on 2026-10-25. The Doyle
  coefficient 1.052 is the value from the project brief and was not checked against the original paper:
  flagged "verify" in code, About page and here.
- Conversion uses the masses at the two ends of the chosen window, with the mass made non-increasing
  first so noise cannot reduce α.
- Conversion levels, window and DTG smoothing are my defaults (0.1 to 0.9, shared range, 10 °C).

### Known issues

- The straight-line standard errors are the fit's, not a full uncertainty budget (peak position errors
  are not propagated).
- No Friedman or Vyazovkin method; no model fitting. Not tested with real multi-rate data.

### Needed from the user

- Check the Doyle coefficient and, ideally, run a real set of 4 to 5 heating rates.

## Sub-stage 14b: About page, PWA, deploy, final status (done)

Branch `claude/friendly-cray-f64dgw`. Stage 14 items 5 to 8. This closes the planned work (stages 13 and 15
are optional and were skipped).

### What was built

- `src/ui/About.tsx` at `#/about`, linked from the footer: privacy statement, limitations, the equations
  for every tool (copied from the doc comments in `src/core`, so they match the code), the COD attribution
  and the FTIR table source (CC BY 4.0). It is part of the app shell (not lazy) because a lazy load shifted
  the footer (CLS 0.12); the shell is still 11.8 KB gzipped of 150 KB. Test: `tests/about.test.tsx`.
- Offline support without a library: `public/sw.js` (network first for pages, cache first for hashed
  `/assets/`), `public/manifest.webmanifest`, 192 and 512 px icons rendered from `favicon.svg`. Registered
  after `load`, production only. Checked in Chromium: the About page reloads offline.
- `public/robots.txt` (fixes the only SEO miss from 14a).
- `deploy.yml` now skips itself with a notice when the `FIREBASE_SERVICE_ACCOUNT` secret is missing (like
  `preview.yml`), so merges do not fail before setup. README: setup steps corrected (`.firebaserc` already
  names `plot-bhai`), live deploy explained, offline and audit notes.

### Final numbers (this machine, headless Chromium, mobile emulation, production build)

| Page  | Performance | Accessibility | Best practices | SEO        | LCP   | CLS   |
| ----- | ----------- | ------------- | -------------- | ---------- | ----- | ----- |
| Home  | 100         | 100           | 100            | 100        | 1.1 s | 0     |
| About | 100         | 100           | 100            | not re-run | 1.1 s | 0     |
| XRD   | 99          | 100           | 100            | 100        | 1.9 s | 0.042 |

Other tools were measured in 14a (all 100 for performance). Tests: 626 passed, 1 skipped. Lint, type check,
build, bundle size (11.8 KB initial), e2e and `npm run audit` all pass.

### Final status

All five tools (XRD, UV-Vis, FTIR, particle size, TGA/DSC/combined) are built, share one design system, plot
engine and export system, and run fully in the browser.

### Known issues

- The live site is not deployed yet: it needs the Firebase service account secret from the README (your
  step). I could not do or verify this from here.
- The service worker never removes old hashed files from its cache after a release; clearing site data
  does. A cache-size cap is a later idea.
- Dark-theme contrast was not measured separately. Not tested on a real phone or screen reader.
- Tables flagged "TODO, verify" (thermal events, combined rules, FTIR groups, wavelengths) still need your
  check against your own literature.
- XRD still has its own session-file copy rather than the shared `SessionSection`.

### Ideas for later

Activation energy (stage 13), the optional Gemini text helper (stage 15), cache cleanup in the service
worker, more X-ray anodes, Lighthouse in CI.

## Sub-stage 14a: Polish (done)

Branch `claude/friendly-cray-f64dgw`. Stage 14 items 1 to 4 (responsive audit, Lighthouse, accessibility, states).

### What was built

- `scripts/audit.mjs` (`npm run audit`, run `npm run build` first): opens the home page and every tool at
  360, 768, 1280 and 1920 px, loads the example data, steps through every wizard step and reports sideways
  page scroll, touch targets under 44 px, unnamed controls and unnamed plots. Result: clean at all four widths.
- Real accessibility defects found and fixed: a control placed after a "What is this?" help button inside the
  same label was left without an accessible name (number inputs, the prominence slider, the tolerance input,
  the atmosphere and sample type selects). They now carry an `aria-label`.
- `src/ui/ErrorBoundary.tsx`: a render error in a tool shows a plain message with "Try again" and "Reload the
  page" instead of a blank screen (work is kept in IndexedDB). Test: `tests/errorBoundary.test.tsx`.
- Loading and chunk-load failure states already existed in `LazyTool`; reduced motion is handled in `tokens.css`.

### Measured numbers

Lighthouse 12, mobile emulation with default throttling, headless Chromium, against `vite preview` of the
production build on this machine (not a real phone):

| Page      | Performance | Accessibility | Best practices | SEO | LCP   | CLS   | TBT   |
| --------- | ----------- | ------------- | -------------- | --- | ----- | ----- | ----- |
| Home      | 100         | 100           | 100            | 91  | 1.2 s | 0     | 0 ms  |
| XRD       | 100         | 100           | 100            | 91  | 1.9 s | 0.02  | 10 ms |
| UV-Vis    | 100         | 100           | 100            | 91  | 1.7 s | 0.021 | 0 ms  |
| FTIR      | 100         | 100           | 100            | 91  | 1.8 s | 0.023 | 0 ms  |
| Particles | 100         | 100           | 100            | 91  | 1.7 s | 0.02  | 0 ms  |
| Thermal   | 100         | 100           | 100            | 91  | 1.9 s | 0.029 | 10 ms |

Initial JavaScript is 8.7 KB gzipped (budget 150 KB); each tool is its own chunk. Tests: 625 passed, 1 skipped.

### Decisions

- Lighthouse is run ad hoc with `npx lighthouse@12` and is not added as a dependency.
- Colour contrast was checked by Lighthouse (accessibility 100, which includes contrast) in the light theme
  only; the dark theme was not separately measured.

### Known issues

- SEO 91 on every page: `robots.txt` is invalid. Belongs to 14b (deploy files).
- Lighthouse was not run on later wizard steps, only on each tool's first screen; the audit script covers
  later steps for layout, targets and names, not performance.
- Hash-route pages are measured by Lighthouse as separate loads of the same document.

### Needed from the user

- A check on a real phone and a real screen reader pass; neither can be done here.

### Next sub-stage

14b: About page, PWA, deploy, final status (Stage 14 items 5 to 8).

## Sub-stage 12b: Combined TGA-DSC (done)

Branch `claude/friendly-cray-f64dgw`, started from the merge of pull request 20 (12a is in `main`).
Stage 12 items 7 and 8: combined TGA-DSC, export, methods text, session file, and the end-to-end test.

### What was built

- **Step 5 "Combined interpretation"** in the DSC wizard (Results is now step 6). The mass curve comes
  from a mass column of the DSC file (a simultaneous run) or an optional second TGA file, both chosen
  in step 1. The mass is interpolated onto the DSC temperatures (`alignOnTemperature`, no
  extrapolation), so the two curves share exactly the same temperatures. They are drawn as a dual
  panel (mass on top, heat flow below on one temperature axis, exo direction in the axis label).
- `src/core/thermal/combined.ts`: the four correlation rules in plain language (mass loss with an
  endotherm → dehydration, evaporation or decomposition; with an exotherm → combustion or oxidation;
  no mass change with an exotherm → crystallisation, phase transition or ordering; with an endotherm
  → melting or solid-solid transition); re-ranking of the DSC suggestions and of the TGA step
  suggestions; calcination marks for an exotherm without mass change above the last mass loss step,
  with the candidate temperatures below it and the advice to check by XRD.
- Accept, own words and reject for every DSC event and every mass loss step; the "guidance" and
  "DSC alone / TGA alone cannot identify…" notes, the calcination warning and a "not verified" note.
- **Results (step 6)**: combined table with CSV, calcination marks with CSV, **Methods text** written
  from the settings used (`dscMethods.ts`) with a Copy button, and a **session file** (`dsc-session`,
  re-importable). The DSC state is now version 2, with a migration for version 1 saves.
- Event detection (12a) no longer reports the ridge between two neighbouring peaks of the opposite
  sign as an event; found while building the simultaneous example, which has four well-separated
  events but gave six.
- Example data: a synthetic simultaneous run (`exampleStaTable`, "Try with combined TGA-DSC example").
- Tests: `combined` (9, known answers on the synthetic run: alignment, four rules, re-ranking, the
  520 °C mark), 7 more UI tests in `dscSteps`, and an e2e block for the whole path.

### Decisions (my own, please confirm)

- The combined view lives in the DSC wizard. It reads its own mass steps (default cleaning and
  detection), so it does not read the separate TGA wizard's assignments; it keeps its own
  assignments for the steps.
- Re-ranking adds or removes 0.25 of score, and "high" confidence is only possible when the mass
  curve supports an in-range suggestion. A rule counted against drops one confidence level. These
  weights only order the suggestions.
- "No mass change" means less than 0.5 % points between the start and end of the event (adjustable).
- The combined view needs a heating ramp; a cooling ramp gives a message instead.
- The calcination suggestion uses the default calcination settings.

### Needs your input (not verified)

- **`data/thermal/combined-rules.json`**: the usual heat flow direction of each TGA rule is my own
  placeholder, flagged "TODO, verify". The UI says so. Please give sources or corrections.
- **`data/thermal/dsc-events.json`** (12a) is still placeholders. For example its crystallisation
  range is 50 to 350 °C, so the 520 °C exotherm of the example is described as crystallisation by the
  mass reading but is not offered as a ranked suggestion.
- The weights, the 0.5 % points threshold and the synthetic example values are mine.
- **A real DSC file and a real combined TGA-DSC file** are still wanted; only synthetic data were used.

### Known issues

- The mass and DSC curves are matched on temperature only. The mass curve uses the first heating ramp
  of its file; if the DSC ramp chosen in step 2 is a later heating ramp, the two are not the same scan.
- The mass steps in step 5 use default settings and cannot be edited there.
- Sigmoidal baselines (12a) still assume a step across the event.

### Next

14a: polish (responsive, Lighthouse, accessibility, states). Stage 13 is optional and skipped.

## Sub-stage 12a: DSC (done)

Branch `claude/friendly-cray-f64dgw`, started from the merge of pull request 19 (11b is in `main`).
Stage 12 items 1 to 6 only. Combined TGA-DSC, methods text and the session file are 12b.

### What was built

- **A separate DSC wizard** in `src/modules/thermal/dsc/`, lazy-loaded (own chunk, `DscTool-*.js`),
  chosen with a TGA / DSC switch at the top of the thermal tool (remembered in localStorage, in a
  try/catch). It has its own saved session (`dsc-session`); the TGA data model is untouched.
  Steps: Upload, Clean data, Baseline and events, Glass transition and crystallinity, Results.
- `src/core/thermal/dscClean.ts`: heat-cool-heat segments from the temperature direction
  (`splitSegments`), heat flow in mW, mW/mg or W/g made exo-positive and divided by the mass
  (`toExoPositive`), scan rate from the entered value else the time column, cropping and smoothing.
- `src/core/thermal/dsc.ts`: linear, sigmoidal and spline baselines; peak detection with slope-based
  limits; extrapolated onset, peak and endset; ΔH in J/g (mJ without a mass) and kJ/mol with a molar
  mass; half-height glass transition with onset, endset and ΔCp; crystallinity
  Xc = (ΔHm − ΔHcc)/(w·ΔH0)·100.
- `src/core/thermal/dscGuidance.ts` and `data/thermal/dsc-events.json`: up to three ranked
  interpretations per event with a plain-language reason; the user accepts, writes their own or rejects.
  Confidence is never "high" from DSC alone. The note "DSC alone cannot tell what happened" is shown.
- The exo up / exo down choice is required in step 1 (nothing is assumed), can be changed for display
  in step 2, and is written on every plot axis, table caption and CSV header line.
- Example data: a synthetic heat, cool, heat run with made-up events (`exampleDscTable`).
- Tests: `dsc-core` (34, synthetic data with known answers: peaks, enthalpies within 1 to 5 %, Tg
  within 1.5 °C, ΔCp within 10 %, units, sign flips, cooling) and `dscSteps` (11 UI tests).
  `npm run e2e` has a DSC block.

### Decisions (my own conventions, please confirm)

- Internal convention: exo-positive heat flow, increasing temperature (cooling ramps are reversed and
  flagged). Reported ΔH is endothermic positive.
- Event limits: where the slope has fallen to 2 % of the steepest flank slope, never below 3 times
  the noise of the slope. Defaults: smallest peak 15 % of the curve's range, 15 °C between peaks.
  Linear baseline by default; sigmoidal and spline are per event.
- Guidance score = 0.5 · temperature fit + 0.3 · direction + 0.1 · sample type + 0.1 · scan. It orders
  suggestions only. Peak shape is described in the reason, never used to rank.
- Crystallinity is only calculated on a heating ramp in J/g.

### Needs your input (not verified)

- **`data/thermal/dsc-events.json` ranges are placeholders** flagged "TODO, verify". No source could
  be opened, so every range is broad on purpose. The UI says so next to the guidance. Please supply
  sources or ranges you trust.
- **No ΔH0 values are shipped.** The user types one in; the site never claims it is correct.
- A **real DSC file** (any instrument) would test the import and the exo direction handling; only
  synthetic data were used.

### Known issues

- Sigmoidal baselines assume a step across the event; on the synthetic example (no step at its
  peaks) the linear baseline is the right one and gives the made-up ΔH within 2 %.
- No combined TGA-DSC view, methods text or session file yet (12b).

### Next

12b: combined TGA-DSC interpretation, re-ranking of events, calcination update, export and methods text.

## Sub-stage 11b: TGA events, theory, calcination (done)

Branch `claude/friendly-cray-f64dgw`, started from the merge of pull request 18 (11a is in `main`).

### What was built

- Wizard steps 4 to 6 of the thermal tool replace the placeholders: **Assign events**, **Calcination
  suggestion**, **Results and export**.
- `data/thermal/atomic-weights.json`: 84 elements, parsed by `npm run build:weights`
  (`scripts/build-atomic-weights.ts`) from the CIAAW "Abridged Standard Atomic Weights 2024" page
  (https://ciaaw.org/abridged-atomic-weights.htm). The page is cached in `data/thermal/source/`, so
  the build is repeatable offline. Values are the table cells, in g/mol, with the page's ±.
- `src/core/thermal/formula.ts`: formula parser (brackets, hydrate dots, subscript digits), molar
  mass, theoretical mass loss `(ν_A·M_A − ν_B·M_B)/(ν_A·M_A)`, and five ready examples (Zn(OH)₂,
  Fe(OH)₃, CaCO₃, Cu(NO₃)₂·3H₂O, CuSO₄·5H₂O).
- `src/core/thermal/events.ts` and `data/thermal/events.json`: rule table and ranking. Up to three
  candidates per step with a plain-language reason and a low/medium/high confidence label. Rules that
  need oxygen are dropped in nitrogen or argon. "High" needs the peak inside the range, a matching
  sample category and a theoretical loss that agrees. The user accepts, writes their own, or rejects.
- `src/core/thermal/calcination.ts`: minimum = endset of the last step losing at least the threshold
  (default 1 %) plus a margin (default 50 °C); three candidates spaced 100 °C apart that lie inside
  the data; plateau change above the minimum; the "starting point, not an optimal temperature"
  warning is always shown.
- `src/core/thermal/methods.ts`: methods paragraph from the real settings only.
- Shared plot: new `bands` option (shaded x ranges with a label), drawn on screen and in SVG/PNG
  export. Steps are shaded and numbered on the mass curve in steps 4 to 6.
- Results step: table (onset, peak, endset, loss, residual, your event), CSV, T5/T10/T50, figure with
  DTG, methods text, and a JSON session file (`thermal-session`, state version 2 with a migration
  from version 1).
- Tests: `thermal-events` (19: formulas, hand-computed theoretical losses, ranking rules,
  calcination on known-endset curves, methods text) and `thermalEvents` (10: the three steps, session
  round trip, migration). `npm run e2e` has a block for steps 4 to 6.

### Decisions (my own conventions, please confirm)

- Ranking score = 0.6 · temperature fit + 0.3 · sample category + 0.1; it only orders candidates and
  is not a probability. Candidates more than 50 °C outside a range are dropped.
- Measured loss is compared with theory as a percentage of the mass just before the step.
- Candidate calcination temperatures: minimum, +100 and +200 °C (spacing adjustable).
- Atomic weights are the abridged ones (about five significant figures), not the interval values.

### Known issues

- **`data/thermal/events.json` is NOT verified.** No open table of typical event ranges could be
  opened in this session, so every range is a broad general-knowledge placeholder and every `source`
  says "TODO, verify". The app says this on the Assign events step. Possible leads to check (not
  opened here): a pyrolysis paper giving hemicellulose 220–315 °C, cellulose 315–400 °C and lignin
  160–900 °C, and a date palm TGA paper giving free water up to about 110 °C.
- DSC is not loaded yet, so exothermic events above the last mass loss are not marked (12b).
- Deconvolved components are still table-only.
- No real TGA file yet.

### Needs from you

- Replace the ranges and sources in `data/thermal/events.json` with values you have checked.
- A real TGA text/CSV export with instrument-software or Origin numbers.
- Confirm the conventions above.

### Next sub-stage

12a: DSC (Stage 12 items 1 to 6).

## Sub-stage 11a: TGA import to step detection (done)

Branch `claude/hopeful-dirac-72ak86`, stacked on 10c (pull request 18 is still not merged into `main`).

### What was built

- Thermal tool at `#/thermal` (lazy-loaded; the TGA and DSC cards on the home page link to it). Six
  wizard steps; steps 4 to 6 (events, combined interpretation, results and export) are placeholders
  for 11b.
- Core in `src/core/thermal/`: `import.ts` (text files with header lines, comma, semicolon, tab or
  space delimiters, decimal commas, column guess and manual mapping, K to °C by −273.15, s to min),
  `process.ts` (ramp range, blank subtraction by interpolation, smoothing, normalising at a chosen
  temperature, heating-rate estimate), `smooth.ts` (local quadratic least squares on uneven x, window
  in °C), `steps.ts` (DTG, step detection, onset, peak, endset, mass loss, T5, T10, T50, residue),
  `deconvolve.ts` (Gaussian split of overlapping DTG peaks, via the existing `fitRegion`),
  `synthetic.ts` (example data and known-answer curves).
- Step 1 describes the run (atmosphere, heating rate, initial mass, sample type) and shows a preview.
  Step 2 cleans (range, blank, smoothing, normalising, undo and reset, before and after plot).
  Step 3 shows mass and DTG, steps with draggable limits, editable From and To, add and remove a step,
  CSV download, T5/T10/T50, residue at the end and at a chosen temperature.
- The export figure now supports a labelled lower panel (`LowerAxis`) for DTG.
- Tests: `thermal-core` (24, known answers from synthetic curves), `thermalSteps` (9); `npm run e2e`
  has a thermal block (example run, marker drag, 10,000-point file with decimal commas, no horizontal
  scroll at 360 and 1280 px).

### Decisions (my own conventions, please confirm)

- DTG = −dm/dT in %/°C from a local quadratic fit; the window is set in °C (default 20).
- Extrapolated onset and endset: Tp ∓ the mass change on that side divided by the DTG at the peak
  (tangent at the steepest point). Tested on Gaussian-DTG curves, where the true values are
  Tp ∓ σ√(2π)/2.
- Step limits default to where DTG falls to 2 % of the peak, or to the valley towards a neighbour.
- Two steps count as overlapping when the valley DTG is above 10 % of the smaller peak; they are
  reported as one region with a note, and can be split into Gaussian components (labelled an
  approximation).
- Peak prominence is a percentage of the tallest peak (default 5 %, minimum separation 20 °C).
- T5/T10/T50 are the first downward crossings of 95, 90 and 50 % by interpolation.
- The app says that TGA alone cannot tell which substance is lost in a step.

### Known issues

- No real TGA file or instrument export was available, so the importer is generic and makes no vendor
  claim. Real exports may need column mapping by hand.
- DTG runs on the main thread (about 250 to 300 ms for 10,000 points).
- Deconvolved components are in a table only, not drawn. Step shading, thermal session file and
  export of the figure with annotations come in 11b.

### Needs from you

- Merge pull request 18 into `main`.
- Real UV-Vis, FTIR and SEM/TEM files (and ImageJ numbers) in `tests/fixtures-real/`; check the FTIR
  ranges against a textbook; confirm the %R reference-correction convention.
- A real TGA text or CSV export, with instrument-software or Origin numbers, to verify the importer
  and the step numbers; confirm the 2 %, 10 % and onset/endset conventions above.

### Next

Sub-stage 11b: events, theory and calcination suggestion (Stage 11 items 6 to 9).

## Sub-stage 10c: particles, distribution and export (done)

Branch `claude/hopeful-dirac-72ak86`, stacked on 10b (pull request 18 is still not merged into `main`).

### What was built

- Step 5 "Distribution and export" replaces the placeholder. Pure maths in
  `src/core/particles/distribution.ts`: percentiles (linear interpolation between sorted values, as
  NumPy and `PERCENTILE.INC`), mean, sample SD (n − 1), median, D10, D50, D90 (by number), span
  (D90 − D10) / D50, histogram bins by Freedman–Diaconis (2·IQR/n^(1/3), Sturges fallback when IQR is
  0), Sturges (⌈log2 n⌉ + 1) or a manual count (1 to 200), cumulative curve, normal and lognormal fits
  by maximum likelihood (σ with divisor n, log-likelihood reported; the higher one is named as a hint,
  not as proof), and the warning below 100 particles.
- Size measure: equal-area diameter, longest or shortest Feret diameter. Hand measurements from step 4
  can be added.
- Pooling: "Save this image for pooling" stores the diameters of the image in the saved state; the
  pool survives loading another image. Images with and without a scale (nm and px) are never mixed;
  the ones left out are listed. The image on screen is counted once even after it was saved.
- Histogram figure (`HistogramChart.tsx`): bars, fitted curve scaled to counts, optional cumulative
  curve on a right axis, inward ticks; SVG and PNG at 300 and 600 dpi, single or double column,
  Arial or Times. CSV: summary, all sizes with their image, detected particles (the 10b table).
  Annotated image PNG (outlines and numbers on the working copy, dashed crop frame).
- Methods text (`src/core/particles/methods.ts`) written only from the settings used (scale, detection
  settings, filters, hand edits, measure, bins, fits). It says nothing about the microscope.
- Saved state version 3 (migration from 2 and 1).
- Tests: `particles-distribution` (percentiles, bins and fits against hand-computed values; samples of
  20 000 from a known lognormal and normal recover the parameters within 1 to 2 %),
  `particlesDistribution` (sizes, pooling, migration, methods text, the step). `npm run e2e` runs the
  step in a real browser; the example's mean and median are within 3 % of the true values.

### Decisions

- Percentile definition, bin rules and ML formulas are standard textbook ones, written in the doc
  comments. Nothing was taken from memory as a published number.
- D10, D50 and D90 are number-based, not volume-based; the help text and methods text say so.
- A saved pool entry with the same file name as the image on screen is replaced when saved again and
  not counted twice. Two different files with the same name are treated as one.

### Known issues

- No JSON session file for particles yet (the image itself lives in IndexedDB and is not in the file).
- Circularity of a digital disc reads about 0.9 (see 10b).
- Heights of the exported histogram follow the preset (65 mm single, 100 mm double); no free height.
- Not tried with a real SEM or TEM image.

### Needs from you

- Merge pull request 18 into `main`.
- A real SEM or TEM image with its scale bar, and ImageJ numbers for the same particles, in
  `tests/fixtures-real/`.

### Next sub-stage

11a (TGA: import to step detection).

## Sub-stage 10b: particles, automatic detection (done)

Branch `claude/hopeful-dirac-72ak86`, stacked on UV-Vis, FTIR and 10a (pull request 18 is still not
merged into `main`).

### What was built

- Wizard is now 1 Upload, 2 Crop and scale, 3 Detect particles, 4 Measure by hand, 5 Distribution and
  export (placeholder until 10c). The hand tools of 10a are unchanged.
- Pure TypeScript pipeline (`src/core/particles/detect/`), no OpenCV, run in a Web Worker
  (`src/workers/detect.worker.ts`, `detectClient.ts`; cancel button; the page stays responsive):
  grayscale (BT.601 weights), optional invert, Gaussian blur or median filter, threshold (Otsu from
  the histogram of the crop area only, adaptive by local mean, or manual), the analysis area, opening
  and closing by a disc (exact Euclidean distance transform), fill holes, 8-connected labelling, and
  a watershed split of touching particles.
- Splitting: marker watershed on the distance transform. Every local maximum starts a basin; basins
  are merged again unless the neck between them is narrower than a chosen percentage (default 70 %)
  of the smaller basin's radius. Equal discs overlapping by 2 px are split; a rod and a heavily
  overlapped pair stay whole.
- Per particle (`regions.ts`): area, area-equivalent diameter, longest and shortest Feret diameter
  (from the convex hull of the pixel outline), aspect ratio (longest / shortest Feret), perimeter,
  circularity (4π area / perimeter², at most 1), centroid. Particles are stored as pixel runs, which
  makes merging, cutting and re-measuring exact.
- Review and editing: outlines with ID numbers over the image (vector layer), threshold preview
  (pink), Select tool (click, Shift or Ctrl for several) and a select checkbox in every table row,
  Delete selected, Merge selected, Cut (drag a line across a neck), Add a circle or an ellipse for
  missed particles, Undo (30 steps). IDs are never reused.
- Filters that hide without deleting: diameter limits in px, nm or µm, lowest circularity, leave out
  particles touching the edge (the crop area or image edge); counts say how many were left out and
  why. Table with sizes in px, nm or µm and a CSV with all columns, in px and nm.
- Warnings: no particles found, more than half the image marked as particles (probably dark particles
  and "darker than the background" not ticked), result out of date after a setting or crop change, and
  the required note: "Automatic detection works best on well separated particles with good contrast.
  Review the outlines."
- Saved state version 2 with a migration from version 1.
- Tests: `particles-detect` (primitives and whole-pipeline accuracy), `particles-view`
  (working-copy mapping, filters, migration), `particlesDetect` (component, worker mocked); `npm run e2e`
  detects the example in a real browser.

### Known-answer results

- Synthetic images of 7 discs of 30 to 60 px, noise sd 10 grey levels: all found, equivalent diameters
  within 3 % (the real worst error was below 1 %). A touching pair of equal discs (4 px overlap) and an
  unequal pair are split and measured within 5 to 6 %; without splitting they are one blob. Dark
  particles need the invert option. Particles outside the crop (a black data bar) are ignored, and
  Otsu is computed without the bar. Detection on a half-size copy, diameters mapped back, within 3 %.
  Edge-touching particles are flagged.
- In a real browser the example image (12 discs, crop off the data bar) gave all 12 diameters within
  0.8 % of the true ones, in about 0.9 s.
- Speed: 4 MP (node) 3.4 s; a 20 megapixel PNG in a real browser (working copy 4096 × 2731) took 10.3 s
  to detect 341 particles, with the page responsive (longest frame gap 17 ms while it ran). This is
  acceptable with the progress note and Cancel button, so OpenCV.js was not added.

### Decisions

- Circularity is a corner-cutting estimate: a circle drawn in pixels reads about 0.90 and a square
  0.83 (true 0.785). The perimeter joins midpoints of the outline's unit edges, which leaves round
  shapes about 5 % long. The help text and the CSV note say so. Equivalent diameter and area use the
  pixel count and are accurate to about 1 %.
- Aspect ratio is longest over shortest Feret diameter, not the ratio of fitted ellipse axes.
- The default settings (Gaussian blur 1 px, Otsu, opening and closing by 1 px, split at 70 %) are my own.
- Settings radii are in pixels of the working copy (the note says so when the image was shrunk);
  everything stored and exported is in original pixels or nm.
- Merging joins the pixel sets; two particles that are far apart become one particle in two pieces.
- Cut applies to every visible particle the drawn segment touches, along the straight line through it.
- The stored particles keep their pixel runs (a few numbers per row), so saving after each edit
  rewrites a few hundred kilobytes for a thousand particles.

### Known issues

- No real SEM or TEM image has been tried; real images with uneven backgrounds, charging or shadows
  will need the adaptive threshold and probably manual edits.
- Shapes drawn by hand have axes parallel to the image edges; merged and cut particles keep their
  pixels exactly.
- Computing shapes for several thousand particles blocks the page for a moment after detection.
- Detection and manual measurements are separate lists; step 5 (10c) will decide how they combine.
- Particle outlines are drawn for visible particles only; very many (thousands) can feel slow to pan.

### What I need from you

- A real SEM or TEM image with its scale bar and ImageJ numbers for the same particles.
- Merge pull request 18 into `main`.

### Next sub-stage

10c (particles: distribution, export), when you say so.

## Sub-stage 10a: particles, image, scale, manual measuring (done)

Branch `claude/hopeful-dirac-72ak86`, stacked on UV-Vis and FTIR (pull request 18 is still not merged into
`main`). The particle size card on the home page is enabled (`#/particles`).

### What was built

- Wizard: 1 Upload, 2 Crop and scale, 3 Measure, 4 Distribution and export (placeholder until 10c).
- Image import: PNG and JPEG with the browser decoder, TIFF with a lazily loaded decoder (8 or 16 bit
  grayscale and RGB; 16-bit data are stretched from the page's lowest to highest value for display
  only). The file type is read from the first bytes, so a wrong extension does not matter. Gatan .dm3
  and .dm4, damaged files and other types get a plain message with an export hint. Multi-page TIFFs
  use the first page and say so. Images over 150 megapixels are refused (memory).
- Large images: when the long side is over 4096 px a smaller working copy is shown and (in 10b) used
  for detection; everything is stored in pixels of the original image and mapped back
  (`workingScale`, `toWorking`, `toOriginal` in `src/core/particles/geometry.ts`).
- Viewer (`ImageViewer.tsx`): canvas for the image plus an SVG overlay for crop, scale bar and
  measurements (dark outline under a coloured line so it shows on any image). Mouse and touch: drag
  to move or to draw, two-finger pinch to zoom (a second finger cancels a drawing), the wheel zooms
  with Ctrl or Cmd or when the viewer has focus, keyboard arrows, + and −, 0 to fit. Zoom up to 40
  times the fitted size.
- Crop: draw a rectangle or remove a strip from the bottom (data bar). It is non-destructive: it marks
  the analysis area, and the scale bar can still be drawn on the data bar.
- Scale calibration: drag along the scale bar, type its length and unit (nm or µm); shows pixels per
  unit and nm per pixel, warns when the bar is shorter than 50 pixels. Saved with the analysis.
- Manual tools: line (length), circle drawn along a diameter, ellipse drawn as a box (axes parallel
  to the image edges). Each gets an ID that is never reused; table with length or long axis, short
  axis, area, aspect ratio, in nm or µm (or px without a scale); undo last, delete one or all, CSV
  with pixel coordinates and sizes in px and nm.
- Keyboard alternative to drawing: "Enter coordinates instead of drawing" for the scale bar and for
  measurements.
- Example image: drawn by the site (12 discs, 60 to 120 px, scale bar 200 px = 100 nm), marked
  synthetic everywhere; a button sets its scale bar.
- The image file is stored once in IndexedDB (`particles-image`), not inside the saved state, so
  state writes stay small; a reload restores image and measurements (checked in a browser).
- Tests: `particles-geometry` (calibration, conversions, measurement formulas, working copy,
  crop, view maths, and a real TIFF written by the test and decoded), `particlesSteps` (components).
  `npm run e2e` now also covers particles.

### Dependency added

- `tiff` 7.1.3 (image-js, MIT; depends on `fflate` and `iobuffer`). Chosen over `utif` because it is
  typed, maintained, and decodes 16-bit grayscale, which SEM TIFFs often are. It is loaded only when
  a TIFF is opened (its own 29 KB chunk, not in the 8.4 KB initial bundle). Its decoder already
  inverts white-is-zero files, so the display conversion does not invert again (a test caught my
  first, doubled inversion). It refuses TIFFs with an orientation other than 1; the message says so.

### Known-answer results

- 200 px bar of 100 nm gives 2 px per nm; 500 px for 1 µm gives 0.5 px per nm; a 100 px circle at
  that scale is 50 nm with area π·50²/4 = 1963.5 nm²; a 100 × 60 px ellipse is 50 × 30 nm, aspect
  1.667. A scale drawn on a working copy and mapped back gives the same pixels per nm.
- In a browser (360 and 1280 px) a scale bar drawn with the mouse on the example gave 2.014 and
  2.006 px per nm (true 2): the error is the mouse position, about one screen pixel at fit zoom.

### Decisions

- The limit of 4096 px for the working copy and of 150 megapixels are my own choices, not standards.
- Step 2 does not require a scale (an image with no scale bar can still be measured in pixels); step 3
  warns instead. If the pixel size is known, enter two points a known number of pixels apart.
- Ellipses have axes parallel to the image edges; rotated ellipses are not drawn yet.
- Pixels are assumed square.
- `ParticlesTool` imports `../xrd/xrd.css` and reuses `NumberInput` from the XRD module, as the
  UV-Vis and FTIR tools do.

### Known issues

- No real SEM or TEM image has been tried (none in `tests/fixtures-real/`).
- Measurements cannot be moved or edited after drawing, only deleted and redrawn.
- Metadata scale (for example the pixel size inside a TIFF) is not read.
- The viewer is 70 % of the screen height at most; on a phone a tall image leaves empty space.
- "Start over" in the wizard clears the analysis but leaves the stored image file in the browser
  until another image is loaded or it is removed in step 1.

### What I need from you

- A real SEM or TEM image (PNG, JPEG or TIFF) with its scale bar, and ImageJ numbers for a few
  particles of it, in `tests/fixtures-real/`.
- Merge pull request 18 into `main`.

### Next sub-stage

10b (particles: automatic detection), when you say so.

## Stage 9: FTIR (done)

Branch `claude/hopeful-dirac-72ak86`, stacked on 8a and 8b (pull request 18 was still not merged into
`main`). The FTIR card on the home page is enabled (`#/ftir`).

### What was built

- Core (`src/core/ftir`): import of csv, txt, dpt (read as text) and JCAMP-DX (`jcamp.ts`), data type
  suggestion, baselines (rubber band, iterative polynomial reused from XRD, asymmetric least squares
  with a banded Cholesky solver), the processing pipeline (baseline, smoothing, normalisation, always
  on absorbance), prominence peak picking with parabolic refinement, group suggestions, methods text,
  synthetic example generator.
- Wizard: 1 Upload, 2 Clean data (data type is on the cards of step 1; here view before, after, both
  or all spectra, absorbance or transmittance axis, whole range or fingerprint region, baseline,
  smoothing, normalisation, undo, reset, apply to all), 3 Pick peaks (prominence slider, search range,
  labelled plot, peak table, CSV), 4 Assign groups (ranked suggestions with a plain reason, accept,
  edit, remove, "accept the best for every peak", the whole reference table in a collapsible section),
  5 Results and export (peak table with assignments, peaks CSV, processed spectra CSV, overlay figure
  with offset, methods text, session file).
- Plot engine: a reversed x axis (`AxisLabels.reversed`) so wavenumber runs high to low. Series are
  plotted as −wavenumber; tick labels, the readout and the range boxes show the positive value; the
  exported SVG and PNG use the same code. `PlotPanel` also has a `focusRange` prop (fingerprint zoom).
- Group table `data/ftir/groups.json`, built by `npm run build:ftir` from two tables of an open-access
  review (CC BY 4.0): S. Pasieczna-Patkowska, M. Cichy, J. Flieger, Molecules 30 (2025) 684,
  doi:10.3390/molecules30030684, Table 3 (65 ranges for functional group vibrations) and Table 2
  (band positions of 13 metal oxides, including TiO2 anatase and rutile). The tables were read from
  the Europe PMC full text and cached in `data/ftir/source/tables.xml`; the JSON is generated from
  that cache and a test checks they agree. Attribution is shown in the app.
- Shared: `src/ui/persist/sessionFile.ts` (session codec) and `src/ui/SessionSection.tsx`, now used by
  UV-Vis and FTIR (XRD still has its own copy).
- `scripts/e2e.mjs` now walks UV-Vis and FTIR happy paths after the XRD one (all pass).
- Tests: `ftir-core`, `ftir-groups`, `ftirSteps`, a reversed-axis case in `plot.test.ts`.

### Known-answer results

- %T 10 gives A = 1, %T 1 gives A = 2 (and back). A generated JCAMP-DX file with a Y factor gives the
  expected x and y. Rubber band recovers a straight baseline to 0.001; asymmetric least squares
  follows a curved baseline to within 0.02 absorbance away from bands; the banded solver agrees with
  the dense solver. Peaks of a noisy synthetic spectrum are found at their true positions to a
  twentieth of the band width (at least 2 cm⁻¹); a 4 cm⁻¹ step is refined to within 0.5 cm⁻¹.

### Decisions

- The functional group source: no textbook was openable in this session. The review article above is
  openable and licensed for reuse, so every range comes from its tables. The table is flagged
  "TODO, verify" in the JSON and on screen; please check ranges against your own literature or
  Socrates' or Larkin's textbooks before using them in a paper. Metal–oxide entries are discrete
  band positions, not ranges.
- Single printed values (for example "~1660") are matched like ranges of zero width. The suggestion
  distance (default 15 cm⁻¹) is my own choice, shown as adjustable, not a published value.
- Suggestions rank by distance, then by narrower range. Nothing is assigned until the user accepts it,
  and the methods text only mentions assignments if some were accepted.
- Everything is analysed as absorbance. Transmittance is converted first and shown again as %T in
  step 2 and the final figure (not when normalised).
- ALS defaults (λ = 10^5, p = 0.01) are my own starting values. The algorithm follows the published
  description from memory and was not checked against the paper (comment in `baseline.ts`).
- JCAMP-DX: only plain-number XYDATA (X++(Y..Y)) and XYPOINTS are read; the compressed forms (SQZ,
  DIF, DUP) are refused with an export hint rather than guessed. The reader was written from the
  format as I know it and tested on generated files only, not on instrument files.
- Binary files (.spa, .spc, .sp, OPUS) are refused with an export hint. `.dpt` is treated as text.
- `UvvisTool` and `FtirTool` still import `../xrd/xrd.css` and reuse `StepSection` and `NumberInput`
  from the XRD module; these should move to `src/ui`.

### Known issues

- No real FTIR file has been tried (none in `tests/fixtures-real/`). Peak positions of broad bands
  (for example O–H near 3400 cm⁻¹) shift with noise and smoothing; the table shows the maximum.
- The assignment suggestions are position-only: no intensity, width or band-shape information.
- Plot peak labels show wavenumbers only (rounded); assignments appear in the tables.
- Spectra with unevenly spaced wavenumbers skip smoothing and the asymmetric least squares baseline,
  with a message.
- Several XRD-facing CSS rules now also serve UV-Vis and FTIR; a stylesheet split is still to do.

### What I need from you

- A real FTIR spectrum (and ideally a JCAMP-DX export from your instrument) in `tests/fixtures-real/`.
- Check the typical ranges against a textbook (see Decisions) and tell me which to correct or add.
- Merge pull request 18 (UV-Vis and FTIR) into `main`.

### Next sub-stage

10a (particles: image, scale, manual), when you say so.

## Sub-stage 8b: Tauc, Urbach, results (done)

Branch `claude/hopeful-dirac-72ak86`, stacked on 8a (pull request 18 was not merged into `main` when
this started; `main` was merged into the branch). Steps 3 and 4 of the UV-Vis wizard are now real.

### What was built

- Core (`src/core/uvvis/tauc.ts`): signal for the Tauc axis (α = ln(10)·A/t in cm⁻¹ when a film
  thickness is given, otherwise A; F(R) for reflectance), (αhν)^(1/n) for n = 1/2, 2, 3/2, 3,
  straight-line band gap fit with the uncertainty from the fit covariance (error propagation,
  formula in the doc comment), automatic region suggestion, comparison of all four transitions,
  Urbach energy (ln α against E, Eu = 1/slope, with automatic tail suggestion) and the derivative
  method (peak of dS/dE or d ln S/dE). `methods.ts` writes the methods paragraph.
- Step 3 "Band gap": transition type, optional film thickness, Tauc plot with the fit line and two
  draggable markers for the fit region (also keyboard-free touch drag via the existing plot),
  result card (Eg ± σ, edge in nm, R², region, points), plain-language warnings (few points, low R²,
  long extrapolation, no thickness, F(R) assumptions), all four transitions side by side marked
  "guide only, choose from the literature", optional Urbach energy with its own plot and markers,
  optional derivative method. Every plot has the shared SVG/PNG export panel.
- Step 4 "Results and export": results table (sample, λmax, edge, Eg ± σ, transition, R², method,
  Eu) with CSV (all fields, full precision), methods text with copy button, session file (JSON) to
  save and re-open the analysis.
- Saved state version 2 with a migration from version 1; generic session JSON codec moved to
  `src/ui/persist/sessionJson.ts` (XRD uses it too).
- Layout fixes found at 360 px: wide tables no longer widen the page (`.wizard-content > *` and
  `.clean-step > *` get `min-width: 0`, `.table-scroll` is positioned, the methods box is
  full-width).
- Tests: `tests/uvvis-tauc.test.ts`, `uvvis-analysis.test.ts`, extended `uvvisSteps.test.tsx`.

### Known-answer results

- Spectra built from a chosen Eg (3.1 eV) with the right edge shape recover Eg to 0.001 eV
  noise-free for all four transition types from absorbance, and for direct and indirect from
  diffuse reflectance (exact when the F(R) floor is 0; within 0.02 eV with the generator's default
  floor of 0.01, which bends the curve). With noise (sd 0.002 to 0.005 absorbance, 20 seeds each)
  the worst error of the automatic region was 0.0010 eV.
- The built-in example (Eg 3.2 eV, blank corrected) gives 3.200 eV (absorbance) and 3.202 eV
  (reflectance); without blank subtraction the absorbance example gives 3.175 eV, so cleaning
  matters.
- Urbach: Eu = 0.12 eV exponential tail recovered exactly; with 2 % noise within 5 %.
- Derivative: steepest point of a logistic edge at 3.2 eV found to 0.1 eV.

### Decisions

- Region suggestion: first version picked the steepest window and followed noise (errors up to
  0.1 eV over 20 seeds). It now takes the widest window (0.1 to 0.6 eV) with R² ≥ 0.995 and the
  highest R². Because the straightest window is chosen the printed ± is somewhat too small; the
  step says it is the line fit only.
- α uses exact ln(10) rather than the rounded 2.303 from the plan.
- Absorption edge in the table is hc/Eg (the wavelength with the gap energy), not a tangent
  construction.
- Derivative method searches within 0.3 eV of the Tauc fit region and reports a steepest-rise
  energy, which sits above Eg for real spectra; it is labelled a cross-check.
- Wrong transition types still produce fits (for example the direct-forbidden fit of a direct-gap
  example gives 0.9 eV with R² 0.998). The comparison is labelled a guide only for that reason.

### Known issues

- No real UV-Vis file and no Origin Tauc result have been tried (none in `tests/fixtures-real/`),
  so agreement within 0.05 eV with your own fit is untested.
- The Urbach tail has no automatic quality check beyond a warning; the example has no real tail.
- Texture of the figure: Tauc and Urbach axis labels use raised spans (not Unicode superscripts);
  check the exported SVG and PNG in your journal's workflow.
- Spectra figures (step 2) and Tauc figures (step 3) export from their own steps; step 4 only points
  to them.
- 8a items still open: Cary-style paired-column files are not read, %R reference correction needs
  your confirmation.

### What I need from you

- A real UV-Vis file and your Origin Tauc number for it, in `tests/fixtures-real/`.
- Merge pull request 18 (8a) into `main`, then this one.

### Next sub-stage

9 (FTIR), when you say so.

## Sub-stage 8a: UV-Vis import, conversions, cleaning (done)

Branch `claude/hopeful-dirac-72ak86`. The UV-Vis card on the home page is enabled (`#/uvvis`).

### What was built

- Core (`src/core/uvvis`, no UI imports): `conversions.ts` (A = 2 − log10(%T), %T = 100·10^−A,
  Kubelka–Munk F(R) = (1 − R)²/(2R), E = hc/λ), `import.ts` (wavelength in nm plus one or more
  spectrum columns; delimiter, decimal comma, headers, footers, long-to-short scans, column names),
  `kind.ts` (data type suggestion from header words or value range; checks that type and scale fit
  the values), `process.ts` (blank subtraction, baseline offset, Savitzky–Golay smoothing, display
  conversion, λmax), `synthetic.ts` (example generators with a chosen band gap).
- Constants: h, c and e are the exact 2019 SI values, read on 2026-10-24 from the NIST CODATA 2022
  pages (physics.nist.gov/cgi-bin/cuu/Value?h, ?c, ?e) and cited in `conversions.ts`. hc/e gives
  1239.84198… eV nm; the rounded 1240 is not used. Please verify (flagged in the code comment).
- Wizard (`src/modules/uvvis`): 1 Upload, 2 Data type and cleaning, 3 Band gap (placeholder),
  4 Results and export (placeholder). Upload: drop, pick, paste, "Try with example data" (three
  synthetic spectra labelled not real: an absorbance sample with a solvent baseline, the blank, and a
  diffuse reflectance sample; made-up band gap 3.2 eV). Each spectrum card shows the data type
  (absorbance, %T, %R; percent or fraction), with the reason it was chosen, and the user can change it.
  Step 2: view as measured / absorbance / %T / %R / F(R), x axis nm or eV, before/after of one
  spectrum or all spectra overlaid, blank subtraction, baseline offset, smoothing, undo, reset, "use
  for all", and a λmax table (search range, CSV).
- Persisted store key `uvvis-session`, version 1 (no older versions, so no migration yet).
- Refactor: delimiter detection moved from the XRD parser to `src/core/text/delimitedTable.ts`, and
  byte decoding to `src/core/text/bytes.ts`, so both tools share them. XRD tests unchanged and green.
- Tests: `tests/uvvis-conversions.test.ts`, `uvvis-import.test.ts`, `uvvis-process.test.ts`
  (known answers: %T 10 → A 1, K-M(0.5) = 0.25, blank subtraction recovers the true curve, a
  transmittance blank equals T/T_blank, smoothing lowers noise), `uvvisSteps.test.tsx`
  (components), home test updated.

### Decisions

- Blank and offset work on −log10(value). For absorbance that is plain subtraction. For %T it equals
  dividing by the blank. For %R I used the same ratio (sample relative to a reference); please confirm
  this matches how you correct diffuse reflectance.
- λmax is the highest data point (no curve fit) of A, or of F(R) for reflectance; the table says so.
  Ends of a scan can win because of detector noise; the range boxes handle that. The synthetic
  edge-shaped examples have their maximum at the short-wavelength end by construction.
- UV-Vis files are parsed on the main thread (small files, limit 10 MB); the XRD reader uses a worker.
- `UvvisTool` imports `../xrd/xrd.css` and reuses `StepSection` and `NumberInput` from the XRD
  module. These should move to `src/ui` at some point (known issue).
- Wavelength must be nm: a first column ending below 20 is refused (probably eV or µm); above 3300 nm
  gives a warning (probably wavenumber).

### Known issues

- Agilent Cary files with a wavelength column per sample (pairs of columns) are read as one wavelength
  column plus the rest, which is wrong for them; no real file was available to test. Only text
  exports with a shared wavelength column are supported.
- No real UV-Vis file has been tried (none in `tests/fixtures-real/`).
- Steps 3 and 4 are placeholders until 8b; the session cannot be exported yet.

### What I need from you

- A real UV-Vis file (absorbance and, if possible, a diffuse reflectance one) in `tests/fixtures-real/`.
- Confirmation of the reflectance reference correction above.

### Next sub-stage

8b (Tauc, Urbach, results), when you say so.

## Sub-stage 7b: figure builder, methods text, export, full flow (done)

Branch `claude/ecstatic-einstein-mofaev`.

### What was built

- Step 8 "Export" (`src/modules/xrd/ExportStep.tsx`), replacing the placeholder:
  - Figure: all patterns in one plot with the existing normalise and offset options, journal width
    presets (85 and 180 mm), Arial or Times, font size, line width, inward ticks, 2θ (italic θ, degrees)
    and Intensity (a.u.) axis titles, SVG and PNG at 300 and 600 dpi (the existing export panel).
    New: reference stick lanes (one per chosen phase, named "phase, COD id") and (hkl) peak labels
    are printed in the exported figure (`src/ui/plot/LanesSvg.tsx`, `renderSvgString(..., lanes)`,
    `src/modules/xrd/figure.ts`). Lines with no fitted peak are thinner and lighter.
  - Methods text (`src/core/xrd/report/methods.ts`, `src/modules/xrd/methodsText.ts`): one paragraph
    written only from the saved settings (radiation and wavelengths, scan and step, zero shift,
    smoothing, background, Kα2 stripping, normalisation, profile function, instrument correction and
    standard, K, methods that produced a size, reference phases with COD IDs, matching tolerance,
    software). Steps not used are left out. Example data produce a sentence saying they are not a
    measurement. Copy button.
  - Tables (`src/modules/xrd/tables.ts`): pure builders now shared by the step components and the
    Export step: fitted peaks, assigned peaks, peaks used for size and strain, size and strain
    summary, per pattern. Export offers one CSV per table and all tables in one CSV (`## name` line
    before each). `src/modules/xrd/csv.ts` has `makeTable`, `downloadTable`.
  - Session file (`src/modules/xrd/session.ts`): versioned JSON (`app`, `kind`, `version`, `state`);
    Float64Arrays and non-finite numbers are tagged so they survive JSON; import migrates older
    versions with `migrateXrdData` and refuses foreign, damaged or newer files with a plain message.
    Importing replaces the current analysis.
- Wizard order is unchanged and already matched CLAUDE.md; "Try with example data" now runs from
  step 1 to step 8.
- End-to-end test `scripts/e2e.mjs` (`npm run e2e`, after `npm run build`): starts `vite preview`,
  drives Chromium through example data, all eight steps, the SVG, PNG, combined CSV and session
  downloads, a session round trip (state cleared, example walked, session imported, exported again,
  data compared with `deepEqual`) and a refusal of a foreign JSON file. Playwright is not a project
  dependency (no new dependency was added); the script finds a global install
  (`/opt/node-tools/node_modules` or `PLAYWRIGHT_PATH`; `CHROMIUM_PATH` for the browser binary).
- Tests: `tests/report.test.ts` (methods text, session round trip, migration, refusals),
  `tests/tables.test.ts` (tables, combined CSV, lanes), lanes case in `tests/plot.test.ts`.

### Decisions

- Lanes are drawn in a panel under the plot (same 2θ range and margins) rather than inside it, so
  the sticks never hide data.
- Hkl labels and lanes come from the first pattern that has fitted peaks and a chosen phase; the
  step says which pattern. The methods text describes the first pattern's processing and fit
  settings and does not say how many patterns were analysed.
- The session file stores the whole wizard state; on import only the data are restored and the user
  stays on the Export step.

### Known issues

- Texture, crystallinity and the per-method line-fit tables are still downloaded from their own
  sections in step 7; they are not in the Export step's list.
- The software version is not recorded in the methods text ("version not recorded").
- The e2e script is not run in CI (it needs a browser and a global Playwright); run it locally.
- Example data are synthetic with arbitrary peak positions, so the e2e flow with ZnO assigns few
  peaks; it checks the plumbing, not the science. No real measured file has been tried in the
  Export step.

### What I need from you

- Try a real measured file through all eight steps, and check the figure against your journal's
  guidelines (fonts, widths, line widths).
- No citation for COD is in the repository and none was added from memory. If your journal wants a
  COD citation in the methods text, give me the reference to use.
- Say whether CI should run the e2e test (that would add Playwright as a dev dependency).

### Next sub-stage

8a, when you say so.

## Sub-stage 6a-fix: library screening and 7a corrections (done)

Branch `claude/ecstatic-einstein-mofaev`.

### What was built

- `scripts/build-reference-library.ts`: COD entries are rejected when the title, COD record or CIF
  notes mention high pressure, compression, kbar, GPa, diamond anvil, low or high temperature,
  solid solution or doped (also the German "feste Lösung"), or give `T = x` outside 283 to 305 K.
  Entries whose sorted cell lengths differ by more than 0.3 % from the per-axis median of all usable
  candidates are rejected (only with at least 3 candidates). `--explain=<phase id>` prints why each
  candidate was kept or dropped. Partial occupancy is allowed only for maghemite and gamma-Al2O3
  (`partialOccupancy` in `scripts/reference-phases.ts`). Rhombohedral phases (hematite, corundum,
  calcite) take the hexagonal-axes setting (`hexagonalAxes`). Library rebuilt with `--refresh`: 35
  phases, 0 skipped; an offline rebuild gives identical files.
- `scripts/crosscheck-refs.py`: second cross-check against Waasmaier-Kirfel factors (`xraydb`). It
  decides the exit status; the pymatgen columns are informational. All 35 phases pass; SnO2 differs
  from pymatgen only because pymatgen uses another scattering parametrisation (WK: 0.02 points).
- `src/core/xrd/radiation.ts`: Mo Ka2 = 0.713607 A; Mo and Ag cite NIST (Deslattes et al., Rev. Mod.
  Phys. 75, 35 (2003)); "unverified" removed.
- Texture: default basis is now area. A strong reference line without a fitted peak is flagged when
  the data rise at least 3 times the local noise there (`src/core/xrd/analysis/signal.ts`).
- Crystallinity: anchors use the minimum in their window; the hump is clipped to the data (a 0.25
  degree moving mean, so noise does not bias it); a warning appears when background removal is on.

### Library changes (old COD ID -> new, cell in angstrom)

- Ag 1509146 (4.0710) -> 9008459 (4.0862); Au 9013035 (4.0720) -> 9008463 (4.0782)
- Aragonite 9014355 (4.9653 8.0088 5.7847) -> 9013799 (4.9606 7.9701 5.7418)
- BaTiO3 tetragonal 1513252 (c 4.0412) -> 1559964 (c 4.0230)
- Brookite 9004137 -> 9009087 (9.1840 5.4470 5.1450); Rutile 9004141 -> 9007531 (4.5941 / 2.9589)
- Calcite 9014415 (4.9748 / 17.2700) -> 9015390 (4.9903 / 17.0687, hexagonal axes)
- CdS hexagonal 9011663 (4.1370 / 6.7144) -> 9008862 (4.1348 / 6.7490)
- CeO2 4343161 (5.4097) -> 9009008 (5.4110); Cu 4105681 (3.6154) -> 7101264 (3.6170)
- Corundum 5000092 -> 1000032 (4.7605 / 12.9956)
- Hematite 5910082 (5.0079 / 13.6467) -> 9000139 (5.0380 / 13.7720)
- Magnetite 7228110 (8.3600) -> 9013529 (8.3967); Ni 2100637 (3.5451) -> 4320486 (3.5229)
- NiO 9008693 (4.1684) -> 4329323 (4.1786)
- WO3 1563541 (5.2610 5.1280 7.6500) -> 2106382 (P 1 21/n 1, 7.3060 7.5400 7.6920)
- ZnO 2300116 (3.1950 / 5.1027, a diamond-anvil entry) -> 1577381 (3.2510 / 5.2090)
- ZnS sphalerite 1539414 (5.4750) -> 9000107 (5.4093)
- New: maghemite 1528611 (8.4053), gamma-Al2O3 1200015 (7.9060)

### Tests

- Texture/crystallinity tests updated (anchor index within 5 %, trough clipping, minimum anchors,
  signal at an expected position, unfitted lines flagged and absent lines not flagged).
- `tests/reference-library.test.ts`: 35 phases, maghemite and gamma-Al2O3 present, ZnO strongest
  line positions.

### Decisions and known issues (please check)

- CdS hexagonal: with only 3 candidates the literal 0.3 % median rule dropped 9011663 and moved to a
  worse entry (c = 6.7490).
- Maghemite 1528611 has a = 8.4053, which looks magnetite-like; the other candidate (9006316) has
  8.33. With 2 candidates the rule cannot decide. Please verify against a source you trust.
- Several chosen entries come from papers about other materials (Ni, NiO, Pt, Si, LaB6). Cells look
  plausible; please check.
- Clipping uses a moving mean, not the raw point (a literal point clip biases the hump with noise).
  The unfitted-signal threshold (3 times noise on a 3-point mean) is my own heuristic.
- Saved-state version is unchanged (8); older sessions keep their saved texture basis.

### Next

Sub-stage 7b (figure builder, methods text, export, e2e) when you say so.

## Sub-stage 7a: texture, crystallinity, pattern character (done)

Branch `claude/ecstatic-einstein-mofaev`. Added to the Results step (wizard step 7), below the
(hkl) and lattice section.

### What was built

- `src/core/xrd/analysis/texture.ts`: Harris texture coefficient TC = (I/I0) / mean(I/I0), with the
  equation and units in the doc comment. Refuses for fewer than two reflections, a zero reference
  or no observed intensity.
- `src/core/xrd/analysis/crystallinity.ts`: crystallinity index = crystalline area / total area
  x 100 over a chosen 2theta range. The amorphous hump is a Gaussian (centre and FWHM given, height
  fitted by least squares to the points more than 6 FWHM from a fitted peak) or straight lines
  through the pattern level at typed anchor positions. Plain refusals for a narrow range, too few
  points or anchors, or a hump as large as the pattern.
- `src/core/xrd/analysis/character.ts`: rule-based hints (orientation, random powder, broad peaks,
  large amorphous share). Each has a reason and the words "Estimate only; a powder pattern cannot
  prove single-crystal or layered structure."
- `src/core/xrd/reference/hkl.ts`: `formatHkl` moved here from the module so core can use it.
- `src/modules/xrd/extraAnalysis.ts` and `ExtraAnalysisSection.tsx`: texture table (height or area,
  CSV), crystallinity block (range, hump choice, plot with the dashed hump, CSV, figure export),
  hint list, and a summary table (lattice parameters, cell volume, TC, crystallinity) with CSV.
- `NumberInput` moved out of `ResultsStep.tsx` so both files share it.
- Saved state is version 8 (`analysis` settings). Version 7 sessions migrate and keep their
  material choice.

### Tests

- `tests/xrd-analysis.test.ts`: TC worked example (ratios 10, 1, 1, 1 give 10/3.25 and 1/3.25),
  00l x10 gives TC(00l) > 1, missing reflection gives TC 0, refusals; crystallinity recovered
  within 2 % (Gaussian hump, noise-free and with noise) and within 8 % (anchors); hint rules.
- `tests/extraAnalysis.test.ts`: synthetic ZnO patterns built from the library lines and fitted:
  random pattern gives TC near 1 and the random hint; 00l x10 gives TC(00l) > 1 and the others
  < 1; only 00l lines trigger the orientation hint with its reason.

### Decisions and known issues

- **Thresholds are my own rules of thumb, not published values; please check them** (all named
  constants in `character.ts`): strong line = 10 % of the strongest, orientation needs 2 missing
  strong lines of other families, random needs 80 % of strong lines and TC in 0.5 to 1.5 for at
  least 4 peaks, broad = median FWHM at or above 1 degree, amorphous = index below 50 %.
- Reflections inside the scanned range with no assigned peak count as intensity 0. If you fit only
  some of the visible peaks, TC and the hints are distorted; the screen says to fit every peak.
- The anchor hump overestimates the hump a little, because each anchor also reads the long tails
  of the peaks (test: index about 6 % too low relative). The Gaussian option avoids the points near
  peaks and is within 2 %.
- A background you do not remove counts as amorphous. The screen says so.
- **ZnO library entry to verify:** `zno-wurtzite` is COD 2300116 with a = 3.195 and c = 5.1027 A.
  From memory, bulk ZnO is about a = 3.25 and c = 5.21 A, so this entry has a noticeably smaller
  cell and its peaks sit about 0.6 degrees higher in 2theta than I expected. I did not check COD in
  this sub-stage and the library is unchanged. Please check the entry; the 6a selection rule may
  have picked an unusual structure.
- Open from earlier: SnO2 cross-check deviation, skipped phases, COD selection rule, Si and LaB6
  entries, unverified Mo and Ag wavelengths, figure export lacks stick lanes (7b).

### Verification

- `npm run lint`: pass. `npm run typecheck`: pass.
- `npm test`: 271 passed, 1 skipped (the real-file test, waiting for your file).
- `npm run build`: pass. `npm run size`: within budget.
- Headless Chromium at 360 and 1280 px, synthetic anatase scan: texture table (all TC 0.93 to
  1.06), crystallinity on and off, anchors, reload keeps the setting, random-powder hint, summary
  table; no horizontal scroll, no console errors.

### You check

With your real file: fit all visible peaks, then read the TC values and the hint. For a film or
oriented sample the strong plane should have TC well above 1. For crystallinity, look at the dashed
hump: it should follow the broad bulge under the peaks.

### Next

Sub-stage 7b (figure builder, methods text, export, end-to-end test).

## Sub-stage 6c: hkl labels, combined table and lattice refinement (done)

Branch `claude/ecstatic-einstein-mofaev`. Added to the Results step (wizard step 7).

### What was built

- `src/core/xrd/reference/assign.ts`: assigns each fitted peak to the nearest reference line of the
  chosen phases within the tolerance, after the phase's zero shift. Unmatched peaks are
  "unassigned". Lines at least 10 % as strong as the nearest one (`OVERLAP_FRACTION`) that are also
  within tolerance are kept as overlaps and shown as (004)/(112) with a note.
- `src/core/xrd/reference/lattice.ts`: weighted least squares on 1/d² for cubic (a), tetragonal
  (a, c), hexagonal and trigonal (a, c; the library's trigonal cells all use hexagonal axes) and
  orthorhombic (a, b, c), with an optional zero shift, standard uncertainties, cell volume and
  a refusal with a plain reason when there are too few independent peaks. Monoclinic and triclinic
  are not refined (stated in the interface).
- `src/ui/plot/peakLabels.ts`: greedy non-overlapping label placement (strongest first, stacked
  rows, leader lines when raised). The strongest peak is bold. Exports add the key
  "Name, COD id" in the plot.
- `src/modules/xrd/AssignmentSection.tsx`: labelled plot, "Assigned peaks" table (phase, COD ID,
  JCPDS number labelled "entered by user, not verified", hkl, 2θ obs/ref, Δ2θ, d obs/ref, I/I0
  obs/ref, FWHM) with CSV, and a lattice card per phase (refined against library cell, % difference,
  volume, zero shift, degrees of freedom, RMS residual). Checkbox to refine a zero shift as well.
- hkl is passed to the Results step peak table and its CSV.

### Tests

- `tests/reference-assign.test.ts`: formulas, volumes, exact recovery, refusal cases, and strained
  (+0.3 %) noisy synthetic scans of Si, anatase, ZnO and brookite: cell recovered within 3σ and the
  correct hkl for every peak.
- `tests/assignment.test.ts`, `tests/plot.test.ts`: assignment on a fitted anatase pattern, label
  placement and labelled SVG export.

### Decisions and known issues

- Covariance is scaled by max(1, χ²/dof) when peak uncertainties are known, else by χ²/dof.
  Uncertainties are statistical only and say so on screen.
- Without refining a zero shift the cell absorbs any residual shift: in the browser run on a
  synthetic anatase scan the cell came out +0.17 % (a) from a −0.07° shift. Refining the shift
  removes this; the checkbox is there for that case.
- Open from earlier: SnO2 cross-check deviation, skipped phases, COD selection rule, Si and LaB6
  entries to check against your certificate, unverified Mo and Ag wavelengths.

### Verification

- `npm run lint`: pass. `npm run typecheck`: pass.
- `npm test`: 249 passed, 1 skipped (the real-file test, waiting for your file).
- `npm run build`: pass. `npm run size`: within budget.
- Headless Chromium at 360 and 1280 px, synthetic anatase scan through the full wizard: 11 peaks
  assigned with labels (101) to (215), no horizontal scroll, no console errors.

### You check

Load your real file, choose the phase, and in Results check the hkl labels and the lattice cell
against your own expectation.

### Next

Sub-stage 7a (see the tracker).

## Sub-stage 6b: choose material and compare phases (done)

Branch `claude/ecstatic-einstein-mofaev`. Wizard steps 3 and 4, using `data/reference` from 6a.

### What was built

- **Core (`src/core/xrd/reference/match.ts`, doc comments with equations):**
  - `referenceLines`: 2θ from d by Bragg's law for the selected anode's Kα1, and relative
    intensities recomputed from the stored Σ|F|² with the Lorentz-polarisation factor (for Cu they
    equal the stored values, tested).
  - `searchFamilies`: search by name, alias, formula or phase name, ignoring case, spaces and
    hyphens ("titania", "TiO2", "tio 2", "anatase" all find titanium dioxide).
  - `matchPhase`: the score from the plan: intensity-weighted fraction of the reference lines
    stronger than 5 % that have a detected peak within the tolerance (default 0.15°), after the
    best single zero shift from −0.3° to +0.3° in 0.01° steps. Lines outside the measured range
    (shrunk by 0.3° at both ends) are not scored. Ties go to the shift with the smaller mean
    distance, then the smaller |shift|.
- **Step 3, Choose material (`MaterialStep.tsx`):** searchable list of 25 material families; after
  a choice, its phases with crystal system, space group and a link to the COD entry; tick the
  phases you want to use; optional "JCPDS/ICDD card number (typed by you, not verified)" per ticked
  phase; "I don't know" ranks every family by the score of its best phase against your detected
  peaks (guide only, top eight). The step never blocks Next.
- **Step 4, Compare reference phases (`PhasesStep.tsx`):** the cleaned pattern with the detected
  peaks (circles) and one stick lane per phase under it (`ReferenceLanes.tsx`, same 2θ range, zoom
  and pan as the plot). Found lines are solid, unmatched lines dashed and faint. One card per phase
  with the score bar, zero shift used, a toggle for the lane, "Use this phase", and a table of
  matched and unmatched lines (hkl, shifted reference 2θ, d, I, measured 2θ). The tolerance is
  adjustable. The text "A guide only. Works for simple, well-separated phases; not reliable for
  mixtures." is shown on the step.
- **Library loading:** `referenceLibrary.ts` loads `index.json` and one JSON file per family on
  demand (Vite lazy chunks). Nothing is added to the app shell: initial JS is unchanged at 8.18 kB
  gzipped (limit 150 kB).
- **Saved sessions:** version 7 adds `material` (family, chosen phases, hidden lanes, JCPDS text,
  tolerance). Sessions of versions 2 to 6 are migrated, and a v6 session keeps its size and strain
  settings (the old migration reset them; tested).

### Tests

- `tests/reference-match.test.ts`: exact-position known answers for the score and the shift;
  patterns built from the library itself (Cu Kα1, 0.15° wide lines, counting noise, peaks found by
  the app's detector): anatase with a 0.05° shift scores highest of anatase, rutile and brookite and
  the shift comes back as 0.02° to 0.08°; a 50/50 anatase + rutile mixture scores both above 0.5.
- `tests/materialStep.test.tsx` (search, phases, JCPDS field, switching family) and the v6 migration
  test in `tests/fitSupport.test.ts`.
- By hand in Chromium at 360 and 1280 px wide with a generated anatase pattern (0.05° shift, noise):
  anatase 100 % with shift +0.05°, rutile 25 %, brookite 33 %; "I don't know" ranks titanium dioxide
  first; no horizontal page scroll; no console errors.

### Decisions and known issues

- The match uses peaks detected on the cleaned pattern with the detection settings of step 5
  (default 3 % prominence), not the fitted peaks, because fitting comes after this step.
- Chance matches are real: a phase with few strong lines can score 50 % or more against a pattern
  of another phase (nickel oxide scored 57 % on the anatase test pattern). That is why every score
  is labelled a guide. Check the lanes and the line table before choosing a phase.
- The exported figure does not yet include the reference sticks (stage 7b: figure builder).
- The zero shift found here is shown but not applied to anything yet; stage 6c uses it to assign
  hkl to fitted peaks.
- The chosen phases are saved, but nothing downstream reads them until 6c.

### Verification

- `npm run lint`: pass. `npm run typecheck`: pass.
- `npm test`: 223 passed, 1 skipped (the real-file test, waiting for your file).
- `npm run build`: pass. `npm run size`: within budget.

### You check

Load your real TiO2 or ZnO file, choose the material in step 3, and in step 4 the correct phase
should score highest with its sticks lining up with your peaks.

### Next

Sub-stage 6c: hkl labels, combined table and lattice refinement.

## Sub-stage 6a: reference library build (done, one cross-check failure and two skipped phases)

Branch `claude/ecstatic-einstein-mofaev`. Data and build scripts only, no UI.

### What was built

- **Library:** `data/reference/` holds one JSON file per material family (`tio2.json`, …),
  `index.json` (family names, aliases and formulas for search, phases with COD IDs) and
  `scattering-factors.json`. 33 phases in 25 families, 196 KB in total. Nothing imports it yet,
  so the app bundle is unchanged (stage 6b lazy-loads it).
- **Each peak** stores d (Å), multiplicity, Σ|F|² (`mf2`), the relative intensity for Cu Kα1
  (strongest = 100) and one (hkl) per symmetry-distinct family in the line. The app recomputes
  intensities for another anode from `mf2` with the Lorentz-polarisation factor. Each phase also
  stores the COD ID, space group (Hermann–Mauguin and number), crystal system, cell, and the
  journal reference taken from the CIF.
- **Code (`src/core/xrd/reference/`, pure TypeScript, doc comments with equations and units):**
  `cif.ts` (CIF reader), `symmetry.ts` (operators, systematic absences, reflection families),
  `powder.ts` (structure factor with isotropic or anisotropic displacement parameters,
  Lorentz-polarisation factor for a Bragg–Brentano diffractometer without monochromator,
  grouping of reflections into powder lines), `types.ts` (JSON shapes).
- **Build script:** `npm run build:refs` (`scripts/build-reference-library.ts`, phases listed in
  `scripts/reference-phases.ts`). It searches COD by elements, filters, downloads and checks each
  CIF, picks one entry per phase, and writes the JSON. The CIFs of the chosen entries and the
  choice itself are kept in `scripts/cif-cache/`, so a rebuild without `--refresh` works offline
  and gives byte-identical files (checked). `--refresh` searches COD again. The script needs
  Node 22.18 or later and sets `NODE_USE_ENV_PROXY=1` so that it works behind the session proxy.
- **Cross-check:** `scripts/crosscheck-refs.py` recomputes every pattern with pymatgen's
  `XRDCalculator` from the same CIFs and compares the 10 strongest lines (2θ within 0.01°,
  intensity within 5 points).
- **Tests:** `tests/reference-powder.test.ts` (known answers, below) and
  `tests/reference-library.test.ts` (checks on the generated files). 28 new tests.

### How a COD entry is chosen

For every phase the script asks COD for all entries with exactly the phase's elements and keeps
those that pass all of these:

1. reduced formula equals the requested one;
2. the space-group number (and, for named minerals, the mineral name) match the request;
3. not retracted, on hold or a duplicate; cell and diffraction temperature 283–305 K or not
   stated; pressure at most 120 kPa or not stated;
4. the CIF has symmetry operators and coordinates, all occupancies equal 1, and the atoms in the
   cell computed from the symmetry operators equal COD's own cell formula;
5. every displacement parameter U is between 0 and 0.06 Å² (a sanity filter I added after the
   first attempt picked a nanocrystalline silicon entry with U = 0.32 Å²).

Of the entries that pass, the one with the lowest R factor listed by COD is used. Most entries have
no R factor in COD; then entries with displacement parameters come before entries without, and the
newest comes first. **That second rule is arbitrary, so please look at the "no R listed" rows.**

### Chosen entries

| Phase             | COD ID                                                      | Space group         | Year | R factor (from COD)                     |
| ----------------- | ----------------------------------------------------------- | ------------------- | ---- | --------------------------------------- |
| anatase           | [9015929](https://www.crystallography.net/cod/9015929.html) | I 41/a m d :1 (141) | 1991 | no R listed                             |
| rutile            | [9004141](https://www.crystallography.net/cod/9004141.html) | P 42/m n m (136)    | 1979 | no R listed                             |
| brookite          | [9004137](https://www.crystallography.net/cod/9004137.html) | P b c a (61)        | 1979 | no R listed                             |
| zno-wurtzite      | [2300116](https://www.crystallography.net/cod/2300116.html) | P 63 m c (186)      | 2006 | R = 0.014                               |
| magnetite         | [7228110](https://www.crystallography.net/cod/7228110.html) | F d -3 m :1 (227)   | 2013 | no R listed                             |
| hematite          | [5910082](https://www.crystallography.net/cod/5910082.html) | R -3 c :H (167)     | 1980 | R = 0.026                               |
| tenorite          | [7212242](https://www.crystallography.net/cod/7212242.html) | C 1 2/c 1 (15)      | 2010 | R = 0.032                               |
| cuprite           | [9007497](https://www.crystallography.net/cod/9007497.html) | P n -3 m :1 (224)   | 1990 | no R listed                             |
| nio               | [9008693](https://www.crystallography.net/cod/9008693.html) | F m -3 m (225)      | 1963 | no R listed; no displacement parameters |
| co3o4             | [1538531](https://www.crystallography.net/cod/1538531.html) | F d -3 m :1 (227)   | 1964 | no R listed                             |
| ceo2              | [4343161](https://www.crystallography.net/cod/4343161.html) | F m -3 m (225)      | 2015 | no R listed                             |
| sno2              | [1000062](https://www.crystallography.net/cod/1000062.html) | P 42/m n m (136)    | 1971 | R = 0.036                               |
| wo3-monoclinic    | [1563541](https://www.crystallography.net/cod/1563541.html) | P 1 21/c 1 (14)     | 2010 | no R listed                             |
| corundum          | [5000092](https://www.crystallography.net/cod/5000092.html) | R -3 c :H (167)     | 1978 | R = 0.03                                |
| alpha-quartz      | [5000035](https://www.crystallography.net/cod/5000035.html) | P 32 2 1 (154)      | 1988 | R = 0.022                               |
| cds-hexagonal     | [9011663](https://www.crystallography.net/cod/9011663.html) | P 63 m c (186)      | 1993 | no R listed; no displacement parameters |
| cds-cubic         | [9000108](https://www.crystallography.net/cod/9000108.html) | F -4 3 m (216)      | 1961 | no R listed; no displacement parameters |
| zns-sphalerite    | [1539414](https://www.crystallography.net/cod/1539414.html) | F -4 3 m (216)      | 1969 | no R listed                             |
| zns-wurtzite      | [1100044](https://www.crystallography.net/cod/1100044.html) | P 63 m c (186)      | 1989 | R = 0.0575                              |
| batio3-tetragonal | [1513252](https://www.crystallography.net/cod/1513252.html) | P 4 m m (99)        | 2009 | R = 0.0524                              |
| batio3-cubic      | [1571502](https://www.crystallography.net/cod/1571502.html) | P m -3 m (221)      | 2024 | no R listed                             |
| srtio3            | [1577245](https://www.crystallography.net/cod/1577245.html) | P m -3 m (221)      | 2026 | no R listed                             |
| calcite           | [9014415](https://www.crystallography.net/cod/9014415.html) | R -3 c :H (167)     | 2010 | no R listed                             |
| aragonite         | [9014355](https://www.crystallography.net/cod/9014355.html) | P m c n (62)        | 2010 | no R listed                             |
| mos2-2h           | [1531960](https://www.crystallography.net/cod/1531960.html) | P 63/m m c (194)    | 2002 | no R listed                             |
| graphite          | [9011577](https://www.crystallography.net/cod/9011577.html) | P 63/m m c (194)    | 1975 | no R listed                             |
| si                | [2104737](https://www.crystallography.net/cod/2104737.html) | F d -3 m (227)      | 2010 | no R listed                             |
| lab6              | [2104736](https://www.crystallography.net/cod/2104736.html) | P m -3 m (221)      | 2010 | no R listed                             |
| au                | [9013035](https://www.crystallography.net/cod/9013035.html) | F m -3 m (225)      | 1988 | no R listed; no displacement parameters |
| ag                | [1509146](https://www.crystallography.net/cod/1509146.html) | F m -3 m (225)      | 1954 | no R listed                             |
| cu                | [4105681](https://www.crystallography.net/cod/4105681.html) | F m -3 m (225)      | 2011 | no R listed                             |
| pt                | [4334349](https://www.crystallography.net/cod/4334349.html) | F m -3 m (225)      | 2013 | R = 0.01834                             |
| ni                | [2100637](https://www.crystallography.net/cod/2100637.html) | F m -3 m (225)      | 2006 | no R listed                             |

Both checks you named hold. The strongest anatase line is (101) at 25.30° 2θ and the strongest
rutile line is (110) at 27.44° 2θ for Cu Kα1 (also pinned in `tests/reference-library.test.ts`).

### Independent cross-check against pymatgen (Cu Kα1, d ≥ 0.8 Å)

| Phase             | COD ID  | Largest 2θ difference (°) | Largest intensity difference (points) | Result   |
| ----------------- | ------- | ------------------------- | ------------------------------------- | -------- |
| anatase           | 9015929 | 0.0006                    | 0.73                                  | pass     |
| rutile            | 9004141 | 0.0015                    | 1.32                                  | pass     |
| brookite          | 9004137 | 0.0002                    | 0.57                                  | pass     |
| zno-wurtzite      | 2300116 | 0.0005                    | 0.22                                  | pass     |
| magnetite         | 7228110 | 0.0009                    | 0.62                                  | pass     |
| hematite          | 5910082 | 0.0013                    | 0.31                                  | pass     |
| tenorite          | 7212242 | 0.0001                    | 0.88                                  | pass     |
| cuprite           | 9007497 | 0.0012                    | 0.17                                  | pass     |
| nio               | 9008693 | 0.0006                    | 0.93                                  | pass     |
| co3o4             | 1538531 | 0.0007                    | 0.47                                  | pass     |
| ceo2              | 4343161 | 0.0017                    | 0.47                                  | pass     |
| sno2              | 1000062 | 0.0024                    | 5.77                                  | **FAIL** |
| wo3-monoclinic    | 1563541 | 0.0000                    | 0.58                                  | pass     |
| corundum          | 5000092 | 0.0013                    | 1.50                                  | pass     |
| alpha-quartz      | 5000035 | 0.0002                    | 0.06                                  | pass     |
| cds-hexagonal     | 9011663 | 0.0003                    | 0.11                                  | pass     |
| cds-cubic         | 9000108 | 0.0013                    | 0.14                                  | pass     |
| zns-sphalerite    | 1539414 | 0.0009                    | 0.23                                  | pass     |
| zns-wurtzite      | 1100044 | 0.0014                    | 0.37                                  | pass     |
| batio3-tetragonal | 1513252 | 0.0019                    | 1.00                                  | pass     |
| batio3-cubic      | 1571502 | 0.0014                    | 0.66                                  | pass     |
| srtio3            | 1577245 | 0.0006                    | 0.15                                  | pass     |
| calcite           | 9014415 | 0.0001                    | 0.12                                  | pass     |
| aragonite         | 9014355 | 0.0001                    | 0.47                                  | pass     |
| mos2-2h           | 1531960 | 0.0004                    | 0.30                                  | pass     |
| graphite          | 9011577 | 0.0016                    | 1.19                                  | pass     |
| si                | 2104737 | 0.0013                    | 0.47                                  | pass     |
| lab6              | 2104736 | 0.0018                    | 1.54                                  | pass     |
| au                | 9013035 | 0.0012                    | 0.19                                  | pass     |
| ag                | 1509146 | 0.0007                    | 0.16                                  | pass     |
| cu                | 4105681 | 0.0017                    | 0.38                                  | pass     |
| pt                | 4334349 | 0.0021                    | 0.72                                  | pass     |
| ni                | 2100637 | 0.0011                    | 0.25                                  | pass     |

**One failure: SnO2 (5.77 points, limit 5).** The cause is the scattering factors, not the
geometry. pymatgen computes X-ray scattering factors from electron-scattering parameters
(Z − 41.78214 s² Σ aᵢ exp(−bᵢ s²), s = sin θ/λ). For oxygen this agrees with the International
Tables values used here to 0.1 %, but for tin it is 2.5 % higher at s = 0.2 Å⁻¹, 5.4 % at 0.3 and
13 % at 0.5 Å⁻¹. Tin is the heaviest element that is a strong scatterer in this list, so SnO2
lines at higher angle differ the most. I did not change the tolerance or the table. Decide
whether this is acceptable. The other 32 phases pass, with at most 0.0024° and 1.5 points
difference.

Notes on the check: lines closer than 0.005° are summed in both patterns before comparing;
pymatgen only accepts one displacement value per element, so I gave it the mean of each
element's values (for anisotropic atoms the mean of U11, U22, U33). The library itself uses the
full anisotropic values.

### Data sources

- **Structures:** Crystallography Open Database, https://www.crystallography.net/cod/ (CIF files in
  `scripts/cif-cache/`; each file keeps its own header with the original authors).
- **Scattering factors:** International Tables for Crystallography Vol. C (1992), Table of
  four-Gaussian coefficients, as listed in the gemmi source file
  `include/gemmi/it92.hpp` (https://raw.githubusercontent.com/project-gemmi/gemmi/master/include/gemmi/it92.hpp),
  downloaded and parsed by the build script (not typed by hand), 98 neutral atoms H to Cf.
  I could not open the original book table, so the numbers are as published by gemmi.
- **Wavelength:** Cu Kα1 = 1.5405929 Å from `radiation.ts` (Hölzer et al. 1997, already checked).

### Decisions and limits

- Kinematic model only: anomalous dispersion (f′, f″), absorption, preferred orientation,
  extinction and instrument broadening are not modelled. Relative intensities are guides.
- Neutral-atom scattering factors are used for every site, even if the CIF gives ions.
- Reflections with d ≥ 0.8 Å and relative intensity ≥ 0.05 are stored.
- Reflections from different symmetry families with the same d are one line, with several (hkl).
- The space-group numbers and mineral names in `scripts/reference-phases.ts` are search filters
  typed by me; the library stores what COD reports for the chosen entry. Please check the names
  and space groups in the table above against what you know.
- The crystal system is derived from the COD space-group number with the ranges of the
  International Tables.

### Skipped phases (no usable COD entry)

- **γ-Fe2O3 (maghemite):** the only entries named maghemite have partial occupancy (vacancies),
  and the rule is "fully occupied".
- **γ-Al2O3:** no entry with the requested formula and space group (Fd-3m) passed the filters.

### Known issues and for you to verify

- SnO2 cross-check difference (above).
- The "no R listed" choices (arbitrary newest-first rule) for 24 phases, especially the line
  position standards **Si (COD 2104737) and LaB6 (COD 2104736)**: please compare their cell
  parameters with the certificate of your standard before using them for instrument correction.
- Hematite uses the rhombohedral setting (R-3c, hexagonal axes); labels will follow that setting.
- Mo and Ag wavelengths are still unverified (see the earlier section).

### Verification

- `npm run lint`: pass. `npm run typecheck`: pass.
- `npm test`: 210 passed, 1 skipped (the real-file test, waiting for your file).
- `npm run build`: pass. `npm run size`: within budget.
- `python scripts/crosscheck-refs.py`: 32 of 33 phases pass, SnO2 fails (above).

### Next

Sub-stage 6b: choose material and compare phases (wizard steps 3 and 4).

## Sub-stage 5.9: catch-up fixes (done)

Branch `claude/ecstatic-einstein-mofaev`. No new science.

- **Home page:** a fifth card, "TGA and DSC" (coming soon), so all five tools of `CLAUDE.md` show.
  Only XRD opens. Test: `tests/home.test.tsx`.
- **Plot wheel:** the wheel zooms only when the plot has keyboard focus or Ctrl/Cmd is held
  (a trackpad pinch arrives as Ctrl + wheel). Otherwise the page scrolls. The hints now say
  "Pinch or Ctrl + scroll to zoom". Test for `wheelZooms`.
- **Figure export:** SVG and PNG now include the residual panel (25 % of the figure height,
  same 2θ range) when the Fit peaks step shows one. Test in `tests/plot.test.ts`.
- **Compact stepper (below 1024 px):** one numbered 44 px button per step; reached steps jump
  back, later steps are disabled. Test in `tests/wizard.test.tsx`.
- **Real files:** `tests/fixtures-real/` still holds only its README, so there is nothing to
  load or report. **Needed from you:** the real XRD file(s) described in step 2.2 of the plan.

Verification: see the pull request description.

## Reference check against the supplied papers (between Stage 5 and Stage 6)

Branch `verify-references`, built on `stage-5-size-strain`. You supplied the PDFs on `main`
(commit `eff6b39`). I read each one and compared it with the code. Stage 6 has not started,
because `www.crystallography.net` and `cod.crystallography.net` are still refused (403) from
this session.

### Changed because of the papers

- **Wavelengths (`radiation.ts`):** Cr, Fe, Co and Cu now use Hölzer et al., Phys. Rev. A 56
  (1997) 4554–4568, Table IV, column "λ (nm) (this work)", converted to Å.
  - The old Kα2 values (from xrayutilities and pymatgen) differed by up to 4 × 10⁻⁵ Å. For
    example, Cu Kα2 was 1.544414 and is now 1.5444274.
  - A test pins all eight values.
  - Mo and Ag are not in Hölzer and are still unverified. The file named "Table 4.2.2.1" is
    Vol. F (membrane-protein detergents), not the Vol. C wavelength table.
- **SNIP (`background.ts`):** Ryan et al. (1988) use G(y) = log(log(y + 1) + 1) with a fixed
  width w and reduce w by √2 over the last ~8 passes. The app uses the later variant, with a
  growing window and an added square root. The code comment now says so instead of crediting
  Ryan with the variant. The algorithm is unchanged.
- **Dislocation density:** Williamson & Smallman (1956), eq. (1), give ρ = 3n/D², the total
  line length per volume with n ≥ 1. The 1/D² the app reports counts lines crossing unit
  area with n = 1, which is a third of their minimum. The code comment and an in-app help
  note now explain this. The value itself is unchanged.
- **Williamson–Hall UDM:** the original paper (eq. 4) writes β = 2ξ tan θ + λ/(t cos θ), with
  ξ the integral breadth of the strain distribution and K = 1. The app's form,
  β cos θ = Kλ/D + 4ε sin θ, is the one written by Mote et al. (eq. 5); ε = ξ/2. Comment
  updated.
- **Citations completed:**
  - Lieber & Mahadevan-Jansen: pages 1363–1367.
  - Scherrer: the session date is 26 July 1918, from his own footnote.

### Confirmed as implemented (no change)

| Source                                                      | What was checked                                                                                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Savitzky & Golay, Anal. Chem. 36 (1964) 1627–1639           | citation                                                                                                                                                   |
| Lieber & Mahadevan-Jansen, Appl. Spectrosc. 57 (2003)       | fit, clip points above the fit, repeat                                                                                                                     |
| Rachinger, J. Sci. Instrum. 25 (1948) 254                   | point-by-point subtraction of the shifted, scaled Kα1 curve                                                                                                |
| Fritsch & Carlson, SIAM J. Numer. Anal. 17 (1980) 238–246   | citation and pages                                                                                                                                         |
| Thompson, Cox & Hastings, J. Appl. Cryst. 20 (1987) 79–83   | η coefficients 1.36603, 0.47719, 0.11116 (eq. 2); FWHM coefficients 2.69269, 2.42843, 4.47163, 0.07842 (eq. 3); Γ is the shared FWHM of both parts (eq. 1) |
| Caglioti, Paoletti & Ricci, Nucl. Instrum. 3 (1958) 223–228 | eq. (11): the squared Gaussian FWHM is a quadratic in tan θ (neutron spectrometer)                                                                         |
| Monshi et al., WJNSE 2 (2012) 154–160                       | free-slope least-squares line of ln β against ln(1/cos θ), D from the intercept, eqs. (11)–(12)                                                            |
| Mote, Purushotham & Dole, JTAP 6 (2012) 6                   | UDM eq. (5), stress model eq. (6) (they call it UDSM), UDEDM eq. (8)                                                                                       |
| Halder & Wagner, Acta Cryst. 20 (1966) 312–313              | eq. (5), b^P/b = 1 − (b^D/b)², which is the model used for SSP and HW                                                                                      |
| Pal, arXiv:2512.00689v2                                     | corrected SSP eq. (10). The app's form is eq. (10) × λ², with Pal's σ = 4ε. Section 6 confirms that SSP and HW are the same relation                       |
| Okabe & Ito, Color Universal Design (2008), Fig. 16         | all eight plot colours match the RGB (0–255) column exactly                                                                                                |

### Still to verify

- **Mo and Ag wavelengths:** please send International Tables Vol. C, Table 4.2.2.1 (the
  wavelength table).
- **Scherrer (1918):** pages 98–100 and the equation. The two pages supplied are from
  Zsigmondy's Kolloidchemie and do not include the equation.
- **Fritsch & Butland's slope rule** used for the manual anchors.
- **The Halder–Wagner angle form as written in arXiv:2103.03521.** It is derived here
  independently from eq. (5), so this only affects the citation.
- **The origin of the SNIP variant** (growing window, LLS operator).

### Verification

- `npm run lint`: pass. `npm run typecheck`: pass.
- `npm test`: 182 passed, 1 skipped.
- `npm run build`: pass.

## Stage 5: size and strain (done)

Branch `stage-5-size-strain`, built on `stage-4-instrument`.

### What was built

- **Science code** (`src/core/xrd/size/methods.ts`, `src/core/math/linearFit.ts`). Each method
  has a doc comment with its equation, variables and units. β is the instrument-corrected
  FWHM in radians, λ is Kα1 in nm, and D is in nm.
  - **One strain convention everywhere:** ε as in Williamson–Hall, where strain broadening is
    β_ε = 4ε tan θ. This lets the methods be compared directly.
  - **Scherrer:** D = Kλ/(β cos θ) for each peak, with σ(D) = D σ(β)/β, and the mean and SD
    over the peaks.
  - **Monshi–Scherrer:** a least-squares line of ln β against ln(1/cos θ) gives
    D = Kλ/e^intercept. The slope is shown, with a warning when it is more than 0.5 from 1.
  - **Williamson–Hall:**
    - UDM: β cos θ = Kλ/D + 4ε sin θ.
    - USDM: β cos θ = Kλ/D + 4σ sin θ/E_hkl. It gives the stress σ in GPa and the strain as
      the mean of σ/E_hkl.
    - UDEDM: β cos θ = Kλ/D + 4 sin θ √(2u/E_hkl). It gives the energy density u in kJ/m³,
      plus strain and stress.
    - USDM and UDEDM use one Young's modulus, or a value per peak when given.
  - **Size–strain plot:** the dimensionally consistent form
    (dβ cos θ)² = (Kλ/D)(d²β cos θ) + 4ε²λ², with d from Bragg's law in nm.
  - **Halder–Wagner:** (β/tan θ)² = (Kλ/D) β/(tan θ sin θ) + 16ε².
  - **Derived quantities:**
    - dislocation density δ = 1/D² in m⁻²;
    - specific surface area S = 6000/(ρD) in m²/g, assuming dense, separate spheres;
    - stress and energy density from USDM and UDEDM.
  - **Uncertainties:** line fits are unweighted least squares with σ from the residuals.
    Every derived value carries a propagated σ.
  - **Physical checks.** These values are refused with a plain-language reason instead of
    being shown:
    - a negative or zero WH intercept (no size);
    - a negative slope (no strain, stress or energy density);
    - a negative SSP or HW intercept (no strain) or slope (no size).

    The app also warns when R² is below 0.5, when only two peaks are used (no σ), and when
    Monshi's slope is far from 1.
- **Results step** (wizard step 7, `ResultsStep.tsx`, `MethodDetails.tsx`, `sizeResults.ts`):
  - **Settings:** K (default 0.9), Young's modulus, density, and the instrument correction
    method (the same setting as step 6).
  - **Live updates:** every number is recomputed whenever K, the correction method, the
    modulus, the density or the peak selection changes.
  - **Peak table:** a tick box per peak, corrected β ± σ, an optional E_hkl per peak, and
    notes. Peaks limited by resolution start unticked, and peaks with no corrected width
    can't be used. Choices are kept per fit and dropped after a re-fit.
  - **Summary table:** D, ε, stress, u, δ and S per method, with the mean ± SD for Scherrer
    and value ± σ for the line methods, plus R² and the number of peaks. Every method's
    problems and checks are listed above it.
  - **Comparison charts:** bar charts of size and of strain by method, with error bars. Each
    exports to SVG and PNG at 300 and 600 dpi.
  - **One collapsible section per method:**
    - Scherrer: a per-peak table. Limited peaks show "≥ D" as a lower limit.
    - Each line method: its equation, the fitted intercept, slope, R² and n, the plot of
      points with the least-squares line from x = 0 (exportable), and a table of points with
      residuals.
  - **Guidance:** "Which method suits my sample?" in plain language.
  - **CSV for every table:** peaks, summary, Scherrer and each line method. Each file starts
    with a header line stating the equation, K, λ and the fit.
  - **Skip warning:** the warning from step 6 stays at the top.
- **Plot engine and UI:**
  - a bar chart component, `src/ui/plot/BarChart.tsx`;
  - the export panel's ids and radio names are now unique, so several plots can share a page;
  - range labels drop the empty "()" when there is no unit.
- **Saved sessions:** the format version is now 6, with migration (tested).

### Known-answer tests (`tests/xrd-size.test.ts`, `tests/sizeResults.test.ts`)

The test data use D = 30 nm, ε = 1.5 × 10⁻³ and Cu Kα1. There are nine peaks from 25° to
78° 2θ. Widths are built with the broadening model each method assumes.

| Test                                                         | Tolerance and why                                                                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scherrer and Monshi on size-only widths                      | relative 1e-9: each method inverts its model exactly; Monshi slope = 1                                                                                               |
| WH UDM on UDM widths                                         | D and ε to 1e-9                                                                                                                                                      |
| USDM with nine different E_hkl (130–250 GPa) and σ = 0.3 GPa | D and σ to 1e-9; strain equals the mean σ/E                                                                                                                          |
| UDEDM with nine E_hkl and u = 225 kJ/m³                      | D and u to 1e-9                                                                                                                                                      |
| USDM and UDEDM with one common E                             | strain equals the UDM strain; stress = εE; u = ε²E/2                                                                                                                 |
| SSP and HW on Lorentzian-size, Gaussian-strain widths        | D and ε to 1e-9; the two methods agree to 1e-9                                                                                                                       |
| The same with 3 % random width noise (fixed seed)            | truth within 3 reported σ. σ comes from the residuals, so 3σ is the honest bound (about 0.3 % chance of a false failure per check)                                   |
| With strain present                                          | Scherrer gives a smaller D than the truth, as expected                                                                                                               |
| Meaningless results                                          | negative slope → no strain plus an error; negative intercept → no size; size-only data → negative SSP intercept refused; Monshi slope warning                        |
| Straight-line fit                                            | slope, intercept and both σ match hand-computed textbook values                                                                                                      |
| Derived quantities                                           | δ and S match hand calculations                                                                                                                                      |
| Results layer                                                | doubling K doubles every size; the Lorentzian correction changes it; unticking a peak changes it; choices from an old fit are ignored; skip uses the observed widths |

### Decisions

- **One strain convention (Williamson–Hall ε) for every method**, so the summary compares
  like with like. Papers that write the SSP or HW intercept as (ε/2)² report the apparent
  strain η = 4ε. The app says so beside each method.
- **SSP uses the dimensionally consistent form** with λ. The commonly printed form omits λ.
  Pal, J. Alloys Compd. 1048 (2025) 185324, arXiv:2512.00689, reports this; I found it by
  search but could not read the full text.
- **SSP and Halder–Wagner are built as asked, but they are the same model.** Their axes
  differ only by the constant factor λ²/4, so an unweighted fit gives identical D and ε. The
  app says so; a test checks it.
- **FWHM is used as β for every method**, matching the instrument correction. HW and SSP are
  formally defined with integral breadths; tell me if you want an integral-breadth option.
- **Monshi uses a free slope** (least-squares line, as the abstract describes). The slope is
  reported and checked against 1.
- **The summary's spread** is the SD over peaks for Scherrer and the fit standard
  uncertainty for the line methods. Both are labelled.
- **No new dependencies.**

### Verification (real results)

- `npm run lint`: pass. `npm run typecheck`: pass.
- `npm test`: 181 tests pass and 1 is skipped (the real-file test).
- `npm run build`: pass. `npm run size`: initial JavaScript 8.2 KB gzipped (budget 150 KB). The
  XRD chunk is 40.8 KB gzipped and loads on demand.
- Browser check (headless Chromium, production build, strict CSP). Setup: the example data
  with SNIP and Kα2 stripping, all 8 peaks fitted, and the example standard with a Caglioti
  curve.
  - All seven methods produced results. USDM and UDEDM asked for Young's modulus until it was
    entered.
  - Each change updated the table at once:
    - K 0.9 → 0.94 changed the Scherrer size from 53.2 to 55.5 nm.
    - The Lorentzian correction gave 78.6 nm.
    - Unticking a peak gave 76.3 nm with 7 peaks.
    - Entering E = 200 GPa and ρ = 5 g/cm³ filled the USDM, UDEDM and surface-area columns.
  - The low R² (0.18) of the WH plots on this synthetic example was flagged in the summary
    and in each method.
  - The summary CSV and the bar-chart SVG downloaded, and a reload kept everything.
  - No console errors. No horizontal scroll at 360, 768, 1280 or 1920 px in light or dark.
    All controls are at least 44 px tall.

### Known issues and to-dos

- **Please verify:**
  - Citations written from memory: Scherrer (1918), Williamson & Hall (1953),
    Halder & Wagner (1966), and Williamson & Smallman for δ.
  - The USDM and UDEDM forms follow Mote, Purushotham & Dole (2012). I confirmed the paper
    and its plot axes by search, but could not read the full text.
  - Monshi et al. (2012) was confirmed by search; full text not reached.
  - The HW angle form matches arXiv:2103.03521.
- **Thresholds:** Monshi's slope tolerance (0.5) and the R² warning (0.5) are judgement calls.
  Tell me if you prefer other values.
- **E_hkl and hkl:** per-peak moduli are typed by hand. There is no hkl assignment yet; that
  comes with the material and reference stage.
- **Methods text:** the paragraph for papers is not generated yet (Export stage).
- Carried over: your real XRD file and Origin fit, wavelength verification, the TCH and
  Caglioti checks from Stage 4, and no Thermal card.

### Next stage

Stage 6: not started. Waiting for your go-ahead and the stage brief.

## Stage 4: instrumental broadening correction (done)

Branch `stage-4-instrument`, built on `stage-3-peaks`.

### What was built

- **Science code** (`src/core/xrd/instrument/`, no UI imports). Each formula has a doc comment
  with the equation, the variables and the units (all widths are FWHM in degrees 2θ).
  - **Instrument curves** (`curve.ts`):
    - constant b;
    - Caglioti, FWHM² = U tan²θ + V tanθ + W, with U, V, W in deg²;
    - a straight line or quadratic in 2θ.
    - Curves are fitted to standard peaks by ordinary least squares. Caglioti is fitted to
      FWHM², which is linear in U, V and W; the polynomials are fitted to FWHM about the mean
      2θ.
    - The curve's σ comes from C = s² (XᵀX)⁻¹ and is propagated to b at every angle.
    - With exactly as many points as parameters, no σ is given and the app says why.
    - GSAS-II U, V, W (Gaussian σ² in centidegrees²) can be typed in and are converted with
      FWHM = √(8 ln 2) σ, taken from the GSAS-II source (`getFWHM`).
  - **Corrections** (`correction.ts`):
    - Gaussian: β = √(B² − b²).
    - Lorentzian: β = B − b.
    - Approximate Voigt: each pseudo-Voigt (FWHM, η) is split into Gaussian and Lorentzian
      widths with the Thompson–Cox–Hastings relations (`voigt.ts`). The Gaussian parts are
      subtracted in quadrature and the Lorentzian parts linearly, then the two are joined
      again. If one part would go negative it is set to 0, with a note.
    - σ(β) combines σ(B) from the peak fit and σ(b) from the curve.
  - **Warnings**, shown on the peak concerned. "Limited by instrument resolution, size is a
    lower limit" appears when:
    - the corrected width is zero or negative (no number is given), or
    - b/B ≥ 0.8. At 0.8, a 1 % error in b already becomes a 1.8 % error in β.

    The app also warns when a peak lies outside the standard's 2θ range (the curve is
    extrapolated there) and when the curve has no valid width at an angle.
- **Instrument correction step** (wizard step 6, `src/modules/xrd/InstrumentStep.tsx`):
  - **Choosing the instrument width:**
    - Choose (a) a typed constant FWHM, (b) typed Caglioti U, V, W (in the Caglioti or GSAS-II
      convention), (c) a standard pattern, or skip the correction.
    - Next is refused until an instrument width is given or Skip is chosen.
  - **Standard pattern** (`StandardPanel.tsx`):
    - Reads the same file formats as Upload, or "Try with example standard", which is clearly
      marked synthetic. You choose the material (LaB₆, Si or other).
    - The standard is cleaned with SNIP background and Kα2 stripping (each can be switched off),
      then its peaks are found and fitted with the Stage 3 worker. The peak shape is selectable.
    - A table lists each standard peak (2θ, FWHM ± σ, η, notes) with a tick box to leave
      outliers out.
    - You choose the curve type (Caglioti, straight line or quadratic). The curve's
      parameters and RMS are shown.
    - The instrument η used by the Voigt method is the mean fitted η of the included peaks.
  - **Plot:** instrument FWHM against 2θ, with a numbered y axis and the standard's peaks as
    points. It exports to SVG and PNG with the points.
  - **Correction method:** Gaussian is the default. Each option has a plain-language
    explanation of when it is appropriate. The Voigt method asks for the instrument η when
    the width was typed in (default 0).
  - **Before and after table**, per pattern: 2θ, observed B ± σ, instrument b ± σ,
    corrected β ± σ, b/B and notes. Rows limited by resolution are shaded.
    - CSV export. Its header line states the method and the instrument curve with its
      parameters.
    - Warnings appear when the sample fit is out of date, when Kα2 was stripped from only one
      of the standard and the sample, and when the two were fitted with different peak
      shapes.
  - **Always visible:** a note that skipping this correction makes crystallite sizes come out
    smaller than reality.
  - **Skip:** a warning in the step, plus a persistent warning in step 7 (Results). Step 7 is
    still a placeholder otherwise.
- **Plot engine:**
  - optional numbered y axis (`AxisLabels.yValues`);
  - `points`, which are drawn and exported, unlike editing markers;
  - markers now count towards the y range.
- **Wizard:** after a refused Next, the message now disappears as soon as the problem is fixed
  (it used to stay until Next was pressed again).
- **Saved sessions:** the format version is now 5. Stage 1–3 sessions are migrated, and
  Stage 3 peak fits are kept (tested).

### Known-answer tests (`tests/xrd-instrument.test.ts`)

Observed peaks are made by numerically convolving a chosen sample profile with a chosen
instrument profile, on a 0.005° grid. Counting noise is added and the peaks are fitted with
the Stage 3 fitter, so the tests run the same path as real data.

| Test                                                                                    | Tolerance                                                                                                                                            |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gaussian sample 0.25° ⊗ Gaussian instrument 0.10°, Gaussian correction                  | true width within 2 %                                                                                                                                |
| Lorentzian sample 0.20° ⊗ Lorentzian instrument 0.08°, Lorentzian correction            | within 3 %                                                                                                                                           |
| Voigt sample (G 0.12°, L 0.15°) ⊗ Voigt instrument (G 0.07°, L 0.03°), Voigt            | within 3 % of the numerically measured sample FWHM; the Gaussian and Lorentzian formulas bracket it                                                  |
| End to end: noisy synthetic standard (11 peaks on a Caglioti curve)                     | detected, fitted, curve within 2 % of the true b at four angles                                                                                      |
| … then sample peaks 0.15° broadened by that instrument, corrected with the fitted curve | within 3 %, with no warnings                                                                                                                         |
| TCH relations                                                                           | η(0) = 0, η(1) = 1, ρ(η) inverts η(ρ), split then join returns the width, TCH width within 1 % of a convolved Voigt                                  |
| Formulas                                                                                | exact inversion of the convolution laws; Voigt reduces to Gaussian or Lorentzian for η = 0 or 1                                                      |
| Curves                                                                                  | exact U, V, W from exact points; straight-line σ matches the textbook formula; n = m gives no σ; GSAS-II conversion matches the GSAS-II formula      |
| Warnings                                                                                | b ≥ B gives no width and the lower-limit flag; b/B = 0.85 flagged; 0.5 not flagged; extrapolation warned; Gaussian σ(β) matches the analytic formula |

### Decisions

- **Unweighted least squares for the instrument curve**, matching the peak fits. Caglioti is
  fitted to FWHM², which gives the wider peaks a little more weight.
- **Instrument η for Voigt:** the mean over the standard's peaks, not a curve in 2θ. If your
  standard's η changes a lot with angle, tell me and I will add a curve for it.
- **Resolution-limit threshold b/B = 0.8**, a judgement call explained in the code. Tell me if
  you prefer another value.
- **The standard is cleaned separately** (SNIP and Kα2 only), because manual anchors and
  smoothing belong to one pattern. The app warns when Kα2 handling differs between the
  standard and the sample.
- **No new dependencies.**

### Verification (real results)

- `npm run lint`: pass. `npm run typecheck`: pass.
- `npm test`: 158 tests pass and 1 is skipped (the real-file test, still waiting for your
  file).
- `npm run build`: pass. `npm run size`: initial JavaScript 8.2 KB gzipped (budget 150 KB). The
  XRD chunk is now 31 KB gzipped and loads on demand.
- Browser check (headless Chromium, production build with the strict CSP), on the example
  data with SNIP and Kα2 stripping, all 8 peaks fitted:
  - Next was refused until a width was given.
  - Constant 0.08°: 8 rows. At 0.3°, all 8 were flagged as limited by resolution.
  - Caglioti values were typed in, and the curve and table updated.
  - Example standard: 11 peaks found and fitted in about 0.1–0.16 s. The Caglioti fit gave
    U = 0.00972, V = −0.00376, W = 0.00295 deg², against the generating 0.01, −0.004 and
    0.003. RMS was 0.0004°.
  - Unticking a point re-fitted the curve. Voigt used η = 0.30 from the standard, the value
    it was generated with.
  - The CSV downloaded and a reload kept everything. Skip showed the warning in Results.
  - No console errors. No horizontal scroll at 360, 768, 1280 or 1920 px in light or dark.
    All visible controls are at least 44 px tall.

### Known issues and to-dos

- **Please verify:**
  - the Thompson–Cox–Hastings coefficients (`voigt.ts`). They match the GSAS-II source and
    a paper quoting TCH, but the 1987 paper itself could not be reached;
  - the Caglioti citation (`curve.ts`), Nucl. Instrum. 3 (1958) 223–228, which was written
    from memory;
  - the 0.8 threshold.
- **Lower limits aren't used yet.** The sizes that come out as lower limits are not computed
  until the size stages; the flag is ready for them.
- **Kα2 in the standard and the sample:** the app warns when they differ, but can't check
  whether your Kα2 ratio suits your tube.
- **Real-data check:** a real LaB₆ or Si file from your instrument would let me check the
  standard path on real data.
- Carried over: your real XRD file and Origin fit, wavelength verification, no Thermal card.

### Next stage

Stage 5: done (see above).

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

Stage 4: done (see above).

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
- `npm run build`: pass. `npm run size`: initial JavaScript 8.2 KB gzipped (budget 150 KB); the
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
