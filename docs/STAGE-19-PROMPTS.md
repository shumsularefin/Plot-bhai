# Stage 19: UV-Vis, FTIR and particle size, audit fixes and completion

Written on 2026-11-14 from a code audit of the three tools (`src/core/uvvis`, `src/core/ftir`,
`src/core/particles` and their modules). This file is the instruction for the sessions that do the
work. It is written for Opus 5.5.

## How to use this file

One sub-stage per session, in the order of the table. For each session, paste the guardrail block
from `docs/EXECUTION-PLAN.md` (section 3), then the line:

```text
Sub-stage 19x: do it exactly as written in docs/STAGE-19-PROMPTS.md.
```

| Sub-stage | What                                                       | Needs from the owner first             |
| --------- | ---------------------------------------------------------- | -------------------------------------- |
| 19a       | Four bugs found by the audit                               | nothing                                |
| 19b       | Validation of the three tools, three ways, and the record  | real files if available (not blocking) |
| 19c       | FTIR peaks: editing, table, comparison across samples      | nothing                                |
| 19d       | FTIR processing, reflectance data, wider group table       | approval of the group table source     |
| 19e       | UV-Vis: peak table, path length, figures, more gap methods | nothing                                |
| 19f       | Particles: session file, report, statistics                | nothing                                |
| 19g       | Binary FTIR and UV-Vis instrument files                    | a real file of each format             |

## Rules that apply to every sub-stage here

These repeat the parts of `CLAUDE.md` that matter most for this stage, with the reason for each,
so that a judgement call goes the right way.

- **Everything runs in the browser.** The site is on the free Firebase Spark plan. No Cloud
  Functions, no new backend, no paid service, no CDN. A feature that cannot be done client-side is
  not built; say so and stop.
- **Nothing scientific from memory.** Every equation, constant, band position, citation and
  expected test value must come from a source opened in the session and cited in a code comment.
  This file names papers and formulas as the audit remembered them. Treat each as a pointer to
  check, not as a fact: open the paper, confirm the equation and the reference details, and
  correct this file if it is wrong. If a source cannot be opened, mark the item TODO in
  `docs/validation.md` and tell the owner. The owner publishes with these numbers, so an invented
  value is worse than a missing feature.
- **Three-way validation for every new numerical method** (`CLAUDE.md` section 2): synthetic data
  with a known answer, an independent implementation or a published worked example, and a
  round-trip or invariance check. Record each check, its source and its tolerance in
  `docs/validation.md`. A check that could not be run is listed there as open.
- **Estimates are labelled as estimates**, and a warning appears where the problem happens, in
  plain language.
- **Saved sessions must keep working.** Every change to a saved data shape bumps that tool's state
  version and adds a migration, with a test that loads the old shape.
- **Reuse before writing.** The plot panel, peak labels, peak fitter (`src/core/xrd/peaks/fit.ts`),
  CSV export, session codec, record and report sections already exist. Search `src/` first.
- **New code stays in the lazy-loaded tool chunk.** Run `npm run size` at the end.
- **Methods text follows the settings.** Any new option that changes a number must appear in the
  generated methods paragraph and in the results CSV, so the paper can state what was done.
- At the end of each sub-stage: set its row in the status tracker of `docs/EXECUTION-PLAN.md` to
  `done` (or `blocked: reason`) and update `docs/PROGRESS.md` in the same pull request.

If a requirement below turns out to be wrong, unclear or in conflict with the code as it stands,
ask the owner instead of guessing.

---

## 19a: four bugs found by the audit

Each bug gets a failing test first, then the fix. The numbers below were measured in the audit and
can be reproduced.

### Bug 1: the Tauc band gap is wrong when the spectrum has background absorption

**Where:** `src/core/uvvis/tauc.ts` (`fitBandGap`, `suggestRegion`), `src/modules/uvvis/analysis.ts`,
`src/modules/uvvis/BandGapStep.tsx`.

**What happens:** the fitted Tauc line is always extended to y = 0. When the absorbance does not
fall to zero below the edge (scattering, a second phase, defects, an imperfect blank), the
intercept with the axis lies below the true gap. The fit still looks perfect, so nothing warns the
user.

**Reproduce:** wavelengths 250 to 850 nm in 1 nm steps; absorbance
A(E) = 1.2 · √(E − 3.2) / E for E > 3.2 eV and 0 below, plus a constant background; direct allowed
transition; the automatic region.

| Background (absorbance) | Eg reported (eV) | Suggested region (eV) | R²     |
| ----------------------- | ---------------- | --------------------- | ------ |
| 0                       | 3.200            | 3.20 to 3.81          | 1.0000 |
| 0.05                    | 3.116            | 3.94 to 4.54          | 1.0000 |
| 0.2                     | 2.926            | 3.83 to 4.43          | 1.0000 |
| 0.5                     | 2.690            | 3.66 to 4.26          | 1.0000 |

Note the second fault in the table: with a background the suggested region jumps far above the
edge, because the curve is no longer straight near it.

**What to build:**

1. The baseline-intersection method. Pointer: P. Makuła, M. Pacia and W. Macyk, "How To Correctly
   Determine the Band Gap Energy of Modified Semiconductor Photocatalysts Based on UV–Vis Spectra",
   J. Phys. Chem. Lett. 9 (2018) 6814. Open it and confirm the method and the reference before
   citing. A second straight line is fitted to the Tauc curve in the flat part below the edge, and
   the band gap is the energy where the edge line and that baseline line cross, with an
   uncertainty propagated from both fits.
2. A setting per spectrum: intercept with the axis (today's behaviour) or intersection with a
   baseline. The baseline region is suggested automatically and can be dragged or typed, like the
   edge region. Both lines and their crossing are drawn on the Tauc plot and in its export.
3. A warning when the axis intercept is used but the Tauc curve below the edge is clearly above
   zero. Choose the threshold from the synthetic cases and write it down as your own choice. The
   warning names the problem and points to the baseline option.
4. Decide, with evidence from the synthetic cases, whether the baseline method should be the
   default when a sub-gap level is detected. Existing saved sessions must give the same number as
   before until the user changes the setting.
5. Look at why `suggestRegion` leaves the edge when a background is present and make the
   suggestion stay on the edge in those cases, without changing its result for the zero-background
   cases already tested.
6. Results table, CSV, methods text and the record state which method gave each gap.

**Done when:** the four synthetic cases above return 3.200 eV within a tolerance you justify
(about 0.01 eV is expected) with the baseline method; the same holds for an indirect allowed
synthetic edge, for a sloping (not constant) background, and for a Kubelka–Munk spectrum with a
background; the zero-background results are unchanged.

### Bug 2: reflectance written as a fraction is read as percent

**Where:** `src/core/uvvis/kind.ts`. `kindFromText` always returns `scale: 'percent'` for
transmittance and reflectance, so the fallback in `suggestKind`
(`fromText.scale ?? (max > 1.5 ? 'percent' : 'fraction')`) never runs.

**Reproduce:** a file headed `Wavelength (nm),Reflectance` with values between 0.1 and 0.8 is
imported as reflectance in percent. The Kubelka–Munk function is then calculated from R/100, which
changes the shape of the curve and the band gap.

**Fix:** a word such as "Reflectance" or "Transmittance" names the kind only; a percent sign in the
heading ("%R", "R (%)", "%T") names the scale too. Without a percent sign the range of the values
decides the scale, as `suggestFtirKind` in `src/core/ftir/kind.ts` already does. Check the same
path for the digitize targets and the film and concentration tools, which import through the same
code.

**Done when:** tests cover a named heading with fraction values, a named heading with percent
values, a "%R" heading, and the transmittance equivalents.

### Bug 3: FTIR assignments disappear when the cleaning settings change

**Where:** `src/modules/ftir/analysis.ts` (`assignmentFor`, `ASSIGNMENT_MATCH_CM = 2`),
`src/modules/ftir/AssignStep.tsx` (`setLabel`).

**What happens:** an assignment is stored against the wavenumber of the peak at the time and is
found again only if a peak lies within 2 cm⁻¹. Changing the baseline, smoothing or ATR correction
moves peak positions. In the example absorbance spectrum, switching the baseline on moves one peak
from 1448.6 to 1453.4 cm⁻¹, and switching ATR correction on also moves 3394.2 to 3397.5 cm⁻¹; those
assignments vanish from the tables although they are still stored. The owner reported "entries
resetting" in this step before (see `docs/PROGRESS.md`); this is the likely cause.

**Fix requirements:**

- An assignment follows its peak through reprocessing: after peaks are picked again, each stored
  assignment goes to the nearest peak, one assignment per peak, within a tolerance wide enough for
  the shifts that processing causes. Choose the tolerance from tests and state it as your own choice.
- An assignment whose peak is gone (for example the prominence was raised) is never dropped
  silently. It is listed as "not attached to a peak" with its wavenumber and text, and the user
  can remove it or it re-attaches when the peak returns.
- Typing in the assignment box still keeps the text until the user leaves the box (the earlier fix).
- Sub-stage 19c adds peaks added and removed by hand. Design the stored shape now so that it can
  hold them (a stable identity for a peak that survives reprocessing), to avoid two migrations.

**Done when:** a test assigns all peaks of the example spectrum, switches baseline, smoothing and
ATR on and off in turn, and every assignment is still shown on its peak.

### Bug 4: FTIR reflectance files are silently taken as transmittance

**Where:** `src/core/ftir/kind.ts` and `src/core/ftir/import.ts`. A file headed
`Wavenumber,Reflectance` with percent values is guessed as percent transmittance, with no message.

**Fix in this sub-stage:** recognise reflectance wording in the heading and the JCAMP-DX
`##YUNITS=` field, and show a plain warning on the spectrum card that the file states reflectance,
that this tool treats the values as transmittance for now, and what that means for the band
shapes. The proper reflectance data type comes in 19d.

---

## 19b: validation of the three tools

**Why:** `docs/validation.md` and the public page `#/validation` cover XRD only. The owner's rule
is that every numerical method is checked three ways and the checks are written down. Today the
only independent checks for these tools are the Swanepoel thickness table
(`tests/uvvis-film.test.ts`) and the arPLS baseline (`tests/baseline-validation.test.ts`).

**How:** follow the pattern that already exists for XRD. Reference programs cannot be installed in
the session container, so a script under `scripts/validation/` runs in
`.github/workflows/validation.yml`, writes fixtures to `tests/fixtures/validation/`, and unit tests
compare this site's numbers with them. Read section 16g and 18 of `docs/validation.md` first and
match their form.

**Step 1: an inventory.** List every numerical method of the three tools, with the test that
covers it and which of the three kinds of check it has. Put the table in `docs/validation.md`.
The audit found these methods; confirm the list against the code:

- UV-Vis: absorbance, transmittance and Kubelka–Munk conversions; photon energy; blank and offset;
  Savitzky–Golay smoothing; λmax; Tauc fit and its uncertainty; baseline-intersection gap (from
  19a); Urbach energy; derivative method; band fitting on the energy axis (`plasmon.ts`);
  Swanepoel index and thickness; Beer–Lambert calibration; first-order kinetics.
- FTIR: conversions; ATR correction and penetration depth; rubber-band, polynomial, ALS and arPLS
  baselines; smoothing; normalisation; peak picking, prominence and the parabola position; second
  derivative; band fitting; band areas and ratios; spectrum subtraction; JCAMP-DX reading.
- Particles: scale calibration; thresholds (each automatic method); labelling; watershed
  splitting; area, equal-area diameter, Feret diameters, perimeter, circularity, convex area,
  fitted ellipse, grey statistics; percentiles and summary; bin rules; normal and lognormal fits;
  area fraction and lineal intercept.

**Step 2: independent references.** For each method without one, add one. Suggested references,
to be confirmed as installable in CI:

- NumPy and SciPy for straight-line fits with covariance (Tauc, Urbach, Beer–Lambert, kinetics),
  `scipy.signal.savgol_filter`, `scipy.signal.find_peaks` and `peak_prominences`,
  `numpy.percentile`, `scipy.stats.norm.fit` and `lognorm.fit`, trapezoid areas.
- lmfit for band fitting (it is already used for XRD peak fits).
- scikit-image for thresholds (`threshold_otsu` and the others that match a method here),
  `measure.label` and `regionprops` (area, equivalent diameter, Feret maximum, moments ellipse).
- ImageJ or Fiji run headless in CI, if it can be installed there, for Analyze Particles on a
  generated test image: count, area, perimeter, circularity, Feret, fitted ellipse. The code states
  that its perimeter and ellipse follow ImageJ's definitions; this is the check of that claim.
- A published worked example where one exists with the data printed in the paper (as was done for
  Swanepoel). Do not claim agreement with a paper whose input data you do not have.

Where two programs define a quantity differently (perimeter, Feret, percentile rule, median of an
even count), the record says which definition this site uses and why the numbers differ.

**Step 3: round-trip and invariance checks**, for example: %T to A and back; wavelength to energy
and back; a spectrum reversed in order gives the same result; Tauc gap unchanged when the
absorbance is multiplied by a constant; a particle rotated by 90° or mirrored keeps its area,
Feret diameters and circularity; an image scaled by 2 gives diameters scaled by 2; pooling two
images equals analysing their particles together.

**Step 4: real files.** If the owner has put a real UV-Vis file, FTIR file or SEM/TEM image with
their own Origin or ImageJ results in `tests/fixtures-real/`, compare with them and record it. If
not, list it as open and say exactly what file and what numbers are needed.

**Step 5: the record.** One section per tool in `docs/validation.md` in the existing style (what
was checked, against what, tolerance, result, and an "Open" list). Confirm the public validation
page shows them. Any fault a check exposes is fixed in this sub-stage with a test, and described
in the record as section 18 does.

**Step 6: the FTIR tables.** `data/ftir/groups.json` is one review article's table and is marked
for the owner's verification; say so in the record, and list which rows the owner should compare
with a textbook.

---

## 19c: FTIR peaks, editing, table and comparison across samples

**Why:** the owner asked that FTIR "have all basic peak data, which peak is what", and that the
combined plot carry peak data for the different samples. Today peaks can only be changed with one
prominence slider, the table has position and height only, and peaks are listed sample by sample
with no way to compare samples.

**Where:** `src/core/ftir/peaks.ts`, `src/modules/ftir/PeaksStep.tsx`, `AssignStep.tsx`,
`ResultsStep.tsx`, `FtirPlot.tsx`, `analysis.ts`, `data.ts`, `methodsText.ts`, `record.ts`,
`session.ts`.

1. **Add and remove peaks by hand.** In the Pick peaks step: click or tap the plot to add a peak
   at the nearest local maximum (or exactly there when no maximum is near, for a shoulder), and
   remove any peak from its table row or its label. Works with keyboard and touch (44 px targets).
   Hand-added and removed peaks are stored per spectrum, survive reprocessing (the identity from
   19a), are marked "added by hand" in the table and CSV, and can be undone and reset.
2. **Shoulders.** Offer the second-derivative minima that already exist in the Bands step
   (`derivativeBands`) as candidate shoulders in the Pick peaks step, shown as suggestions the
   user accepts, and marked "shoulder" in the table.
3. **More columns for each peak:** width at half height above the local baseline, integrated area
   above the local baseline, and an intensity class (strong, medium, weak, and broad). Write each
   definition in a doc comment with its equation and units. The class thresholds are your own
   choice unless a citable convention is found; say which on screen. Width and area of a peak that
   overlaps a neighbour are unreliable: flag those rows and point to band fitting in the Bands step.
   When transmittance is shown, the table also gives %T at the peak, as it does today.
4. **Comparison table across samples.** In Results, a table with one row per band and one column
   per sample. Peaks of different samples are grouped into one band when they lie within a
   tolerance (adjustable; default your own choice, stated). Each cell shows the wavenumber in that
   sample, or a dash when the band is absent; further columns give the shift relative to a
   reference sample the user picks, and the assignment. Show relative intensity as an option.
   Grouping must not depend on the order of the samples; test that. CSV export.
5. **The combined figure.** Options to label peaks with the wavenumber, the assignment, or both;
   labels must not overlap (reuse the label layout in `src/ui/plot/peakLabels`). An option to mark
   the spectral regions (for example O–H and N–H stretch, C–H stretch, triple bond, double bond,
   fingerprint, metal–oxygen) with light bands and names; the region limits must come from a cited
   source or the existing group table, not from memory. Everything shown is in the SVG and PNG
   export.
6. **Processed spectra CSV in wide form** as an option (one wavenumber column, one column per
   sample, when the grids match), next to the long form that exists.

**Done when:** the e2e test for FTIR covers adding a peak, removing one, assigning, and the
comparison table; synthetic tests cover width and area of an isolated band with a known width and
area (Gaussian and Lorentzian), and the grouping of bands across three synthetic samples with
known shifts; the methods text mentions hand-edited peaks when there are any.

---

## 19d: FTIR processing, reflectance data and a wider group table

1. **Reflectance (DRIFTS) data type.** Add `reflectance` to the FTIR kinds with the Kubelka–Munk
   transform as the absorbance-like quantity (the function already exists in
   `src/core/uvvis/conversions.ts`), and −log₁₀ R as the alternative, labelled for what each is.
   State on screen the assumption behind Kubelka–Munk (an optically thick, diluted, scattering
   sample) and that specular reflectance from a flat surface is a different measurement this tool
   does not transform (no Kramers–Kronig). Axis labels, tables, CSV and methods text name the
   quantity. Replace the temporary warning from 19a.
2. **Normalise to a chosen band.** In addition to the two normalisations that exist: divide by the
   height (or the area) of a band in a wavenumber range the user gives, for comparing samples
   against an internal reference band. Warn when that band is absent or negative.
3. **CO₂ region.** An option to replace 2280 to 2400 cm⁻¹ (limits adjustable; confirm the default
   against the band positions in `data/ftir/atmosphere.json`) with a straight line between its
   ends, off by default. The region is marked on the plot as edited, excluded from peak picking,
   and stated in the methods text, because it changes the data shown.
4. **A wider group table. Blocked until the owner approves the source.** The table has 65
   functional groups and 13 metal oxides from one review. Missing for materials samples:
   carbonate, nitrate, sulfate, phosphate, silicate and Si–O–Si, Al–O, borate, nitro, alkyne,
   aldehyde C–H, S–H, S=O, P=O, C–F, C–Cl, C–Br, and oxides such as SiO₂, Al₂O₃, MgO, ZrO₂, CeO₂,
   MnO₂, WO₃, V₂O₅ and ferrites. First find open, citable sources whose licence allows
   redistribution (open-access review tables, NIST data), and report to the owner for each: the
   citation, the licence, what it covers and what it does not. Do not add any row before the owner
   answers. After approval: transcribe with `scripts/build-ftir-groups.ts` in the existing way,
   keep the source of every row, check the transcription row by row and record that in the file's
   `verification` field, and show the source next to each suggestion. Rows from different sources
   that disagree are both kept and both shown. Nothing is filled in from memory, even where a
   value is well known.
5. **Suggestions use the new information.** With 19c's intensity class and "broad" flag in hand,
   rank a suggestion whose listed character fits the peak above one that does not, only where the
   source table states that character. The reason text says so. Still estimates.

---

## 19e: UV-Vis completion

**Why:** the owner asked whether UV-Vis has everything a complete tool needs. The band gap part is
strong; the plain spectrum part is thin (one λmax per spectrum, no labelled figure in the results).
Owner's earlier decision, still in force: UV-Vis spectrum figures are plotted against wavelength
in nm; photon energy is used for the Tauc, Urbach and derivative plots.

**Where:** `src/core/uvvis/`, `src/modules/uvvis/` (the main tool; the film and concentration
tools only where named).

1. **Peak table.** All absorption bands of each spectrum, not only the highest point: position
   (nm and eV), absorbance (or F(R)), prominence, and shoulders as suggestions. Reuse the FTIR
   peak picker and, after 19c, its add and remove by hand. Labels on the plot and in the export.
   λmax stays, defined as today. Band fitting on the energy axis (`plasmon.ts`) exists only in the
   film tool; make it reachable from the main tool for overlapping bands.
2. **Path length for solutions.** The absorption coefficient today takes a film thickness in nm
   only. Add the choice "film (thickness in nm)" or "solution (path length in cm)", with the
   equation shown for each and α in cm⁻¹. The Tauc plot of a solution spectrum says what its
   vertical axis is.
3. **Figures in Results.** A combined spectra figure of all samples with offset and stack, legend
   and peak labels, and a combined Tauc figure overlaying the chosen samples with their fit lines
   and gaps. Both use the shared export panel (journal widths, fonts, SVG, PNG 300 and 600 dpi).
4. **Direct and indirect side by side.** The comparison of transition types exists in the Band
   gap step; let the user keep more than one transition per sample in the results table, CSV and
   methods text, each with its own region, since papers often report both.
5. **More gap methods as cross-checks,** each only if its source can be opened and each validated
   three ways: the Cody plot, and the sigmoid (Boltzmann) fit of the absorption edge. Pointer for
   the second: A. R. Zanatta, Sci. Rep. 9 (2019) 11225; confirm the reference and the equation
   that turns the fit into a gap before using it. Shown as estimates next to the Tauc value, never
   replacing it.
6. **Optical constants,** each with its equation, units and assumptions in a doc comment and on
   screen: extinction coefficient k = αλ / 4π (needs α, so a thickness or path length); optical
   conductivity only if the refractive index is known (the Swanepoel result in the film tool) and
   the formula is taken from a cited source; a refractive index estimated from Eg (Moss,
   Ravindra, Hervé–Vandamme relations) only with each relation's source opened and its range of
   validity stated, labelled as a rough empirical estimate.
7. **Film spectra with reflection.** If the user has both transmittance and reflectance of a film,
   α corrected for reflection can be calculated; build this only with a cited equation, and say
   that without the reflectance spectrum α is overestimated where the film reflects.
8. **Results, methods text, record and session** carry all of the above; the saved state gets a
   migration.

---

## 19f: particle size completion

**Where:** `src/core/particles/distribution.ts`, `src/modules/particles/` (`DistributionStep.tsx`,
`data.ts`, `sizes.ts`), the sample report code named in `docs/PROGRESS.md`.

1. **Session file.** Particles is the only tool without a JSON session that can be exported and
   imported again. The image lives in IndexedDB and is large, so the file holds the scale, all
   settings, the detected and hand-edited particles (as runs), the hand measurements, the pool and
   the distribution settings, plus the image's name, size and a hash. On import without the image
   the distribution, tables and pooled data work and the image steps ask for the same image; if a
   different image is loaded (hash differs) say so plainly. Use the shared session section.
2. **Sample report.** Add the particle size distribution to the sample report (and DSC results if
   they are still missing; check `docs/PROGRESS.md`, "not part of the sample report yet").
3. **Statistics,** each with its equation in a doc comment, a synthetic test with a known answer
   and an independent reference:
   - standard error of the mean and a 95 % confidence interval, with the method stated;
   - coefficient of variation, and a polydispersity index only if its definition for image sizes
     is taken from a cited source (it is easily confused with the light-scattering quantity; say so);
   - moment means D[1,0], D[3,2] (Sauter) and D[4,3], and a volume-weighted distribution with
     volume-based D10, D50, D90, stated to assume spheres of the measured diameter. The existing
     number-based values stay the default and keep their names; every table and the methods text
     says which weighting a number has;
   - a goodness-of-fit measure for the normal and lognormal fits (for example Kolmogorov–Smirnov
     with the caveat that the parameters were estimated from the same data, or an
     Anderson–Darling statistic), worded as a guide, with the source of the method cited.
4. **Shape distributions.** Histograms and summary rows for aspect ratio, circularity and
   solidity, in the same chart component, with the existing note that a digital circle reads
   about 0.9 in circularity.
5. **Histogram figure.** A free height for the exported histogram (listed as a known issue).
6. **A real image.** The tool has not been tried on a real micrograph. If the owner has supplied
   one with ImageJ numbers, compare and record it in `docs/validation.md`; if not, list it as open.

---

## 19g: binary instrument files (blocked until real files exist)

Thermo OMNIC `.spa`, Galactic `.spc`, PerkinElmer `.sp` and Bruker OPUS files are recognised and
refused today. The project rule (set for XRD and kept here) is that a reader is written only
against real instrument files held in `tests/fixtures-real/`, never from a format description
alone. When the owner supplies a file of a format together with its text export from the
instrument software, write the reader for that format, test that it returns the same points as
the text export, and record it in `docs/validation.md`. Until then set this row to
`blocked: needs real files` and do nothing else.

---

## What the owner should prepare

- For 19b: one real UV-Vis file with the band gap obtained in Origin, one real FTIR file of a
  known material, and one SEM or TEM image with the ImageJ results table, placed in
  `tests/fixtures-real/`. Not blocking; without them the checks are listed as open.
- For 19d: a yes or no on each proposed source for the wider FTIR group table.
- For 19g: binary files with their text exports.
