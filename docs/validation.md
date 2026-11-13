# Validation record

The owner asked (November 2026) that every numerical method be "super accurate and super
validated". This file lists, for each method added from stage 16 on, how it was checked: synthetic
data with a known answer, an independent implementation or published example, and invariance or
round-trip checks. Tolerances are stated. Checks that could not be run are listed as open.

Earlier stages are checked by the unit tests in tests/ and the cross-check in
docs/reference-crosscheck.md.

## 16a: instrument file readers and .xy/.xye export

| Method                         | Check                                                                                                                                       | Source                                                                                                                     | Tolerance                              | Result                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------- |
| Rigaku .rasx reader            | 2 real files, every point against two independent extractions                                                                               | geddes reference CSVs (FAIRmat files), and `tests/real-references/make_references.py`                                      | 1e-9 in 2θ, 1e-9 relative in intensity | pass (2,726 and 7,001 points) |
| Bruker .brml reader            | 2 real files (2θ-ω with absorber, locked coupled), every point                                                                              | geddes CSV for one; `make_references.py` (ElementTree) for both; cheminfo's test states 2,443 points for the second        | as above                               | pass (2,001 and 2,443 points) |
| Bruker .raw (version 4) reader | 2 real files, 4-byte and 8-byte records, every point                                                                                        | geddes CSVs; `make_references.py` (struct); field offsets agree in GSAS-II `G2pwd_BrukerRAW.py` and geddes `src/bruker.rs` | as above                               | pass (4,059 and 7,134 points) |
| Absorber handling (.brml)      | every point measured with the absorber (factor 8.3) has stored intensity = whole counts × 8.3, so the stored value is already corrected     | the real file itself                                                                                                       | 1e-6                                   | pass                          |
| Wavelength read from file      | Kα1 read from each file's header                                                                                                            | values printed by GSAS-II's field layout (RAW) and the XML (BRML, RASX)                                                    | exact                                  | pass                          |
| ZIP reader                     | CRC-32 check value of "123456789" is 0xCBF43926; stored-entry round trip; a damaged entry is refused by its checksum                        | CRC-32/ISO-HDLC standard check value                                                                                       | exact                                  | pass                          |
| σ for .xye                     | known answers: σ = √N, σ(0) = 1; rate: 400 cps for 0.25 s gives σ = 40 cps; counts and the same data as a rate give the same σ (invariance) | Poisson statistics; GSAS-II's max(1, I) weighting for zero counts                                                          | 1e-12                                  | pass                          |
| .xy/.xye writer                | write then read back: every 2θ, intensity and σ identical, unit and wavelength recovered                                                    | round trip through the site's own reader                                                                                   | exact                                  | pass                          |
| In the browser                 | the three real formats load through the import worker in Chromium; the downloaded .xye has σ = √counts                                      | `npm run e2e`                                                                                                              | exact                                  | pass                          |

Open:

- Bruker .raw versions 1 to 3 are refused, not read: no real file of those versions is held
  (geddes has only authored RAW3 examples). Real files are needed to add them.
- No real .rasx file with an attenuator factor other than 1, nor a multi-scan .rasx or .brml, is
  held; those cases warn and load the first scan, untested on real data.
- The .raw counting time is not read: GSAS-II labels the field as milliseconds, but no second
  source confirms the unit.

## 16b: Pearson VII and split pseudo-Voigt peak shapes, Rietveld peak asymmetry

Formulas: src/core/xrd/peaks/profiles.ts (shapes, areas, derivatives), src/core/math/gamma.ts
(ln Γ), src/core/xrd/rietveld/model.ts (asymmetry). Tests: tests/xrd-peak-shapes.test.ts and
tests/rietveld.test.ts.

| Method                     | Check                                                                                                                                                                            | Source                                                                                                          | Tolerance                      | Result |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------ |
| ln Γ (Lanczos)             | 17 values from 0.05 to 170 against an independent implementation; Γ(n) = (n − 1)! for n ≤ 20; Γ(½) = √π; duplication formula at 8 points                                         | Python's `math.lgamma` (tests/fixtures/make_pearson_area.py, stdlib only); exact identities                     | 1e-13 relative                 | pass   |
| Pearson VII area           | closed form against numerical integration (tan substitution, full tails) for m = 1, 1.3, 2, 5, 20; against Python's value from `math.lgamma` for 11 values of m                  | numerical quadrature; Python                                                                                    | 1e-7 (quadrature), 1e-13       | pass   |
| Pearson VII limits         | m = 1 is the Lorentzian point by point; as m grows the curve approaches the Gaussian (max difference falls steadily, below 0.01 % of height at m = 10 000); FWHM = w for every m | exact limits of the formula                                                                                     | 1e-12; 1e-4                    | pass   |
| Split pseudo-Voigt         | wL = wR gives the symmetric pseudo-Voigt exactly; half height at x0 − wL/2 and x0 + wR/2; area against numerical integration of each side for η = 0, 0.3, 1                      | exact limit; quadrature                                                                                         | exact; 1e-10; 1e-7             | pass   |
| Equivalent η (Pearson VII) | η = 1 at m = 1, decreasing with m, towards 0 as m → ∞, capped at 1 for m < 1                                                                                                     | follows from matching FWHM and integral breadth                                                                 | 1e-12                          | pass   |
| Derivatives                | analytic profile gradient and the gradients of FWHM, η, area and breadth against central differences, 5 shapes × 6 positions                                                     | finite differences                                                                                              | 1e-5 relative                  | pass   |
| Fit, known answer          | noise-free Pearson VII (m = 1.8) and split pseudo-Voigt (wL 0.18°, wR 0.40°, η 0.45) recovered; with counting noise (3 and 2 seeds) the truth lies within 4σ                     | synthetic data                                                                                                  | 1e-5 relative (noise-free); 4σ | pass   |
| Fit, invariance            | shifting 2θ by 1.25° moves only the centre; scaling the counts by 3 scales only the heights                                                                                      | invariance                                                                                                      | 1e-5 relative                  | pass   |
| Asymmetry formula          | As(z) = 1 + [P1 Fa + P2 Fb]/tan θ, Fa = 2z e^(−z²), Fb = 2(2z² − 3) Fa, z = Δ2θ / FWHM; Fa, Fb are the Hermite H1, H3 × e^(−z²), both odd; As(0) = 1                             | FullProf manual, eq. 3.29 (read from the manual's PDF); Bérar and Baldinozzi, J. Appl. Cryst. 26 (1993) 128–129 | 1e-14                          | pass   |
| Asymmetry keeps the area   | three (P1, P2) pairs: summed profile unchanged, centroid moves (down for a < 0)                                                                                                  | invariance (odd correction × even profile)                                                                      | 1e-6 relative                  | pass   |
| Asymmetry, known answer    | CeO2 pattern, 20–90° made with P1 = −0.04, P2 = 0.006 and counting noise: refined P1 = −0.039 ± 0.007, P2 = 0.0056 ± 0.0008, χ² 0.99, R_wp 5.61 % (5.72 % without)               | synthetic data                                                                                                  | 4σ                             | pass   |
| Asymmetry, null test       | the same pattern made symmetric: P1 = 0.015 ± 0.009, P2 = 0.0005 ± 0.0009; off by default leaves both at 0, fixed                                                                | synthetic data                                                                                                  | 4σ                             | pass   |

Open:

- The peak fit is compared with lmfit and with Fityk on the same data, and with Fityk on a line
  of a measured pattern (section 18). FullProf is a closed-source program that could not be
  installed here; no comparison with it.
- The full reference of the Pearson VII paper ("The approximation of symmetric X-ray peaks by
  Pearson type VII distributions", Hall et al., J. Appl. Cryst. 1977) could not be opened to
  confirm the volume and pages, so the code cites it by title, authors and year only.
- The manual's 1/tan 2θ asymmetry terms (P3, P4) and its angle limit for the correction are not
  used; asymmetry applies to every peak with the 1/tan θ terms only.

## 16c: crystal structure viewer

Formulas: src/core/xrd/structure/geometry.ts (metric tensor, orthogonalisation, drawn cell,
bonds). Tests: tests/structure-geometry.test.ts. Covalent radii: data/reference/covalent-radii.json
(Cordero et al., Dalton Trans. 2008, 2832–2838, as tabulated in ASE; flagged for verification).

| Method              | Check                                                                                                                                               | Source                                                       | Tolerance               | Result |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------- | ------ |
| Distance and angle  | cubic edge, face and body diagonals; tetrahedral angle arccos(−1/3); hexagonal \|a + b\| = a and γ = 120°                                           | exact geometry                                               | 1e-10                   | pass   |
| Metric vs Cartesian | triclinic cell: lengths and angles from Cartesian coordinates equal those from G; Mᵀ M = G                                                          | independent route (orthogonalisation matrix)                 | 1e-10                   | pass   |
| Published geometry  | 250 bond lengths and angles from the _geom_bond and _geom_angle tables of 10 COD CIFs, rebuilt from the cell, operators and symmetry codes          | the authors' refinement programs (values printed in the CIF) | 3σ + 0.002 Å; 3σ + 0.1° | pass   |
| Drawn cell          | NaCl (Fm-3m): 14 Na and 13 Cl drawn (corners, faces, edges, centre), 8 atoms in the cell; every bond is Na–Cl = a/2                                 | exact                                                        | count exact; 1e-6 Å     | pass   |
| Invariance          | a pair moved by every operator, and by a lattice translation, keeps its distance                                                                    | invariance                                                   | 1e-10                   | pass   |
| Round trip          | operators written back to text and parsed again are identical; 70 stored library structures rebuild the same operators and atom count as their CIFs | round trip                                                   | exact                   | pass   |

Open:

- Symmetry codes with a three-digit operator number (GSAS numbering) and negative codes
  (SHELX style) in CIF geometry tables are skipped by the test, since the CIF dictionary does not
  define them; 250 rows remain.
- Distances are compared with pymatgen in section 16g. No comparison with VESTA (a desktop
  program that cannot be run here).

## 16d: indexing an unknown pattern

Formulas: src/core/xrd/indexing/index.ts (Q = 1/d² forms, trial cells, least squares, M20, F_N).
Worker: src/workers/indexing.worker.ts. Tests: tests/xrd-indexing.test.ts; independent figures
of merit from tests/fixtures/make_indexing_fom.py (standard library only).

| Method                  | Check                                                                                                                                                                                            | Source                                                           | Tolerance                   | Result |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------- | ------ |
| Known cells, exact      | 9 patterns calculated from COD cells (CeO2, In2O3, LaB6 cubic; rutile, anatase tetragonal; ZnO, h-BN hexagonal; aragonite, brookite orthorhombic), first 20 lines: the true cell is suggestion 1 | synthetic data from tests/fixtures/cod-reference                 | edges 0.01 %; 0 unindexed   | pass   |
| Noise and missing lines | the same 9 with Gaussian noise σ = 0.01° 2θ and two lines removed: the true cell is still suggestion 1                                                                                           | synthetic data                                                   | edges 0.2 %                 | pass   |
| M20 and F_N             | 5 cells (cubic F, tetragonal P and I, hexagonal P, orthorhombic P): indexed count, N_calc, M20, F_N and mean \|Δ2θ\| against a separate Python implementation (all index signs, general metric)  | independent implementation; de Wolff 1968; Smith and Snyder 1979 | exact counts; 1e-6 relative | pass   |
| Invariance              | the input order does not change the result; the same d-spacings with Co Kα1 give the same cell; every listed hkl reproduces its calculated 2θ from the reported cell                             | invariance and round trip                                        | identical; 0.001 Å; 1e-8°   | pass   |
| Worker                  | the worker posts progress and the same solutions as a direct call                                                                                                                                | round trip                                                       | identical                   | pass   |

Decisions that affect the figures:

- Mean discrepancies below 0.001° 2θ are raised to 0.001° (a measured position is not more
  precise), so error-free data do not divide by zero.
- A tetragonal cell with c/a = 1 or √2, or an orthorhombic cell with two edges in the ratio 1, √2
  or √3, is dropped because its lattice has higher symmetry (cubic, tetragonal or hexagonal) and
  that search reports it. Without this, error-free data ranked such lower-symmetry descriptions of
  the same lattice first.
- N_calc counts the lines allowed by the lattice centring (P, I, F, C), not by a space group, so
  the figures are lower than a program that applies space-group absences would give.

Open:

- GSAS-II's indexing is compared on the same lines in section 18. DICVOL, TREOR and McMaille are
  not packaged and could not be installed here, and no measured pattern of an unknown has been
  indexed by two programs; both are still open.
- A pattern with fewer than 10 lines is refused: with 6 lines body-centred cubic and primitive
  cubic at a/√2 index identically (iron, checked).

## 16e: Rietveld structure refinement and GSAS-II export

Formulas: src/core/xrd/rietveld/structure.ts (free directions, structure factor, restraints),
model.ts and refine.ts (stages, restraint rows, uncertainties), src/core/xrd/export/gsas.ts
(TCH conversion, .instprm, CIF). Tests: tests/rietveld-structure.test.ts and
tests/gsas-export.test.ts.

| Method                    | Check                                                                                                                                                                     | Source                                                             | Tolerance                          | Result |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------- | ------ |
| Free coordinates          | null space of R − I: none at an inversion centre, (1, 1, 1) on a 3-fold axis; rutile Ti 0 and O (x, x, 0) 1 direction, anatase O (0, 0, z), brookite 3 per atom           | exact (site symmetry tables)                                       | exact                              | pass   |
| Σ\|F\|² from the atoms    | the refinement's structure factors at the start equal the library Σ\|F\|² for rutile, anatase, brookite, CeO2 and ZnO (all lines above 1 % of the strongest)              | independent implementation (reference/powder.ts, whole-cell route) | 0.2 % (5-figure storage)           | pass   |
| Absences kept             | rutile 0 0 1 and 1 0 0 stay absent after moving O along its free direction                                                                                                | invariance                                                         | \|F\|² < 1e-12                     | pass   |
| Positions and B recovered | brookite with all 9 coordinates moved by up to 0.004 and B = 0.5 Å², with counting noise: refined from the file values back to the truth                                  | synthetic data                                                     | 4 s.u. + 2e-4; B 4 s.u. + 0.1 Å²   | pass   |
| Occupancy recovered       | brookite O2 at 0.8 in the data, 0.9 in the file: refined to 0.8; full sites stay at 1 and are not refined                                                                 | synthetic data                                                     | 4 s.u. + 0.005                     | pass   |
| Restraints                | zero residual at the start; with restraints the refined bonds stay within 4σ (0.08 Å) of the start                                                                        | synthetic data                                                     | 4σ                                 | pass   |
| No change, no move        | the unperturbed structure refines to itself                                                                                                                               | invariance                                                         | 4 s.u. + 1e-4                      | pass   |
| TCH conversion            | TCH limits (pure Gaussian, pure Lorentzian); for η = 0, 0.2, 0.5, 0.8, 1 the GSAS-II profile gives this site's FWHM and η over 20–90° 2θ; η = 0 gives σ² = FWHM²/(8 ln 2) | round trip; TCH formulas as in GSAS-II's GSASIIpwd.py (getgamFW)   | FWHM 2 %, η 0.02; exact for η = 0  | pass   |
| .instprm layout           | first line contains GSAS-II, comments only before the values, every key GSAS-II's lab default file has (Type, Bank, Lam1, Lam2, I(L2)/I(L1), Zero, Polariz., …)           | GSAS-II source (GSASIIfiles.py ReadInstprm, defaultIparms.py)      | all keys present                   | pass   |
| CIF round trip            | the CIF of rutile, anatase, brookite, CeO2, ZnO and calcite read back by this site's CIF reader gives the same cell, operators, atoms and powder pattern                  | round trip                                                         | identical; d 1e-4 Å; Σ\|F\|² 0.1 % | pass   |

Conventions checked in the GSAS-II source: 2θ_obs = 2θ_calc + Zero (same sign as here);
Polariz. 0.5 is an unpolarised beam, matching this site's Lorentz–polarisation factor. SH/L is
written as GSAS-II's default 0.002, because this site's asymmetry model (Bérar–Baldinozzi) is
not the same.

Open:

- GSAS-II refining the same pattern is compared in section 16g, and the files written by the
  Export step (.xye, .instprm, CIF) are loaded into GSAS-II in section 18. This was done through
  GSAS-II's scripting interface, which uses the same readers as its windows; loading them once
  by hand in the GSAS-II program is still worth doing.
- The synthetic patterns are made with this site's own model, so the recovery checks test the
  least squares, not the model; the model's Σ|F|² is checked against the independent library
  route above.

## 16g: owner additions (TCH profile, anisotropic U_ij, monoclinic and triclinic indexing, CI checks)

Formulas: src/core/xrd/rietveld/tch.ts and model.ts (TCH), structure.ts (U_ij constraints,
image tensors, positive definiteness), src/core/xrd/indexing/index.ts (general metric, reduced
cells, zone trials). Tests: tests/rietveld-tch.test.ts, tests/rietveld-aniso.test.ts,
tests/xrd-indexing.test.ts, tests/validation-gsas2.test.ts, tests/validation-pymatgen.test.ts.
The GSAS-II and pymatgen fixtures are made on GitHub by .github/workflows/validation.yml
(GSAS-II built from source at commit 2c62562; pymatgen from PyPI, version in the fixture).

| Method                        | Check                                                                                                                                                                                                                                                                                                                  | Source                                                        | Tolerance                                                                                     | Result |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ |
| TCH profile                   | each peak gets the TCH FWHM and η of its Gaussian and Lorentzian parts; U, V, W, X, Y recovered from a synthetic CeO2 pattern with noise                                                                                                                                                                               | synthetic data; TCH formulas as in GSAS-II                    | 4 s.u. + 1e-4                                                                                 | pass   |
| TCH against GSAS-II           | anatase and rutile simulated in GSAS-II with U, V, W, X, Y of cu.instprm: this site recovers them after the unit conversion (σ² centideg² → FWHM² deg², γ centideg → deg)                                                                                                                                              | independent implementation (GSAS-II)                          | 4 s.u.                                                                                        | pass   |
| U_ij site constraints         | free terms: rutile 3 and 3, anatase 2 and 3, CeO2 1 and 1, brookite 6 each; R u Rᵀ = u for every operator of the site                                                                                                                                                                                                  | exact (site-symmetry rules); invariance                       | exact, 1e-12                                                                                  | pass   |
| Isotropic as a tensor         | brookite with U_iso and with the same U as a tensor gives the same \|F\|²                                                                                                                                                                                                                                              | invariance                                                    | 1e-10 relative                                                                                | pass   |
| U_ij recovered                | synthetic rutile with shifted U_ij refined back (noise-free); positive definite                                                                                                                                                                                                                                        | synthetic data                                                | 2e-4 Å²                                                                                       | pass   |
| Structure against GSAS-II     | GSAS-II simulated anatase (O z + 0.003, U_iso Ti 0.006, O 0.012 Å²) and rutile (O x + 0.002, U_ij of both atoms) with Poisson noise; this site, from the COD file, recovers positions and U within 4 s.u. and agrees with GSAS-II's own refinement of the same data within 3 s.u. + 1e-5; R_wp within 5 % of GSAS-II's | independent implementation (GSAS-II); synthetic data          | 4 s.u.; 3 s.u. + 1e-5                                                                         | pass   |
| Distances against pymatgen    | every interatomic distance up to 3.2 Å from each site of rutile, anatase, tenorite and baddeleyite                                                                                                                                                                                                                     | independent implementation (pymatgen Structure.get_neighbors) | 1e-4 Å (5 decimals)                                                                           | pass   |
| Powder lines against pymatgen | same lines (d within 1e-5 Å) for the same four CIFs, Cu Kα1, 10–100° 2θ, no displacement factors; relative intensities within 5 of 100 (worst: rutile 4.0, baddeleyite 2.0, tenorite 1.7, anatase 0.6)                                                                                                                 | independent implementation (pymatgen XRDCalculator)           | d 1e-5 Å; intensity 5 %                                                                       | pass   |
| Monoclinic, triclinic index   | exact lines of baddeleyite, bismite, WO3, tenorite (C) and PET (triclinic, from data/reference/polymers.json) give the reference lattice first; with noise and two missing lines it stays in the top 3                                                                                                                 | synthetic data                                                | same lattice: volume and every calculated line (exact 1e-4 and 0.002°; noisy 0.3 % and 0.05°) | pass   |
| Figures of merit              | M20 and F_N of the low-symmetry cells against the independent Python implementation (tests/fixtures/make_indexing_fom.py, now with the general reciprocal metric)                                                                                                                                                      | independent implementation                                    | 1e-6 relative                                                                                 | pass   |
| Setting invariance            | bismite in another setting (c′ = c + a) and described as triclinic gives the same reduced cell and figures of merit; PET hkl checked by Cramer's rule                                                                                                                                                                  | invariance; independent solve                                 | M20 6 decimals; 2θ 8 decimals                                                                 | pass   |

Decisions that affect the figures:

- GSAS-II's anomalous dispersion (f′, f″, always on for X-rays) and its default sample
  broadening (size 1 µm, microstrain 1000, both Lorentzian) are switched off in the simulation,
  because this site's model has neither; with them on, X and Y absorbed the sample broadening
  (found on the first run).
- When a lattice is found in two systems, it is reported once, in the higher symmetry, and a
  lower-symmetry cell must beat a higher-symmetry one by a factor of 2 in M20 to be listed first
  (SYMMETRY_MARGIN, a ranking choice of this site, not from the literature). Triclinic is
  searched only when ticked.
- Bismite (α-Bi2O3) is pseudo-orthorhombic C (2c + a ⟂ a to about 0.03°), so with noisy positions
  it is asserted in the top 3, not first.

Open:

- COD 9015929 (anatase) lists its U_ij values in the order U11, U12, U13, U22, U23, U33 under the
  headers U11, U22, U33, U12, U13, U23 (U22 = U33 = 0 for Ti). The library uses the file as it is;
  the owner should decide whether to correct it. Both GSAS-II and this site read it literally.
- Monoclinic cells are compared with GSAS-II in section 18. No comparison with DICVOL, TREOR or
  McMaille, and none for triclinic cells.
- Triclinic indexing needs the first lines of the pattern; it can give spurious cells.

## 17: review fixes (calculated example, peak labels, sample comparison, sample report)

Code: src/core/xrd/synthetic.ts (example patterns), src/modules/xrd/data.ts (lines of the example
phase), src/core/xrd/reference/symmetry.ts (which member of a family of planes is printed),
src/modules/xrd/comparison.ts, src/ui/report/sampleReport.ts. Tests: tests/xrd-checks.test.ts,
tests/reference-cif.test.ts, tests/comparison.test.ts, tests/sampleReport.test.ts,
tests/validation-lmfit.test.ts. The lmfit fixtures are made by
scripts/validation/lmfit/make_peakfit.py (lmfit 1.3.4, scipy 1.18.1, numpy 2.5.4).

| Method                 | Check                                                                                                                                                                                                                                                                       | Source                                                   | Tolerance                                 | Result |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------- | ------ |
| Peak fit against lmfit | two overlapping pseudo-Voigt peaks on a sloped background, and one Pearson VII peak, with counting noise, fitted by lmfit's built-in models and by this site: centres agree to 2e-7°, FWHM to 1e-7°, η to 7e-6, m, heights and areas to 4e-6 relative                       | independent implementation (lmfit, SciPy least squares)  | 2e-5°; 1e-4°; η and m 2e-3; 1e-3 relative | pass   |
| Calculated example     | one line of the example at 36.3°, built for 60 nm and for 15 nm: the Kα1 + Kα2 fit, corrected for the example instrument width in quadrature, gives the size back through L = Kλ/(β cos θ); line positions of the bundled example come from COD 1577381 through Bragg's law | synthetic data with a known answer                       | 5 % of the size                           | pass   |
| Sample comparison      | each row equals the per-pattern summary (same functions); doubling every width halves the Scherrer size                                                                                                                                                                     | invariance (D ∝ 1/β); same result by two routes          | exact; 1e-10                              | pass   |
| Sample report          | result lines and methods paragraphs are passed through unchanged; example data are named in a warning                                                                                                                                                                       | round trip                                               | exact                                     | pass   |
| Printed (hkl)          | of a family of equivalent planes the member with the fewest negative indices, then the largest h, k, l is printed: (110), not (2 -1 0), for wurtzite                                                                                                                        | convention only; positions and intensities are untouched | exact                                     | pass   |

Open:

- The example data of every tool are calculated or generated, and labelled so. No measured
  standard (LaB6 or Si) is bundled: the owner must supply one, with its source, before a measured
  example can be shown.
- The sample comparison and the sample report add no numerical method; they collect results that
  are validated above.
- Several open items of sections 16a to 16e were worked on in section 18; what is left is listed
  there.

## 18: open items checked with Fityk and GSAS-II (owner request, November 2026)

The owner asked for the open items above to be validated. Fityk 1.3.2 (Debian package) and
GSAS-II (built from source at commit 2c62562) were installed in the session container and used
as independent programs. Scripts: scripts/validation/fityk/ (peakfit.fit, make_peakfit.py),
scripts/validation/gsas2/load_export.py, index_cells.py and indexing.py. Tests:
tests/validation-lmfit.test.ts, tests/validation-gsas-export.test.ts, tests/xrd-indexing.test.ts.
Fixtures: tests/fixtures/validation/peakfit-fityk.json, peakfit-real.xy, gsas-export.json,
indexing-lines.json, indexing-gsas2-refined.json, indexing-gsas2.json.

| Method                             | Check                                                                                                                                                                                                                                                                               | Source                                           | Tolerance                                 | Result                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------- |
| Peak fit against Fityk             | the two synthetic data sets of section 17 (two overlapping pseudo-Voigt peaks; one Pearson VII peak) fitted by Fityk (MPFIT, unweighted) and by this site                                                                                                                           | independent program (Fityk 1.3.2)                | 2e-5°; 1e-4°; η and m 2e-3; 1e-3 relative | pass                                                                   |
| Peak fit on a measured pattern     | 41 to 45° 2θ of the measured pattern tests/fixtures-real/bruker4_v5converter.raw (196 points, one line of about 88,000 counts on a straight background), one pseudo-Voigt: centre 43.0276°, FWHM 0.4936°, η 0.549 in Fityk, the same here                                           | independent program on real data                 | as above                                  | pass                                                                   |
| .xye read by GSAS-II               | the .xye of the Export step (5,501 points): GSAS-II reads every point and the same σ                                                                                                                                                                                                | GSAS-II's reader                                 | exact count; σ 1e-6                       | pass                                                                   |
| .instprm read by GSAS-II           | GSAS-II reads Lam1, Lam2, I(L2)/I(L1), Zero, Polariz., U, V, W, X, Y as written                                                                                                                                                                                                     | GSAS-II's reader (ReadInstprm)                   | 1e-7 relative (8 figures written)         | pass                                                                   |
| CIF read by GSAS-II                | space group I 41/a m d, cell, atoms, occupancies and U_iso of the refined anatase as written; GSAS-II moves the atoms from origin choice 1 to its origin choice 2 by itself, so positions are compared relative to the first atom                                                   | GSAS-II's CIF reader                             | cell 1e-6 relative; positions 1e-6        | pass                                                                   |
| Exported model in GSAS-II          | GSAS-II calculates the pattern from the three files with only its scale and background refined: R_wp 4.451 % (this site 4.493 %; GSAS-II's own full refinement of the same data 4.449 %); continuing the refinement in GSAS-II moves the cell by less than 2e-5 relative            | GSAS-II                                          | R_wp within 5 % relative; cell 2e-5       | pass                                                                   |
| Suggested cells indexed by GSAS-II | 13 noisy line lists (σ 0.01° 2θ, two lines removed: 9 cubic to orthorhombic, 4 monoclinic): with the cell this site suggests, GSAS-II indexes every line, and its least-squares refinement gives the same cell (largest difference 3.4e-4 relative, c of tenorite; others ≤ 2.6e-4) | GSAS-II (GSASIIindex.refinePeaks, GSASIIlattice) | 0 unindexed; 5e-4 relative                | pass                                                                   |
| GSAS-II's own search, same lines   | GSAS-II's Monte Carlo search (default controls, every Bravais lattice up to orthorhombic, monoclinic for the monoclinic cases, 60 s per lattice) lists a cell with this site's edges, see the notes below                                                                           | another indexing program                         | edges 0.2 %                               | pass, 10 of 13 with the same edges; 3 as a multiple or another setting |

What was found:

- A fault in the exported .instprm was found and fixed. GSAS-II refused the file: its reader skips one
  comment line and reads the next line as values, and the file had two or three comment lines.
  The notes are now written on the first line only. The earlier test had checked the layout
  against a reading of the GSAS-II source, not against GSAS-II.
- GSAS-II's search lists every cell it finds by M20 and leaves the choice to the user. It does
  not rank by symmetry, so the cell with the highest M20 is often a lower-symmetry description
  or a multiple of the true cell. The comparison is therefore "does GSAS-II's list contain this
  site's cell", not "is it first".
- In GSAS-II's search, 10 of the 13 cases list a cell with this site's edges: In2O3, rutile,
  anatase, ZnO, h-BN, baddeleyite, WO3 and tenorite directly; LaB6 as a tetragonal cell with
  c = a to 0.07 % and CeO2 as an orthorhombic cell with three equal edges to 0.06 % (its cubic
  searches, started from the default volume, did not reach these two cells).
- For the other three GSAS-II lists the same lattice differently: aragonite as a doubled cell
  (2a, b, 2c, A-centred), brookite with 3c, and bismite as its pseudo-orthorhombic C-centred
  cell (β = 90.05°, twice the volume). This site lists the primitive cell for all three; that
  cell indexes every line in GSAS-II too (row above).

Open:

- FullProf (closed source), DICVOL, TREOR and McMaille (not packaged) could not be installed.
- VESTA is a desktop program with no scripting interface, so structures cannot be opened in it
  here. Distances and powder lines are checked against pymatgen instead (section 16g).
- Bruker .raw versions 1 to 3, multi-scan .rasx and .brml files, and a .rasx with an attenuator
  factor: no real, openly licensed file is held, and a reader is written only against real files.
- The GSAS-II files were loaded through GSAS-II's scripting interface, not by hand in its
  windows.
- No measured pattern of an unknown phase has been indexed by two programs.
- The Fityk, lmfit and indexing fixtures are made by hand with the scripts above (the GSAS-II
  search is a random search with a time limit, so a rerun can list different cells); only
  load_export.py runs in .github/workflows/validation.yml.
