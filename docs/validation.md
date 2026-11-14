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

## 17a: Rietveld sample broadening, optics, Le Bail and statistics

Formulas: src/core/xrd/rietveld/sample.ts (polarisation, monochromator, Suortti roughness,
transparency, variable slit, size and microstrain), statistics.ts (Durbin–Watson, correlations,
internal standard), refine.ts (fixed instrument, excluded ranges, Le Bail extraction), model.ts
(profile window), export/gsas.ts (.instprm reader). Tests: tests/rietveld-sample.test.ts,
tests/validation-gsas2-sample.test.ts, tests/rietveld-gsas.test.ts, tests/gsas-export.test.ts.
Every formula was written from GSAS-II's own source (commit 2c62562: GSASIIpwd.Polarization,
SurfaceRough, getWidthsCW; GSASIIstrMath.GetSampleSigGam, GetReflPos), not from memory.

| Method                                | Check                                                                                                                                                                                                                                                       | Source                                                         | Tolerance                                | Result                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Polarisation P                        | P = 0.5 equals 1 + cos²2θ; GSAS-II's (1 − P)cos²2θ + P written out; monochromator form (1 + K cos²2θ)/(1 + K) for mosaic and perfect crystals; 2θ_m = 0 gives P = 0.5                                                                                       | GSAS-II Polarization(); textbook monochromator factor          | 1e-14                                    | pass                                                                                              |
| Surface roughness, slit, transparency | value 1 at 2θ = 180°, for A = 1 and for B = 0; GSAS-II's SurfaceRough() written out; sin θ slit factor; T sin 2θ                                                                                                                                            | GSAS-II source                                                 | 1e-14                                    | pass                                                                                              |
| Size and microstrain widths           | against GSAS-II's GetSampleSigGam (centidegrees) at four angles, for mixing 1 and 0.3; Scherrer with K = 1                                                                                                                                                  | GSAS-II source                                                 | 1e-12                                    | pass                                                                                              |
| Invariance                            | P = 0.5, smooth surface, no size or strain: pattern identical to the earlier model                                                                                                                                                                          | —                                                              | exact                                    | pass                                                                                              |
| Known-answer recoveries               | synthetic CeO2 with a fixed instrument: size 35 nm and strain 900; transparency −0.04° with a monochromator and size 80 nm; roughness B = 0.12                                                                                                              | the site's own model with noise                                | 4 s.u. (B: + 0.01)                       | pass                                                                                              |
| Uncertainties                         | six noise realisations of one pattern: every s.u. of the size within 20 % of the others, RMS of (deviation / s.u.) between 0.2 and 2                                                                                                                        | repeated noise                                                 | as stated                                | pass                                                                                              |
| **Against GSAS-II (Rietveld)**        | CeO2 simulated by GSAS-II (size 40 nm, μ 1200, P 0.6, SurfRoughB 0.12, Transparency 2.0) with Poisson noise, refined here with the same fixed instrument; GSAS-II refined the same data                                                                     | `scripts/validation/gsas2/sample.py`, fixture `ceria-sample.*` | 3 s.u. of truth and of GSAS-II; R_wp 2 % | size 40.04(6) nm (GSAS-II 40.05(6)); μ 1196(12) (1216(12)); R_wp 1.858 % (1.850 %); a 1σ of truth |
| **Against GSAS-II (Le Bail)**         | the same data, Le Bail with size and strain, here and in GSAS-II                                                                                                                                                                                            | as above                                                       | size, μ 2 s.u.; a 1e-4 Å; R_wp 3 %       | size 39.92(11) (39.94(11)); μ 1183(21) (1197(21)); R_wp 3.40 % (3.46 %)                           |
| Le Bail extraction                    | a pattern with strong preferred orientation the model is not told about: Rietveld χ² > 3, Le Bail χ² < 1.2 with the true cell and size; extracted intensities equal the observed (partitioned) ones within 2 %, the true ones within 1.5 % for strong lines | synthetic                                                      | as stated                                | pass                                                                                              |
| Excluded ranges                       | a foreign peak spoils R_wp by > 1.5×; excluding its range gives the clean R_wp within 0.002 and the same size                                                                                                                                               | synthetic                                                      | as stated                                | pass                                                                                              |
| Durbin–Watson d                       | alternating residuals give 3; 20,000 independent normal values give 2 ± 0.05; a slow wave gives < 0.01; a well-fitted synthetic pattern gives 1.8 to 2.2                                                                                                    | definition (Durbin and Watson, Biometrika 37 (1950) 409)       | as stated                                | pass                                                                                              |
| Correlations                          | a 3 × 3 covariance with known r = 0.95, −0.1, 0.99: pairs found and ordered                                                                                                                                                                                 | hand calculation                                               | 1e-12                                    | pass                                                                                              |
| Internal standard                     | known mixture (30 % amorphous, 20 % standard) recovered exactly; equals (1 − W_s/R_s)/(1 − W_s); s.u. against finite differences; GSAS-II anatase + rutile mixture with rutile as a standard at its true fraction gives A = 0 within 3 s.u.                 | derivation in statistics.ts; GSAS-II mixture fixture           | 1e-12; 1e-6; 3 s.u. + 0.005              | pass                                                                                              |
| .instprm reader                       | GSAS-II's cu.instprm converted to the site's units; write then read round trip; wrong types refused                                                                                                                                                         | inverse of tchExact (16e)                                      | 1e-9                                     | pass                                                                                              |
| In the browser                        | e2e chooses a graphite monochromator, refines crystallite size with an excluded range; the methods text names them; the .instprm carries P = 0.55…; no sideways scroll at 360 px                                                                            | `npm run e2e`                                                  | —                                        | pass                                                                                              |

Found and fixed by these checks:

- The profile window (±25 FWHM) dropped about 1.3 % of a Lorentzian's area and biased the size and
  strain of Lorentzian peaks by about 1 % (6 s.u.) against GSAS-II. It now reaches 50 F below and
  75 F above each peak as GSAS-II's getWidthsCW does.
- Window edges moved with each finite-difference step, so a point crossing an edge gave a huge
  derivative; one seed reported a size s.u. 13× too small. Derivatives now reuse the unshifted
  windows.

Open items of 17a, resolved (November 2026):

- **Surface roughness B 1 % low against the GSAS-II truth.** First suspected cause, the scattering
  factors, ruled out: GSAS-II's |F|² of every CeO2 reflection (now written to the fixture) equals
  the site's within 5 × 10⁻⁵ (test). The cause is a convention: GSAS-II evaluates the Lorentz,
  polarisation and roughness factors at the Kα1 angle for both lines (GetIntensityCorr uses the
  Kα1 position); the site uses each line's own angle, which is physically exact. With GSAS-II's
  convention switched on (`correctionsAtKAlpha1`, validation only), B = 0.11945(27) against
  GSAS-II's 0.11967(17), transparency and R_wp also agree within 2 s.u. and 0.5 % (test). The
  default stays exact; on GSAS-II-made data it gives B 0.6 % lower, within the 1.5 % test bound.
- **Le Bail cell 6e-5 Å from GSAS-II's.** Both fits left the transparency out, so both absorbed its
  2θ shift into the cell, each in its own way. GSAS-II now also runs a Le Bail fit with the
  transparency refined: its cell is 5.410991 Å, and the site's agrees within 3 s.u. and with the
  true 5.411 Å; size, strain and transparency agree within 2 s.u. (test).
- **Monochromator spacings**, now from COD: graphite c = 6.711 Å (COD 9011577, so d(002) = 3.3555 Å,
  not the 3.354 Å used before) and germanium a = 5.65754 Å (COD 9011050). A change of 0.005 Å
  moves P by less than 2 × 10⁻⁴ (test). The polarisation formulas are now sourced: Morelhão et
  al., arXiv:1911.00396 (supporting information of J. Phys. Chem. C 123 (2019) 24818), section S3:
  cos²2θ_m for kinematical (mosaic) diffraction, at most cos 2θ_m for a thick perfect crystal
  (0.675 against 0.703 for Ge 220 with Cu Kα1), so the germanium preset is an upper limit and the
  app says so.
- **Hill and Flack citation.** Crossref (DOI 10.1107/S0021889887086485) gives J. Appl. Cryst. 20
  (1987) 356–361. The listing with pages 362–365 was the next paper in the issue (Stothart, DOI
  10.1107/S0021889887086473).

## 17b: shared-site substitution (doping) and Le Bail of an indexed cell

Formulas: src/core/xrd/rietveld/structure.ts (site factor (1 − x)·f_host + x·f_dopant, special
positions, cell contents), refine.ts (fraction stage, Le Bail start), indexing/latticePhase.ts
(centring conditions, lattice reflections, phase from an indexing suggestion). Tests:
tests/rietveld-substitution.test.ts, tests/validation-gsas2-substitution.test.ts,
tests/indexed-lebail.test.ts, tests/report.test.ts.

| Method                           | Check                                                                                                                                                                                                                                                                         | Source                                                                     | Tolerance                                             | Result                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Site factor                      | x = 0 gives the host structure, x = 1 the dopant on the site; a dopant of the host element changes nothing for any x; F linear in x                                                                                                                                           | definition                                                                 | 1e-8 to 1e-12                                         | pass                                                                       |
| Special positions                | ZnO's 0.3333, 0.6667 (and 0.333) snapped to 1/3, 2/3 so every image under the stabiliser coincides; a free z and a general position unchanged                                                                                                                                 | invariance                                                                 | 1e-14                                                 | pass                                                                       |
| Cell contents and masses         | 2 Zn sites with x = 0.15 give 1.7 Zn and 0.3 Mg per cell                                                                                                                                                                                                                      | hand calculation                                                           | 1e-12                                                 | pass                                                                       |
| Known-answer recovery            | synthetic Zn₀.₈₅Mg₀.₁₅O refined from x = 0.05                                                                                                                                                                                                                                 | the site's own model with noise                                            | 4 s.u.                                                | pass                                                                       |
| **Against GSAS-II (\|F\|²)**     | GSAS-II's \|F\|² of every Zn₀.₈₅Mg₀.₁₅O reflection (Zn and Mg atoms on one site, Frac 0.85 and 0.15)                                                                                                                                                                          | `scripts/validation/gsas2/substitution.py`, fixture `znmgo-substitution.*` | 5e-5 relative                                         | pass                                                                       |
| **Against GSAS-II (refined x)**  | the same simulated pattern with Poisson noise, refined here and in GSAS-II (constraints Frac(Zn) + Frac(Mg) = 1, equal U_iso), both from x = 0.05                                                                                                                             | as above                                                                   | 3 s.u. of truth and of GSAS-II; s.u. ± 25 %; R_wp 3 % | x 0.1530(43) (GSAS-II 0.1533(43), truth 0.15); R_wp 4.793 % (4.831 %)      |
| Centring conditions              | I, F, C, A and P against hand-checked reflections                                                                                                                                                                                                                             | International Tables A, lattice conditions                                 | exact                                                 | pass                                                                       |
| Lattice reflections              | for every phase of the COD-derived library, each library line (calculated from the full space-group operators, reference/powder.ts) is among the lattice reflections of its cell and centring, with multiplicity no larger                                                    | independent code path (operators vs. centring rules)                       | d within 2e-5 relative                                | pass                                                                       |
| Lattice reflections (Fm-3m)      | CeO₂, NaCl, Au, MgO and CaF₂, whose only condition is the F centring: the lattice list equals the library list, line for line, with the same multiplicities                                                                                                                   | as above                                                                   | d 1e-5 Å, m exact                                     | pass                                                                       |
| **Le Bail of an indexed cell**   | the GSAS-II CeO₂ pattern (17a) fitted from an F cell 0.05 % off: same cell and R_wp as the library phase, cell within 3 s.u. of GSAS-II's Le Bail                                                                                                                             | GSAS-II fixture `ceria-sample.*`                                           | a 1e-6 Å of the library fit; 3 s.u.                   | pass                                                                       |
| Le Bail with an unknown centring | the same pattern from a P cell: converges, a within 1 s.u. and size within 1 % of the F fit, every reflection F forbids below 0.5 % of the strongest, R_wp within 5 %                                                                                                         | as above                                                                   | as stated                                             | a 2.7e-6 Å (0.2 s.u.); size 39.93 against 40.00 nm; R_wp 1.903 % (1.852 %) |
| Methods text                     | an indexed phase is described as a cell from indexing with no structure, a structure phase as before, the peak-assignment sentence once                                                                                                                                       | —                                                                          | exact text                                            | pass                                                                       |
| Step 3 button                    | “Use as a phase” on an indexing suggestion (worker mocked) adds a candidate with origin “indexed”, its lattice reflections from 111, and the status line; e2e does the same when the example pattern can be indexed (it has too few peaks today, so e2e only shows the panel) | tests/materialStep.test.tsx                                                | —                                                     | pass                                                                       |

Found and fixed by these checks:

- A P cell starts with equal intensities for every reflection, most of them absent from the data.
  The first background fit then went strongly negative under the many empty reflections and the
  Le Bail cycles diverged (R_wp 89 %). Each starting-width trial now first extracts the
  intensities ten times against the flat starting background, keeping the best trial's
  intensities; the library-phase Le Bail results moved by less than 0.1 %.
- The ZnO CIF gives 0.3333 and 0.6667, which left the |F|² up to 1.5e-3 from GSAS-II's (which
  snaps atoms to special positions); positions within 2e-3 of a special position are now moved
  onto it.
- `rietveld-gsas.test.ts` took 5.9 s against the 5 s default timeout; it now has 60 s like the
  other refinement tests.

The P-cell R_wp is 2.7 % above the F-cell's: Le Bail's partition is not a least-squares estimate,
and the near-empty reflections cost a little. The app's Le Bail warning says that a good R_wp
does not show that the phase is right; for an indexed cell it confirms the cell only.

## 17c: anisotropic size and microstrain, Finger–Cox–Jephcoat axial divergence

Formulas: src/core/xrd/rietveld/fcj.ts (FCJ profile as GSAS-II's PSVFCJO with S/L = H/L = SH/L/2),
broadening.ts (uniaxial size and microstrain, Stephens terms of every Laue class, Laue class from
crystal system and space group), model.ts (family members with different widths placed as
separate peaks, FCJ summed over its nodes), refine.ts (stages, starting values), gsas.ts (SH/L in
and out of .instprm). Tests: tests/rietveld-broadening.test.ts,
tests/validation-gsas2-anisotropic.test.ts, tests/gsas-export.test.ts.

| Method                                    | Check                                                                                                                                                                                                                                                                                       | Source                                                            | Tolerance                              | Result                                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FCJ area                                  | node weights sum to 1; area within a ±4° window equals the symmetric pseudo-Voigt's, at 10°, 30°, 70°, 140°                                                                                                                                                                                 | definition                                                        | 1e-12; 1e-4                            | pass                                                                                                                                                                                                                     |
| FCJ limit                                 | SH/L = 0 is the symmetric pseudo-Voigt; SH/L = 1e-5 differs by < 1e-4 of the peak height                                                                                                                                                                                                    | definition                                                        | as stated                              | pass                                                                                                                                                                                                                     |
| FCJ mirror symmetry                       | the profile at 2θ and 180° − 2θ are mirror images (centroid shifts equal and opposite); the shift grows with SH/L and falls with 2θ below 90°                                                                                                                                               | invariance (cos 2θ changes sign)                                  | 1e-6°                                  | pass                                                                                                                                                                                                                     |
| **FCJ against GSAS-II**                   | 24 profiles: 2θ 8°, 30°, 80°, 140°; SH/L 0.005, 0.03; (sig, gam) (2, 1), (20, 8), (5, 0) centideg; 401 points each                                                                                                                                                                          | `scripts/validation/gsas2/anisotropic.py`, GSASIIpwd.getFCJVoigt3 | 2e-3 of the peak height                | pass                                                                                                                                                                                                                     |
| **Stephens terms against GSAS-II**        | names and the terms at five (h k l) for m3m, 6/mmm, 3m1, 31m, 3R, 4/mmm, mmm, 2/m (a, b, c), −1                                                                                                                                                                                             | GSASIIspc.MustrainNames, MustrainCoeff                            | exact                                  | pass (GSAS-II's 3R third term, with lk³ twice and no hk³, is copied as written)                                                                                                                                          |
| Stephens from isotropic μ                 | the least-squares coefficients give μ = 1500 for every (h k l) up to 3 3 3 in cubic, hexagonal, −31m, tetragonal, orthorhombic, monoclinic and triclinic metrics                                                                                                                            | invariance                                                        | 1e-6                                   | pass                                                                                                                                                                                                                     |
| Stephens symmetry                         | images of (1 0 2) under 6/mmm and of (1 2 3) under m3m give the same strain                                                                                                                                                                                                                 | invariance                                                        | 1e-9                                   | pass                                                                                                                                                                                                                     |
| Uniaxial models                           | equal values are isotropic; along the axis the axial value, across it the equatorial; cos φ in the hexagonal reciprocal metric (0°, 90°, 30°)                                                                                                                                               | definition                                                        | 1e-9 to 1e-14                          | pass                                                                                                                                                                                                                     |
| **Per-reflection widths against GSAS-II** | Gaussian variance and Lorentzian width of every ZnO reflection, 20–130°, for (a) uniaxial size along [1 0 0] (0.05, 0.12 µm, mix 0.6) with uniaxial microstrain along [1 0 2] (800, 2500, mix 0.3), (b) isotropic size with Stephens microstrain (mix 0.5); zero-cycle GSAS-II calculations | as above, reflection list columns 6 and 7                         | 1e-6 relative                          | pass                                                                                                                                                                                                                     |
| Known-answer recovery                     | noise-free ZnO pattern made by this site's model with SH/L 0.025, size 80 nm, uniaxial microstrain 600 and 2200 × 10⁻⁶ along [0 0 1]; refined from the defaults                                                                                                                             | the site's own model                                              | SH/L 1e-4, size 0.1 nm, μ 1 × 10⁻⁶     | pass                                                                                                                                                                                                                     |
| **Refinement against GSAS-II**            | ZnO simulated in GSAS-II with SH/L 0.03, uniaxial size 0.05 / 0.12 µm along [0 0 1] and Stephens S400, S004, S202 from μ = 1000, 2000, 1500, Poisson noise; refined in GSAS-II and here with U, V, W, X, Y fixed, both from SH/L 0.01 and isotropic starts                                  | as above, fixture `zno-anisotropic.*`                             | 3 combined s.u.; s.u. ± 25 %; R_wp 2 % | SH/L 0.02962(23) (GSAS-II 0.02973(24), truth 0.03); size 50.07(32) and 116.1(26) nm (49.98(32), 116.0(26)); S400 14577(1552), S004 5096(433), S202 6677(587) (14313(1539), 5086(432), 6614(585)); R_wp 4.344 % (4.340 %) |
| \|F\|² for the refinement                 | GSAS-II's \|F\|² of every ZnO reflection with U = 0, and Σ m\|F\|² of each line given to the refinement                                                                                                                                                                                     | as above                                                          | 5e-5 relative                          | pass                                                                                                                                                                                                                     |
| .instprm                                  | SH/L written from the refined or fixed value (at least GSAS-II's minimum 0.002) and read back; a smaller value read is raised to 0.002 with a note                                                                                                                                          | GSAS-II getPowderProfile uses max(SH/L, 0.002)                    | exact                                  | pass                                                                                                                                                                                                                     |

Found by these checks:

- The first GSAS-II comparison failed (R_wp 6.4 % against 4.34 %). Evaluating this site's model at
  GSAS-II's true parameters gave 4.35 %, so the model was right. The cause was in the test: without
  a structure refinement the refinement uses the stored Σ|F|², which keep the CIF's displacement
  parameters, while GSAS-II had U = 0. The test now gives the refinement lines with Σ|F|² computed
  for U = 0 by this site's structure factor (checked against GSAS-II's to 5e-5).
- Two safeguards were added while looking for it: SH/L is released before the sample widths, and
  an isotropic microstrain of about 0 is raised to 100 × 10⁻⁶ before the uniaxial or Stephens
  model starts from it (μ = d²√ΣS·T has no derivative at 0). Neither changed the GSAS-II result.
- The ZnO fixtures made before 17c (SH/L 0.0001 in their .instprm) were in effect calculated by
  GSAS-II with 0.002, its minimum; the resulting asymmetry moves those peaks by about 3e-4°, far
  below their tolerances.

Not compared: GSAS-II uses one representative reflection per family for the anisotropic widths;
this site places the members of a family whose widths differ as separate peaks. The two agree
whenever the axis is a symmetry axis of the lattice (as in every GSAS-II case above); for a
general axis this site's form is the exact average and GSAS-II's an approximation, so they can
differ slightly. Open: no GSAS-II case with a uniaxial axis off a symmetry direction.

## 17d: anomalous dispersion f′, f″ and capillary (Debye–Scherrer) geometry

Formulas: src/core/xrd/rietveld/structure.ts (|F|² with f + f′ and f″, the Friedel mean),
dispersion.ts (the table for an anode), sample.ts (cylinderAbsorption, capillaryShift,
capillaryDegrees), model.ts (capillary peak positions and absorption), refine.ts (μR stage,
warnings), report.ts (methods text). Table: data/reference/anomalous-dispersion.json, written by
`scripts/validation/gsas2/dispersion.py` from GSAS-II's Cromer–Liberman routine (FPcalc, commit
2c62562) at each anode's Kα1 energy, chosen by the owner in November 2026. Tests:
tests/rietveld-dispersion.test.ts, tests/validation-gsas2-dispersion.test.ts.

| Method                              | Check                                                                                                                                                                | Source                                                                                       | Tolerance                                            | Result                                                                                                                                                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Table coverage                      | every element with scattering factors at every anode; E = 12.397639/λ(Kα1) keV; H and He (no orbitals in GSAS-II) set to 0, as GSAS-II does                          | GSAS-II FPcalc, wavekE                                                                       | 1e-5 keV                                             | pass                                                                                                                                                                                                                                           |
| **f′, f″ against the Henke tables** | O, Fe, Co, Cu, Zn, Ce at Cu and Mo Kα1, Henke f1 − Z and f2 interpolated in log E: a second, independent calculation                                                 | Henke, Gullikson & Davis, At. Data Nucl. Data Tables 54 (1993) 181, files from henke.lbl.gov | \|Δf′\| ≤ 0.2 e; \|Δf″\| ≤ 5 % + 0.005 e             | pass; largest Ce at Cu, f″ 9.654 against 10.083 (4.3 %), and at Mo, f′ −0.252 against −0.096; all others within 0.04 e and 2 %                                                                                                                 |
| Zero table                          | f′ = f″ = 0 for every element gives exactly the result without dispersion                                                                                            | definition                                                                                   | exact                                                | pass                                                                                                                                                                                                                                           |
| Friedel mean                        | the site's \|F\|² equals (\|F(h)\|² + \|F(−h)\|²)/2 from an independent complex sum with f = f0 + f′ + i f″ (ZnO, non-centrosymmetric); \|F(h)\|² ≠ \|F(−h)\|² there | definition (h and −h overlap in a powder)                                                    | 1e-8 relative                                        | pass                                                                                                                                                                                                                                           |
| Centrosymmetric and equivalent      | CeO₂: \|F(h)\|² = \|F(−h)\|², and members of {1 1 1}, {2 0 0}, {3 1 1} give the same value                                                                           | invariance                                                                                   | 1e-10                                                | pass                                                                                                                                                                                                                                           |
| **\|F\|² against GSAS-II**          | every reflection of ZnS wurtzite (COD 1100044, 42) and CoFe₂O₄ (COD 1533163, 41), U = 0, Cu Kα1, neutral atoms                                                       | `dispersion.py`, reflection list column 9                                                    | 2e-4 of the reflection (1e-3 of the strongest floor) | pass. GSAS-II lists \|F(h)\|² of the h it lists: it matches the complex sum for +h; the site's Friedel mean then equals GSAS-II for CoFe₂O₄ and differs by up to a few % for ZnS (expected). Without f′, f″ the values differ by more than 2 % |
| Cylinder absorption                 | GSAS-II's Absorb('Cylinder') on μR 0–10 × 2θ 5–175° (77 values)                                                                                                      | GSASIIpwd.Absorb                                                                             | 1e-12                                                | pass                                                                                                                                                                                                                                           |
| Cylinder absorption, shape          | A = 1 at μR = 0; falls with μR, rises with 2θ; the two branches of the fit step by at most 2.7 % at μR = 3 (as in GSAS-II)                                           | invariance; definition                                                                       | as stated                                            | pass                                                                                                                                                                                                                                           |
| Capillary peak positions            | Kα1 positions of GSAS-II's simulation with DisplaceX 30 µm, DisplaceY −20 µm, goniometer radius 200 mm                                                               | GSASIIstrMath.GetReflPos (Debye–Scherrer)                                                    | 1e-9°                                                | pass                                                                                                                                                                                                                                           |
| **Capillary refinement**            | CoFe₂O₄ simulated in GSAS-II (Cu Kα1, Debye–Scherrer, μR 1.5, Dx 30, Dy −20 µm, f′ and f″ on, Poisson noise) and refined in both from μR 0.5, Dx = Dy = 0            | `dispersion.py`, fixture `cofe2o4-capillary.xy`                                              | 3 s.u. of GSAS-II; R_wp within 2 % of R_exp          | μR 1.4982(21) (GSAS-II 1.5001(14)); Dx 30.03 µm (30.11(20)); Dy −20.31 µm (−20.54(34)); a 8.3806052 Å (8.3806091); R_wp 2.862 %, R_exp 2.884 %                                                                                                 |
| Methods text                        | names the capillary geometry, μR, Dx cos 2θ + Dy sin 2θ and Cromer–Liberman with the reference                                                                       | —                                                                                            | contains                                             | pass                                                                                                                                                                                                                                           |

Found by these checks:

- Both CIFs give ionic atom types (Zn2+, S2-, Fe+3, Co+2, O-2), so GSAS-II used ionic form factors
  and |F|² differed by up to 30 %. The script now loads copies of the CIFs with neutral types, as
  the site uses neutral-atom factors.
- GSAS-II places Kα2 by a first-order step from the shifted Kα1 position,
  2θ₂ = 2θ₁ + (360/π)(Δλ/λ₁) tan θ₁ (GSASIIstrMath, lamRatio); the site places it at its exact Bragg
  angle and applies the shifts there. On the Kα1 + Kα2 capillary pattern this moved Dy by 6 s.u. and
  a by 9 s.u.; with GSAS-II's step put into the site's model temporarily, both matched. The site
  keeps the exact angle, and the capillary comparison uses Kα1 only so it tests the capillary
  terms alone. The Kα2 positions differ by 3e-5° at 30°, 4e-4° at 90° and 3.4e-3° at 130° (2θ), less than a
  typical step width.

Open:

- GSAS-II's refinement of its own capillary simulation ends at R_wp 3.06 % against R_exp 2.88 %,
  while the site reaches 2.86 % with parameters within GSAS-II's s.u. The cause was not found.
- The Lobanov & Alte da Veiga fit used by Absorb('Cylinder') is cited only as GSAS-II's source
  comment gives it; the original paper could not be checked.
- The Henke comparison covers six elements; the rest of the table rests on GSAS-II alone.

## 17e: analytic derivatives of the Rietveld model

Formulas: src/core/xrd/rietveld/derivatives.ts (the chain rule peak by peak and the exact
pseudo-Voigt and asymmetry derivatives, in its header comment), structure.ts
(structureFactorGradient: the exact gradient of Σ|F|² of a reflection family for coordinates,
occupancy, B, U_ij and dopant fraction), refine.ts (evaluate: the Jacobian from fillJacobian, with
the whole-pattern difference kept for restraints and for any column whose peak list changes).
Tests: tests/rietveld-derivatives.test.ts.

| Method                     | Check                                                                                                                                                                                                                                                                                                                                                                                                                                 | Source                                         | Tolerance                                          | Result |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------- | ------ |
| **Jacobian, every column** | each column against a Richardson-extrapolated central difference of the whole pattern (h and h/2, h = 10⁻⁵ max(\|p\|, 10⁻²)), four models: ZnO (U_ij, f′ f″, Mg on the Zn site, asymmetry, orientation, polarisation, variable slit, zero, displacement, transparency, roughness); WO₃ (TCH, sample size and strain, uniaxial size, Stephens strain); CeO₂ (FCJ SH/L, capillary μR, uniaxial strain); ZnO structure with CeO₂ Le Bail | independent calculation (finite differences)   | largest error / largest value of the column < 2e-5 | pass   |
| Σ\|F\|² gradient           | every atom parameter of ZnO (coordinates, occupancy, U_ij, dopant fraction, f′ f″) on 15 reflections against central differences of the structure factor                                                                                                                                                                                                                                                                              | independent calculation                        | 1e-6 of \|F\|² + 1e-9                              | pass   |
| Equivalent reflections     | members of one family give the same \|F\|² and gradient (ZnO with U_ij from U_iso, so the symmetry is exact)                                                                                                                                                                                                                                                                                                                          | invariance                                     | 1e-10 of the gradient norm                         | pass   |
| Origin choice              | a common shift of every atom along the polar c axis of ZnO changes no \|F\|²: the summed c gradients are 0                                                                                                                                                                                                                                                                                                                            | invariance                                     | 1e-9 relative                                      | pass   |
| Same refinements as before | every earlier Rietveld test and every GSAS-II comparison (16, 17a–17d fixtures) passes unchanged with the analytic Jacobian                                                                                                                                                                                                                                                                                                           | GSAS-II fixtures in tests/fixtures/validation/ | the tolerances of those checks                     | pass   |

Timings (this container, one core, Node; WO₃ monoclinic, 42 parameters, five stages, positions and
B released, simulated Cu Kα1 + Kα2 pattern 15–125°; the benchmark script is not kept in the
repository):

| Points | Whole-pattern differences (before) | Analytic Jacobian | Final R_wp |
| ------ | ---------------------------------- | ----------------- | ---------- |
| 5,501  | 43 s                               | 17.4 s            | 0.0006     |
| 50,001 | 148 s                              | 106.6 s           | 0.0006     |

The roadmap hoped for 10–50×. The Jacobian itself is now cheap; what remains is the trial
evaluations of the damped least squares (about half of the 5,501-point time) and the assembly over
the wide Lorentzian windows, which grow with the number of points.

Open:

- No comparison with GSAS-II's own derivative routines (they are not exposed in a form the
  Validation workflow can compare column by column); the finite-difference check stands in.
- Peaks with the FCJ axial-divergence profile still use a per-peak central difference of the
  profile for the shape terms.
- The 10–50× speed-up in the roadmap was not reached (2.5× at 5,501 points, 1.4× at 50,001).

## 17f: spherical-harmonic texture

Formulas: src/core/xrd/rietveld/texture.ts (header comment: GSAS-II's cylindrical
preferred-orientation correction A(h) = 1 + Σ C(l,n) · 4π/(2l+1) · K_l^n(φ,β) · k_l(ψ), with ψ = 90°
for a flat plate and ψ = θ for a capillary; R. B. Von Dreele, J. Appl. Cryst. 30 (1997) 517),
model.ts (the correction applied per reflection), refine.ts (coefficients refined in the
"Preferred orientation" stage, texture index J). Tests: tests/texture.test.ts,
tests/validation-gsas2-texture.test.ts. GSAS-II fixture: scripts/validation/gsas2/texture.py →
tests/fixtures/validation/texture.json and zno-texture.xy (Validation workflow run 43471101291).

| Method                        | Check                                                                                                                                                                                                              | Source                              | Tolerance                                                                    | Result |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Normalised Legendre functions | P̄_l^m of the Fourier series against an independent recurrence (l ≤ 16); P̄_l^0(0) = √((2l+1)/2); normalised over 0…π                                                                                                | synthetic (known answer)            | 5e-5                                                                         | pass   |
| Same functions as GSAS-II     | PLMPSI (152 values), sample harmonics k_l(ψ), normalisation, coefficient names for 20 Laue-class and order cases                                                                                                   | GSAS-II (CI)                        | 2e-5 (GSAS-II's Fortran is single precision), names exact                    | pass   |
| Crystal harmonics             | K_l^n at GSAS-II's angles for every Laue class, orders up to 16 (cubic up to 12), except the deliberate differences below                                                                                          | GSAS-II (CI)                        | 3e-5                                                                         | pass   |
| Correction per reflection     | the orientation factor of every reflection of ZnO (flat plate and capillary), CeO₂, corundum, MoO₃, rutile and WO₃ with chosen coefficients                                                                        | GSAS-II reflection list (Prfo) (CI) | 2e-5; WO₃ 1e-2 (monoclinic azimuth, difference 4 below)                      | pass   |
| Equivalent reflections        | every symmetry-equivalent hkl gives the same correction, ten cells (space groups 225, 206, 186, 167 in hexagonal axes, 166 in rhombohedral axes, 162 (P-31m), 136, 88, 62, and 14 with β = 90.9°)                  | invariance                          | 5e-9                                                                         | pass   |
| Average over directions       | the correction averages to 1 over all directions (m3m and 6/mmm)                                                                                                                                                   | invariance (normalisation)          | 5e-3 (grid average)                                                          | pass   |
| Refinement                    | ZnO simulated by GSAS-II with C(2,0) = 0.45, C(4,0) = −0.2 (order 4) and counting noise, refined by both programs: GSAS-II 0.44767(344), −0.19389(518), R_wp 4.421 %; this site 0.44770(345), −0.1930(52), 4.425 % | GSAS-II (CI) and the known truth    | within 3 combined s.u. of GSAS-II, truth within 3 s.u., s.u. ratio 0.75–1.25 | pass   |
| Texture index                 | J = 1 + Σ C²/(2l+1), 1.04426 in GSAS-II for the refined ZnO                                                                                                                                                        | GSAS-II (CI)                        | same formula; reported with its s.u.                                         | pass   |

Deliberate differences from GSAS-II, each found by the invariance check (equivalent reflections
gave different corrections in GSAS-II's form):

1. Laue class 31m, terms with n mod 6 = 3: cosine, not sine. GSAS-II uses the sine, which changes
   sign under the mirror (h,k,l) → (k,h,l) of that class.
2. Rhombohedral axes, class 3mR: treated with the mirror classes (sine for n mod 6 = 3, cosine
   otherwise). GSAS-II's list of mirror classes spells it 'R3mR', so 3mR fell to cosine plus sine.
3. Rhombohedral axes: polar axis [111]. GSAS-II tests for space-group names 'R3' and 'R3m' that
   never occur, so it falls back to c*.
4. Monoclinic and triclinic: the azimuth β is measured exactly in the plane perpendicular to the
   polar axis (Gram–Schmidt in the reciprocal metric). GSAS-II's formula is not linear in hkl when
   the cell angles are not 90°; this is why WO₃ agrees only to 1e-2.

Open:

- Only cylindrical sample symmetry ('0'), as GSAS-II's powder default; no orthorhombic or
  monoclinic sample symmetry.
- The four differences above are not confirmed by the GSAS-II authors; they are reported here so
  a reader can check them. For hexagonal (except 31m), tetragonal, orthorhombic and cubic classes
  in the hexagonal setting the site agrees with GSAS-II exactly.
- No refinement comparison with a measured textured sample; the GSAS-II simulation stands in.

## 17g: sequential refinement of a series

Code: src/core/xrd/rietveld/sequential.ts (refineSeries: the patterns refined in order of the
series value, each starting from the cells refined on the previous one, as GSAS-II's sequential
refinement with "copy results to next histogram"; seriesQuantities; seriesMethods),
src/core/math/linearFit.ts (weightedLinearFit, w = 1/σ², centred normal equations, s.u. scaled by
√χ²_ν as numpy.polyfit cov=True), src/workers/rietveld.worker.ts (series requests),
src/modules/xrd/SeriesSection.tsx (step 5, Advanced). Tests: tests/sequential.test.ts,
tests/series-report.test.ts, tests/validation-gsas2-sequential.test.ts; e2e step "5 Rietveld:
sequential refinement of the two example patterns". GSAS-II fixture:
scripts/validation/gsas2/sequential.py → tests/fixtures/validation/sequential.json and
zno-series-0…4.xy (Validation workflow run 43476362292, GSAS-II commit 2c62562).

The series: five ZnO (COD 1577381) patterns simulated in GSAS-II at series values 25, 125, 225,
325 and 425, with a and c expanded by a made-up linear law (6e-6 and 4e-6 per unit, relative to the
CIF cell), counting noise, 20–130° 2θ.

| Method                        | Check                                                                                                                                                                                                                            | Source                           | Tolerance                                       | Result |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------- | ------ |
| Weighted line                 | exact line recovered; equal σ gives the unweighted fit; numpy.polyfit(w = 1/σ, cov = True and "unscaled") on a typed set of five points                                                                                          | synthetic; numpy 2.5.3           | 1e-12; 1e-9 relative                            | pass   |
| Weighted line, GSAS-II's data | the line through GSAS-II's own one-by-one a and c reproduces numpy's slope, intercept and both kinds of s.u. in the fixture                                                                                                      | numpy in CI                      | 1e-8 relative                                   | pass   |
| Weighted line invariance      | same line for the points in another order; a common factor on σ leaves the scaled s.u. unchanged and multiplies the unscaled ones by it                                                                                          | invariance                       | 1e-12                                           | pass   |
| Series order, copy forward    | stand-in refinement: patterns refined by value, each starting from the previous refined cell; without copy forward from the input cell; a failed pattern is reported and the next starts from the last good one                  | synthetic (known answer)         | exact                                           | pass   |
| Cells, one by one             | every a and c of the site's sequential refinement against GSAS-II refining each pattern on its own (site a 3.2510005(50) … 3.2588014(50) Å; GSAS-II 3.2509976(105) … 3.2588027(105) Å) and against the simulated truth           | GSAS-II (CI) and the known truth | 3 combined s.u. of GSAS-II; truth within 3 s.u. | pass   |
| Cells, GSAS-II sequential     | the same against GSAS-II's own sequential refinement (cell changes refined as hydrostatic strain), for example c 5.2089923(134) Å against 5.2089934(134) Å on the first pattern                                                  | GSAS-II (CI)                     | 3 combined s.u.                                 | pass   |
| R_wp                          | site 4.407–4.450 %, GSAS-II one by one 4.402–4.446 %                                                                                                                                                                             | GSAS-II (CI)                     | 2 % relative                                    | pass   |
| Standard uncertainty of c     | site 1.34e-5 Å, GSAS-II 1.34e-5 Å                                                                                                                                                                                                | GSAS-II (CI)                     | ratio 0.9–1.1                                   | pass   |
| Standard uncertainty, scatter | 40 copies of the first pattern (the fit's calculated pattern plus Gaussian noise of variance y, seeded): the reported s.u. of a and c against the standard deviation of the refined values                                       | Monte Carlo (known answer)       | ratio 0.75–1.3                                  | pass   |
| Trend                         | slope of a against the series value: site (1.9494 ± 0.0024) × 10⁻⁵, GSAS-II one by one with numpy (1.9505 ± 0.0025) × 10⁻⁵, truth 1.9506 × 10⁻⁵ Å per unit; of c: (2.0866 ± 0.0035), (2.0855 ± 0.0036), 2.0836 × 10⁻⁵ Å per unit | GSAS-II with numpy (CI), truth   | 3 s.u. of GSAS-II's slope and of the truth      | pass   |
| Start and order invariance    | the series refined without copy forward, and in reverse order (values negated), gives the same cells                                                                                                                             | invariance                       | 0.1 s.u.                                        | pass   |
| Relative slope, methods text  | (1/y₀)·dy/dx of a line a = 3.25 (1 + 6e-6 (T − 25)) is 6e-6 per unit; methods text by hand (slope 0.39 / 20000 = 1.95e-5)                                                                                                        | synthetic (known answer)         | 1e-15; exact text                               | pass   |

The s.u. of the hexagonal a: GSAS-II reports 1.05e-5 Å (get_cell_and_esd) for every pattern, the
site 4.97e-6 Å. A Monte Carlo of 200 noisy copies of the first pattern (in this session, not in CI)
gave a standard deviation of a of 4.60e-6 Å, so the site's value matches the real scatter. GSAS-II's
own propagation from the s.u. of its reciprocal-metric term A0 gives 6.28e-6 Å; why
get_cell_and_esd reports 1.05e-5 Å is not known. For c all three agree (Monte Carlo 1.32e-5,
site 1.34e-5, GSAS-II 1.34e-5 Å). The test therefore compares the s.u. of a with the Monte Carlo
scatter and the s.u. of c with GSAS-II.

Open:

- Only the cells are copied forward; the other parameters start from the same values on every
  pattern (GSAS-II copies every parameter). With a good fit both reach the same minimum (the
  invariance check above), but a series of poor fits may differ.
- No measured series (for example a real heating run) has been compared; the GSAS-II simulation
  stands in.
- The cause of GSAS-II's larger s.u. of the hexagonal a is not confirmed.
- The plot shows the points without error bars; the s.u. are in the table and the CSV.

## 17h: bond lengths and angles with uncertainties, bond-valence sums

Code: src/core/xrd/structure/bonds.ts (findBonds, findAngles, symmetry codes, analytic gradients
of each distance and angle with respect to p = [a, b, c, α, β, γ, x₁, y₁, z₁, …], σ² = gᵀCg),
src/core/xrd/structure/bondValence.ts (s = exp((R₀ − R)/b), V = Σ occ s, σ²(V) from the bond
gradients, offered and suggested oxidation states), src/core/xrd/rietveld/refine.ts (the
covariance of p, C_p = J C Jᵀ from the refined parameters, reported per phase as `geometry`),
src/modules/xrd/BondsSection.tsx (step 5, Advanced). Data: data/reference/bond-valence.json, built
by scripts/build-bond-valence.ts from an unchanged copy of bvparm2020.cif
(data/reference/source/, SHA-1 54640352675869efaa9264bb1b9b1cd3c43d03e5, from the matminer 0.10.1
wheel; copyright notice kept; flagged for owner verification). Tests: tests/structure-bonds.test.ts,
tests/validation-gsas2-bonds.test.ts, tests/bonds-report.test.ts; e2e step "5 Rietveld: bonds …
and bond-valence sum". GSAS-II fixture: scripts/validation/gsas2/bonds.py →
tests/fixtures/validation/zro2-bonds.json and zro2-bonds.xy (Validation workflow run 43519799052,
GSAS-II commit 2c62562). The GSAS-II case: baddeleyite (ZrO₂, P2₁/c, COD 9007448) simulated with
O1 x moved by 0.004, refined in GSAS-II (R_wp 2.74 %) with positions and U_iso.

| Method                         | Check                                                                                                                                                                                       | Source                     | Tolerance             | Result |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------- | ------ |
| Distances                      | every distance up to 3.2 Å from each site of four COD structures (rutile 9007531, 9015929, 7212242, baddeleyite 9007448)                                                                    | pymatgen 2026.10.31 (CI)   | 1e-4 Å                | pass   |
| Distances and s.u., GSAS-II    | the 14 Zr–O distances (up to 2.4 Å) of GSAS-II's refined baddeleyite and their s.u. against GSASIIstrMain.RetDistAngle, which uses the coordinate covariance only (the cell block set to 0) | GSAS-II (CI)               | 1e-8 Å; s.u. 1e-7 Å   | pass   |
| Angles and s.u., GSAS-II       | the 30 O–Zr–O and Zr–O–Zr angles against GSAS-II's G2mth.getAngSig with the orthogonalisation matrix (see below)                                                                            | GSAS-II (CI)               | 1e-6°; s.u. 1e-5°     | pass   |
| Bond-valence sums and s.u.     | Zr 3.7522(8), O1 1.9049(7), O2 1.8473(7) against a separate Python reading of bvparm2020 with s.u. from GSAS-II's distance derivatives (getDistDerv)                                        | Python in CI               | 1e-8; s.u. 1e-7       | pass   |
| GSAS-II's own sum              | with GSAS-II's R₀ = 1.937 Å, b = 0.37 (atmdata.BVScoeff) the site gives Zr 3.845; GSAS-II prints 3.84                                                                                       | GSAS-II (CI)               | 0.005                 | pass   |
| This site's refinement         | the same pattern refined here (R_wp 2.86 %): all 14 lengths within 3 combined s.u. of GSAS-II's (largest difference 0.0011 Å); coordinate-only s.u. 1.04–1.05 × GSAS-II's                   | GSAS-II (CI)               | 3 s.u.; ratio 0.9–1.2 | pass   |
| Covariance of p                | its diagonal gives exactly the cell and coordinate s.u. the refinement reports                                                                                                              | internal consistency       | 1e-9                  | pass   |
| Gradients                      | analytic gradients of every baddeleyite bond against central finite differences in all 15 parameters                                                                                        | synthetic                  | 1e-5                  | pass   |
| Propagated s.u.                | standard deviation of lengths and angles over 4000 structures drawn from a covariance against the propagated s.u.                                                                           | Monte Carlo (known answer) | 5 %                   | pass   |
| Closed forms                   | orthorhombic distance d = a(x₂ − x₁), σ² = (x₂ − x₁)²σ_a² + a²(σ₁² + σ₂²); a 90° angle from two perpendicular bonds                                                                         | synthetic (known answer)   | 1e-12; 1e-10          | pass   |
| Symmetry invariance            | symmetry-equivalent rutile Ti–O bonds have equal lengths and s.u.; an atom moved to an equivalent position with its covariance transformed (C′ = TCTᵀ) gives the same bonds and s.u.        | invariance                 | 1e-10; 1e-12          | pass   |
| Bond-valence sum, known answer | n equal bonds at R = R₀ + b ln(n/V) give the sum V; rutile: 2 V(Ti) = 4 V(O) over the cell; finite differences of the sum against its propagated s.u.                                       | synthetic; invariance      | 1e-12; 1e-10; 1e-6    | pass   |
| Table reading, suggestions     | Zr⁴⁺–O 1.928 Å (ref a); no Ti²⁺–F entry; the valence-9 Ag–Br entry 2.22 Å (ref b) used as the fallback; ZrO₂ suggested as Zr 4+, O 2−; S an anion in ZnS, a cation with O                   | the table (by hand)        | exact                 | pass   |

GSAS-II finding: RetDistAngle passes the transposed orthogonalisation matrix (Amat.T) to getAngSig,
so its angles disagree with its own distances in a non-orthogonal cell, by up to 1.14° here
(for example 86.50° against 87.27°). bonds.py checks this by recomputing the angles with Amat.T,
which reproduces RetDistAngle's values exactly, and stores getAngSig's values with Amat, the
matrix RetDistAngle uses for the distances. The site's angles agree with those to 1e-6°.

Notes: GSAS-II's distance s.u. leave out the cell covariance; the site includes it (here it changes
the s.u. by less than 1e-5 Å). pymatgen's calculate_bv_sum uses an electronegativity model with
b = 0.31 Å rather than the tabulated parameters, so it was not used as a check. GSAS-II's own
table lists Zr⁴⁺–O R₀ = 1.937 Å (bvparm2020's ref b entry), the site takes the first-listed entry
(1.928 Å, ref a), as the owner chose.

Open:

- The oxidation-state suggestion is a rule of the site (anion by the table, cation state nearest
  its own sum), checked only on the cases above; it is labelled as a suggestion.
- The 10 % note on a sum far from the oxidation state is a display choice, not a published limit.
- No published bond table of a measured refinement has been compared; the GSAS-II simulation stands
  in.

## 17i: Bérar–Lelann correction of the standard uncertainties

Source: J.-F. Bérar and P. Lelann, J. Appl. Cryst. 24 (1991) 1–5, eqs 10–12 and the Appendix
Fortran; Yu. G. Andreev, J. Appl. Cryst. 27 (1994) 288–297, eq 3 and Appendix I (read from the
papers supplied by the owner, November 2026; the PDFs are not kept in the repository).
src/core/xrd/rietveld/statistics.ts `berarLelann`, tests/berar-lelann.test.ts.

| Check                                                                                                                              | Kind                       | Expected                                     | Tolerance |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------- | --------- |
| a = (1, 2, 3, −1, −2): √((19 + 12 z(5) z(13))/19) from eqs 10–12 by hand                                                           | synthetic, known answer    | 1.175219                                     | 10⁻¹²     |
| Same case in scripts/validation/berar-lelann/white_noise.py (separate run-by-run Python code) and in the independent rietx program | independent implementation | 1.17522                                      | 10⁻⁵      |
| White noise, 400 000 points                                                                                                        | synthetic and independent  | Python 1.1268 (2 × 10⁶ points), rietx 1.1267 | 0.005     |
| Alternating signs                                                                                                                  | synthetic                  | exactly 1                                    | exact     |
| Every point duplicated μ = 2, 4, 8 times (the paper's own aim, §II–III)                                                            | invariance                 | corrected s.u. (factor/√μ) unchanged         | 10 %      |
| All residuals negated                                                                                                              | invariance                 | same factor                                  | 10⁻¹²     |

Misprints found: the printed eq 12 has 2 where the Fortran has 2π; Andreev's eq 3 prints 2π, so 2π
is used. The Fortran uses an undefined CD, which Andreev's Appendix I corrects to XD, and pairs
z_i with a_{i−1}, which Andreev says gives a small error at each change from uncorrelated to
correlated points; the site follows the equations, not the listing. Open: the paper's own
α-PbO figures (Figs 2–4) are plots without a table, so no numeric check against them was possible.

## Step 6: fit improved until the regions fit (owner request, November 2026)

Code: src/core/xrd/peaks/improve.ts (improveFit, fitScore, proposeChanges), run in the peaks
worker. Tests: tests/improveFit.test.ts; e2e step "6 Fit peaks: Gaussian misfit explained".

| Check                    | Data                                                                                                                           | Expected                                                                                           | Result                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Missing peaks recovered  | synthetic pseudo-Voigt pattern with counting noise, six peaks (a shoulder 0.3° away, a pair 0.4° apart), four starting guesses | the six true peaks, centres within 0.02°, FWHM within 10 %, every region χ²ν < 2.5, stopped "fits" | pass                                                                                                                       |
| Idempotent               | the same pattern started from the true peaks, then from its own result                                                         | no rounds, same peaks                                                                              | pass                                                                                                                       |
| Duplicate merged         | a seventh guess 0.02° from a true peak                                                                                         | six peaks                                                                                          | pass                                                                                                                       |
| Shape, not peaks         | Gaussian chosen on pseudo-Voigt data (η 0.6)                                                                                   | no tail peaks added; stopped "shape"; the pseudo-Voigt fit fits every region                       | pass; on the app's example data worst χ²ν 22.1 (Gaussian) against 2.2 (pseudo-Voigt), every region "Good" after the switch |
| Gaussian kept when right | Gaussian data with a missed shoulder                                                                                           | Gaussian kept, the shoulder added at 30.3°                                                         | pass                                                                                                                       |
| No peaks in noise        | one peak on a flat, noisy background                                                                                           | nothing added                                                                                      | pass                                                                                                                       |

The score is χ² + (free parameters) × ln n per region (the Bayesian information criterion with
the noise σ estimated from the data), so a change is kept only when it improves the fit by more
than its extra parameters would by chance. Open: the score compares regions whose ranges can
change when a peak is added or removed (a region grows by at most three peak widths), which
slightly favours removing peaks; no case where this mattered was found.

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

## 19a: Tauc band gap with background absorption (audit of 2026-11-14)

src/core/uvvis/tauc.ts `analyseTaucGap`, `subtractedGap`, `lineCrossing`, `fitLine`;
tests/uvvis-tauc-baseline.test.ts and tests/uvvis-gap-method.test.tsx. Synthetic spectrum of the
audit: 250 to 850 nm in 1 nm steps, A = 1.2·√(E − 3.2)/E above 3.2 eV, plus a level. Two methods
were added beside the axis intercept, both chosen with the owner (November 2026): the sub-gap
baseline subtracted from α, A or F(R) before the Tauc plot (the default when it moves Eg by more
than 0.01 eV), and the crossing of the edge line with a baseline line on the Tauc plot.

| Check                                                                                           | Kind                      | Expected                                                       | Tolerance |
| ----------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------- | --------- |
| Audit table reproduced: axis intercept for level 0, 0.05, 0.2, 0.5                              | synthetic, known answer   | 3.200, 3.116, 2.926, 2.690 eV                                  | 0.0005 eV |
| Subtraction, direct allowed, constant level 0, 0.05, 0.2, 0.5                                   | synthetic, known answer   | 3.200 eV, edge region starting below 3.3 eV                    | 0.002 eV  |
| Subtraction, indirect allowed, the same levels                                                  | synthetic, known answer   | 3.200 eV                                                       | 0.002 eV  |
| Subtraction, sloping levels (0.05 + 0.05/eV, 0.2 − 0.05/eV, 0.1 + 0.1/eV), direct and indirect  | synthetic, known answer   | 3.200 eV                                                       | 0.002 eV  |
| Subtraction, Kubelka–Munk spectra with 0.01, 0.05, 0.2 added to F(R), direct and indirect       | synthetic, known answer   | 3.200 eV                                                       | 0.002 eV  |
| Zero level with noise (σ 0.003): automatic choice keeps the old method, region and number       | regression                | identical to the version 2 result                              | exact     |
| Crossing of two exact lines y = 2(E − 3) and y = 0.1 + 0.05E, by hand                           | synthetic, known answer   | 6.1/1.95 = 3.128205 eV, σ 0                                    | 10⁻¹⁰     |
| Crossing with a baseline of exactly zero                                                        | independent formula       | same Eg and σ as the axis-intercept formula of `fitBandGap`    | 10⁻¹²     |
| Crossing σ: 400 data sets, equal noise on two lines                                             | Monte Carlo (independent) | mean reported σ / scatter of Eg = 1                            | ±15 %     |
| Subtraction σ (baseline part, by central differences): 400 data sets, noise only below the edge | Monte Carlo (independent) | mean reported σ / scatter of Eg = 1                            | ±15 %     |
| Signal multiplied by 37 (thickness or concentration)                                            | invariance                | Eg unchanged, all three methods                                | 10⁻⁹ eV   |
| Any straight background added (0.3; 0.1 + 0.2/eV; 0.4 − 0.08/eV)                                | invariance                | subtraction gives the zero-level Eg                            | 0.0005 eV |
| Wavelength step 2 nm instead of 1 nm                                                            | invariance                | 3.200 eV                                                       | 0.002 eV  |
| Version 2 session with a level of 0.2                                                           | round trip                | same Eg after migration (2.926 eV) until the method is changed | exact     |

Findings, measured, not published values: with a level in A or F(R) the Tauc curve is bent above
the gap, (1.2·√(E − 3.2) + cE)² for the direct case, so no straight line through it is exact. The
crossing method gives 3.18, 3.15 and 3.14 eV for c = 0.05, 0.2 and 0.5 with an edge region of
3.21–3.40 eV; it always lies between the axis intercept and the true gap. Subtraction is exact when
the background adds to the absorption quantity and is linear in E across the edge; a background of
another shape (for example scattering rising as λ⁻⁴ over a wide range) is only approximated.

Open:

- Makuła, Pacia and Macyk, J. Phys. Chem. Lett. 9 (2018) 6814–6817, doi:10.1021/acs.jpclett.8b02892
  (details confirmed with Crossref and Europe PMC). The paper itself could not be opened in the
  session (no open-access copy; the publisher's site was not reachable), so it is not yet confirmed
  that the crossing method as built is the one the paper describes. **TODO for the owner:** check
  the paper and either confirm the citation or correct it.
- The σ of the plain axis intercept (unchanged since stage 8b) is about 1.27 times the scatter of
  repeated noisy spectra when the noise is in A, because the noise of (A·E)² grows along the edge
  and the fit is unweighted; the new methods inherit this. It errs on the safe side.
- No real spectrum with a known gap was available; tests/fixtures-real/ has none for UV-Vis.

## 19a: other fixes (audit of 2026-11-14)

| Fix                                                                                                   | Test                                |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| UV-Vis heading "Reflectance" or "Transmittance" names the type only; "%R", "R (%)", "T%" name percent | tests/uvvis-kind-scale.test.ts      |
| FTIR assignments re-attach to the nearest peak (20 cm⁻¹) after reprocessing; none dropped silently    | tests/ftir-assignments.test.ts      |
| FTIR files stating reflectance (heading or ##YUNITS) are read as transmittance with a warning         | tests/ftir-reflectance-kind.test.ts |
