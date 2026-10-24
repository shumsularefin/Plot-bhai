# Progress

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
