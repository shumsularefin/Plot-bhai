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
  (geddes has only authored RAW3 examples). Real files are needed to add them. Closed by the owner on 2026-11-15: no raw files are available to test with.
- No real .rasx file with an attenuator factor other than 1, nor a multi-scan .rasx or .brml, is
  held; those cases warn and load the first scan, untested on real data. Closed by the owner on 2026-11-15: no raw files are available to test with.
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
  of a measured pattern (section 19). FullProf is a closed-source program that could not be
  installed here; no comparison with it.
- The full reference of the Pearson VII paper ("The approximation of symmetric X-ray peaks by
  Pearson type VII distributions", Hall et al., J. Appl. Cryst. 1977) could not be opened to
  confirm the volume and pages, so the code cites it by title, authors and year only.
- The manual's 1/tan 2θ asymmetry terms (P3, P4) and its angle limit for the correction are not
  used; asymmetry applies to every peak with the 1/tan θ terms only.

## 16c: crystal structure viewer

Formulas: src/core/xrd/structure/geometry.ts (metric tensor, orthogonalisation, drawn cell,
bonds). Tests: tests/structure-geometry.test.ts. Covalent radii: data/reference/covalent-radii.json
(Cordero et al., Dalton Trans. 2008, 2832–2838, as tabulated in ASE; checked by the owner, November 2026).

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

- GSAS-II's indexing is compared on the same lines in section 19. DICVOL, TREOR and McMaille are
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
  Export step (.xye, .instprm, CIF) are loaded into GSAS-II in section 19. This was done through
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
- Monoclinic cells are compared with GSAS-II in section 19. No comparison with DICVOL, TREOR or
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

- The cells and, where refined, the atomic parameters are copied forward (section 20); the
  profile, background and scale start from the same values on every pattern (GSAS-II copies every
  parameter). With a good fit both reach the same minimum (the invariance check above), but a
  series of poor fits may differ.
- No measured series (for example a real heating run) has been compared; the GSAS-II simulation
  stands in.
- The cause of GSAS-II's larger s.u. of the hexagonal a is not confirmed.

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
correlated points; the site follows the equations, not the listing. The 2π also follows from the
derivation (section 20).

Open:

- The paper's own α-PbO figures (Figs 2–4) are plots without a table, so no numeric check against
  them was possible.

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

## 18: review fixes (calculated example, peak labels, sample comparison, sample report)

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
- Several open items of sections 16a to 16e were worked on in section 19; what is left is listed
  there.

## 19: open items checked with Fityk and GSAS-II (owner request, November 2026)

The owner asked for the open items above to be validated. Fityk 1.3.2 (Debian package) and
GSAS-II (built from source at commit 2c62562) were installed in the session container and used
as independent programs. Scripts: scripts/validation/fityk/ (peakfit.fit, make_peakfit.py),
scripts/validation/gsas2/load_export.py, index_cells.py and indexing.py. Tests:
tests/validation-lmfit.test.ts, tests/validation-gsas-export.test.ts, tests/xrd-indexing.test.ts.
Fixtures: tests/fixtures/validation/peakfit-fityk.json, peakfit-real.xy, gsas-export.json,
indexing-lines.json, indexing-gsas2-refined.json, indexing-gsas2.json.

| Method                             | Check                                                                                                                                                                                                                                                                               | Source                                           | Tolerance                                 | Result                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------- |
| Peak fit against Fityk             | the two synthetic data sets of section 18 (two overlapping pseudo-Voigt peaks; one Pearson VII peak) fitted by Fityk (MPFIT, unweighted) and by this site                                                                                                                           | independent program (Fityk 1.3.2)                | 2e-5°; 1e-4°; η and m 2e-3; 1e-3 relative | pass                                                                   |
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
  factor: no real, openly licensed file is held, and a reader is written only against real files. Closed by the owner on 2026-11-15: no raw files are available to test with.
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
another shape (for example scattering rising as λ⁻⁴ over a wide range) is only approximated by
the straight line; stage 22 part C adds a power-law baseline for it.

Source confirmed on 2026-11-14 (paper supplied by the owner and read in full): Makuła, Pacia and
Macyk, J. Phys. Chem. Lett. 9 (2018) 6814–6817, doi:10.1021/acs.jpclett.8b02892.

- The crossing as built is their "simplified procedure": a linear fit of the edge and a linear
  fit of the slope below the fundamental absorption, with Eg at the intersection (Table 1,
  column 3, Figure 4).
- Their preferred method is to subtract the measured spectrum of the second component,
  α_s = α − c·α_m (eq 4, Table 1, column 2). It is added below.
- In their data the two methods differ by up to 0.08 eV (for example 3.18 against 3.26 eV),
  with a stated margin of ±0.03 eV.
- The plain axis intercept gave 2.13 to 3.08 eV, against 3.22 eV for bare TiO2.

### Second component subtracted (Makuła et al. 2018, eq 4)

Code: src/core/uvvis/tauc.ts (`componentFactor`, `componentGap`, `interpolateOnto`).
Tests: tests/uvvis-component.test.ts.

Synthetic model of their system:

- The edge above, at 3.2 eV.
- A dye band, 0.4·exp(−½((E − 2.9)/0.4)²), that absorbs across the edge.
- The dye "measured alone" is 1/0.6 as strong, so c = 0.6.

| Check                                                                   | Kind                      | Expected                                                            | Tolerance      |
| ----------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------- | -------------- |
| Direct and indirect, absorbance: c fitted, Eg                           | synthetic, known answer   | c = 0.6, 3.200 eV                                                   | 10⁻⁹; 0.002 eV |
| Direct and indirect, Kubelka–Munk (dye and a 0.002 floor added to F(R)) | synthetic, known answer   | c = 0.6, 3.200 eV                                                   | 10⁻⁶; 0.002 eV |
| The other three methods on the same spectrum                            | measured, recorded        | 2.368, 2.423, 2.397 eV (the dye edge; 2.424, 2.396 before stage 22) | error > 0.5 eV |
| c typed as 0.6; c typed as 0.3 over the same edge region                | synthetic                 | 3.200 eV; below 3.19 eV                                             | 0.002; 0.01 eV |
| c of S = 2M; c and σ(c) of S = (1, 3, 2, 5), M = (1, 1, 1, 2) by hand   | independent hand result   | 2, σ 0; 16/7, σ² = (119/49)/3/7                                     | 10⁻¹²          |
| σ(Eg) from σ(c): 400 data sets, noise σ 0.003 only where c is fitted    | Monte Carlo (independent) | mean reported σ / scatter of Eg = 1                                 | ±15 %          |
| Component 37 times stronger                                             | invariance                | c/37, same Eg                                                       | 10⁻⁹           |
| Component on another grid (2 nm steps from 251 nm), interpolated        | invariance                | 3.200 eV                                                            | 0.002 eV       |
| Interpolation of a straight line; points outside the data               | synthetic, known answer   | exact; NaN                                                          | exact          |
| Component measured another way (reflectance against absorbance)         | guard                     | refused with a message                                              | exact          |
| Version 3 session                                                       | round trip                | same settings, component null                                       | exact          |

Robustness check added with it. With this curved background, the automatic baseline window of
the straight-line subtraction used to move up into the edge, giving 4.049 eV. A move is now
undone unless the corrected Tauc curve stays below 10 % of the edge between the window and the
gap (`flatBelowGap`, my own threshold). Every earlier 19a check gives the same result.

Open:

- The σ of the plain axis intercept (unchanged since stage 8b) is about 1.27 times the scatter of
  repeated noisy spectra when the noise is in A. The noise of (A·E)² grows along the edge and the
  fit is unweighted, and the new methods inherit this. It is kept on purpose: unweighted least
  squares is the usual Tauc practice, and it errs on the safe side.
- No real spectrum with a known gap was available; tests/fixtures-real/ has none for UV-Vis. The
  paper's spectra are not published as data, so its Table 1 cannot be reproduced here. Closed by the owner on 2026-11-15: no raw files are available to test with.

## 19a: other fixes (audit of 2026-11-14)

| Fix                                                                                                   | Test                                |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| UV-Vis heading "Reflectance" or "Transmittance" names the type only; "%R", "R (%)", "T%" name percent | tests/uvvis-kind-scale.test.ts      |
| FTIR assignments re-attach to the nearest peak (20 cm⁻¹) after reprocessing; none dropped silently    | tests/ftir-assignments.test.ts      |
| FTIR files stating reflectance (heading or ##YUNITS) are read as transmittance with a warning         | tests/ftir-reflectance-kind.test.ts |

## 19b: validation of the UV-Vis, FTIR and Particles tools

Every numerical method of the three tools, with its tests and which of the three kinds of check
it has:

- S: synthetic data with a known answer.
- I: an independent implementation or a published worked example.
- R: a round-trip or invariance check.

The independent references are new in 19b:

- Scripts: scripts/validation/spectra/uvvis.py, scripts/validation/spectra/ftir.py,
  scripts/validation/particles/make_particles.py and
  scripts/validation/particles/ImageJCheck.java.
- They run in the "spectra-particles" job of .github/workflows/validation.yml and write the
  fixtures uvvis-reference.json, ftir-reference.json, particles.pgm, particles-skimage.json and
  particles-imagej.json to tests/fixtures/validation/.
- The tests tests/validation-uvvis.test.ts, tests/validation-ftir.test.ts and
  tests/validation-particles.test.ts compare the site with those fixtures.
- Versions used for the committed fixtures: NumPy 2.5.4, SciPy 1.18.1, scikit-image 0.26.0,
  lmfit 1.3.4, pybaselines 1.2.1, ImageJ 1.54f.

### Inventory

| Tool      | Method (code)                                                           | Tests                                                    | S   | I                                      | R   |
| --------- | ----------------------------------------------------------------------- | -------------------------------------------------------- | --- | -------------------------------------- | --- |
| UV-Vis    | E = hc/λ, %T ↔ A, Kubelka–Munk (conversions.ts)                         | uvvis-conversions, validation-uvvis                      | ✓   | scipy.constants hc/e                   | ✓   |
| UV-Vis    | Blank, offset, smoothing, λmax (process.ts)                             | uvvis-process, validation-uvvis                          | ✓   | savgol_filter (smoothing)              | ✓   |
| UV-Vis    | α from A and thickness, Tauc quantity (tauc.ts `absorptionSignal`)      | uvvis-tauc, validation-uvvis                             | ✓   | NumPy                                  | ✓   |
| UV-Vis    | Tauc line, Eg and σ(Eg) (`fitBandGap`)                                  | uvvis-tauc, validation-uvvis                             | ✓   | curve_fit, delta method                | ✓   |
| UV-Vis    | Baseline crossing, subtraction, second component (19a)                  | uvvis-tauc-baseline, uvvis-component                     | ✓   | hand results, Monte Carlo              | ✓   |
| UV-Vis    | Urbach energy (`urbachFit`)                                             | uvvis-tauc, validation-uvvis                             | ✓   | curve_fit                              | ✓   |
| UV-Vis    | Derivative maximum (`derivativeMaximum`)                                | uvvis-tauc, validation-uvvis                             | ✓   | numpy.polyfit lines                    | –   |
| UV-Vis    | Beer–Lambert calibration (concentration.ts)                             | uvvis-concentration, validation-uvvis                    | ✓   | linregress, curve_fit                  | ✓   |
| UV-Vis    | Pseudo-first-order kinetics                                             | uvvis-concentration, validation-uvvis                    | ✓   | curve_fit                              | –   |
| UV-Vis    | Plasmon band fit on the energy axis (plasmon.ts)                        | uvvis-film, validation-uvvis                             | ✓   | lmfit Lorentzian                       | –   |
| UV-Vis    | Swanepoel envelope method (swanepoel.ts)                                | uvvis-film                                               | ✓   | Swanepoel (1983) Table 1               | ✓   |
| FTIR      | %T ↔ A (process.ts)                                                     | ftir-core, validation-ftir                               | ✓   | –                                      | ✓   |
| FTIR      | ATR depth and correction (atr.ts)                                       | ftir-atr, validation-ftir                                | ✓   | open (no published table read)         | ✓   |
| FTIR      | Rubber band (baseline.ts)                                               | ftir-core, validation-ftir                               | ✓   | Qhull (scipy ConvexHull)               | ✓   |
| FTIR      | Modified polyfit (xrd/process/background.ts)                            | ftir-core, validation-ftir                               | ✓   | pybaselines modpoly                    | ✓   |
| FTIR      | AsLS, arPLS (math/whittaker.ts)                                         | ftir-core, baseline-validation, validation-ftir          | ✓   | pybaselines asls, arpls                | –   |
| FTIR      | Peak picking, prominence, parabola vertex (peaks.ts)                    | ftir-core, validation-ftir                               | ✓   | find_peaks, peak_prominences           | ✓   |
| FTIR      | Second derivative (bands.ts, Savitzky–Golay)                            | ftir-bands, validation-ftir                              | ✓   | savgol_filter deriv=2                  | –   |
| FTIR      | Band area above a straight line                                         | ftir-bands, validation-ftir                              | ✓   | scipy trapezoid                        | ✓   |
| FTIR      | Spectrum subtraction and its factor                                     | ftir-bands, validation-ftir                              | ✓   | numpy lstsq                            | ✓   |
| FTIR      | Band fitting (`fitBandRegion`, the XRD peak fit)                        | ftir-bands, validation-ftir, validation-lmfit (stage 18) | ✓   | lmfit Gaussian × 2                     | –   |
| FTIR      | JCAMP-DX reading (jcamp.ts)                                             | ftir-core                                                | ✓   | open (no instrument file)              | –   |
| FTIR      | Group suggestions (assign.ts, data/ftir/groups.json)                    | ftir-groups, ftir-assignments                            | ✓   | one review article (see below)         | –   |
| Particles | Auto thresholds (autoThreshold.ts, threshold.ts)                        | particles-imagej, particles-detect, validation-particles | ✓   | scikit-image; ImageJ (workflow)        | –   |
| Particles | Grey, blur, median, background, range, equalise (image.ts, adjust.ts)   | particles-detect, particles-imagej                       | ✓   | –                                      | –   |
| Particles | Labelling, morphology, distance, watershed (label.ts, morphology.ts, …) | particles-detect                                         | ✓   | skimage.measure.label (count)          | –   |
| Particles | Area, centroid, equal-area diameter, Feret, perimeter (regions.ts)      | particles-detect, validation-particles                   | ✓   | regionprops; ImageJ (workflow)         | ✓   |
| Particles | Fitted ellipse (measure.ts)                                             | particles-imagej, validation-particles                   | ✓   | regionprops moments; ImageJ (workflow) | ✓   |
| Particles | Scale bar, calibration, working copy (scaleBar.ts, geometry.ts)         | particles-stereology, particles-geometry                 | ✓   | –                                      | ✓   |
| Particles | Percentiles, summary, bins, histogram (distribution.ts)                 | particles-distribution, validation-particles             | ✓   | numpy percentile, histogram_bin_edges  | ✓   |
| Particles | Normal and lognormal fits                                               | particles-distribution, validation-particles             | ✓   | scipy norm.fit, lognorm.fit(floc=0)    | –   |
| Particles | Pooling images (modules/particles/sizes.ts `collectSizes`)              | particlesDistribution, validation-particles              | ✓   | –                                      | ✓   |
| Particles | Area fraction, intercepts, ASTM grain size (stereology.ts)              | particles-stereology                                     | ✓   | ASTM E112-13 Table 4                   | ✓   |

A dash under I means that no second program computes the same thing in a way worth comparing:
image filters whose exact kernels differ between programs, or a parser. A dash under R means
that no natural invariance exists beyond the ones already tested.

### UV-Vis

Data: tests/fixtures/validation/uvvis-reference.json, written by uvvis.py. Seeded synthetic
spectra, stored with the expected numbers so both programs use the same input:

- A direct gap at 3.2 eV in a 250 nm film, 300–600 nm in 0.5 nm steps, noise 0.002 in A.
- An Urbach tail with Eu = 0.08 eV.
- Six Beer–Lambert standards and a kinetic series with a dark period.
- A Lorentzian plasmon band at 2.38 eV.

| Check                                                                     | Reference                              | Tolerance                   |
| ------------------------------------------------------------------------- | -------------------------------------- | --------------------------- |
| hc/e in eV nm                                                             | scipy.constants (CODATA 2022)          | 10⁻¹⁵ relative              |
| α = ln 10 · A / t and (αE)² from absorbance and thickness                 | NumPy                                  | 10⁻¹² relative              |
| Tauc line slope and intercept, Eg = −a/b                                  | scipy curve_fit                        | 10⁻⁷ relative; 10⁻⁸ eV      |
| σ(Eg) from the full covariance of (a, b)                                  | delta method on curve_fit's covariance | 10⁻⁶ relative               |
| Urbach Eu and σ(Eu)                                                       | curve_fit of ln S                      | 10⁻⁹; 10⁻⁶ relative         |
| Derivative maximum of A and of ln A                                       | numpy.polyfit lines through 9 points   | same point; slope 10⁻⁹      |
| Savitzky–Golay smoothing (11 points, order 3), ends included              | savgol_filter(mode='interp')           | 10⁻¹²                       |
| Beer–Lambert slope, intercept, their σ and R²; line through the origin    | scipy.stats.linregress; curve_fit      | 10⁻⁹ to 10⁻¹² relative      |
| Rate constant k and σ(k)                                                  | curve_fit of ln(C₀/C) = k t            | 10⁻⁹; 10⁻⁶ relative         |
| Plasmon centre, FWHM, height, σ of centre and FWHM                        | lmfit LorentzianModel + LinearModel    | 10⁻⁶ eV, 10⁻⁵, 10⁻³ (σ)     |
| %T → A → %T and λ → E → λ                                                 | round trip                             | 10⁻¹²; 10⁻¹⁰ nm             |
| Points given in reverse order                                             | invariance                             | same Eg and σ to 10⁻¹²      |
| Signal × 10⁻⁴, 0.37 and 52 (unknown thickness, other units); Urbach × 10³ | invariance                             | Eg to 10⁻¹⁰ eV; Eu to 10⁻¹⁰ |
| The same spectrum given as %T                                             | invariance                             | same α to 10⁻¹⁰ relative    |

Definitions:

- σ(Eg) uses s² = RSS/(n − 2), as curve_fit's default (absolute_sigma=False).
- The line through the origin uses s² = RSS/(n − 1), as curve_fit with one parameter.
- lmfit's Lorentzian has FWHM = 2σ and height = amplitude/(πσ); the fixture is converted to
  this site's centre, FWHM and height.

### FTIR

Data: tests/fixtures/validation/ftir-reference.json, written by ftir.py. A seeded spectrum from
400 to 4000 cm⁻¹ in 2 cm⁻¹ steps: nine Gaussian and Lorentzian bands on a curved background,
noise 0.002.

| Check                                                                   | Reference                                          | Tolerance                  |
| ----------------------------------------------------------------------- | -------------------------------------------------- | -------------------------- |
| Peaks above prominence 0.02: count, height, prominence                  | scipy.signal.find_peaks, peak_prominences          | same peaks; 10⁻¹²          |
| Peak position (vertex of the parabola through three points)             | numpy.polyfit order 2                              | 10⁻⁷ cm⁻¹                  |
| Second derivative (15 points, order 3), ends included                   | savgol_filter(deriv=2, delta=2, mode='interp')     | 10⁻¹²                      |
| Band area 1551.3–1799.1 cm⁻¹ above the line between the ends            | scipy.integrate.trapezoid with numpy.interp ends   | 10⁻¹² relative             |
| Subtraction factor, reference on a grid shifted by 1 cm⁻¹               | numpy.linalg.lstsq                                 | 10⁻¹² relative             |
| AsLS baseline (λ 10⁵, p 0.01, 10 solves)                                | pybaselines whittaker.asls                         | 10⁻⁸                       |
| arPLS baseline (λ 10⁵, ratio 10⁻⁶)                                      | pybaselines whittaker.arpls                        | 10⁻⁹ (after the fix below) |
| Modified polyfit, order 3, 200 fits                                     | pybaselines polynomial.modpoly(use_original=False) | 10⁻⁹                       |
| Rubber band                                                             | lower hull from Qhull (scipy.spatial.ConvexHull)   | 10⁻¹²                      |
| Two overlapping Gaussian bands: centre, FWHM, height, σ                 | lmfit GaussianModel × 2 + LinearModel              | 10⁻⁴ cm⁻¹, 10⁻⁵, 10⁻³ (σ)  |
| %T → A → %T                                                             | round trip                                         | 10⁻¹²                      |
| Constant offset added: peaks, prominences, band area                    | invariance                                         | unchanged to 10⁻⁹          |
| Spectrum × 2.5: band area and subtraction factor                        | invariance                                         | × 2.5 to 10⁻¹²             |
| Known amount (0.6) of reference: factor, and nothing left after removal | synthetic, known answer                            | 10⁻¹²                      |
| ATR depth at 500, 1000 and 2000 cm⁻¹; correction at the reference       | invariance (dp ∝ 1/ν̃)                              | 10⁻¹²                      |
| Straight background added: rubber band and polyfit follow it            | invariance                                         | 10⁻¹⁰; 10⁻⁸                |

Fault found and fixed: the arPLS weights used the standard deviation of the negative residuals
with divisor n; pybaselines uses n − 1 (ddof = 1, "since sampling a subset"). The baselines
differed by up to 1.7 × 10⁻⁵ in absorbance, 0.015 % of the baseline. src/core/math/whittaker.ts
now uses n − 1, and the comparison holds to 10⁻⁹. Every earlier test, including the earlier check
against pybaselines (tests/baseline-validation.test.ts) and the XRD backgrounds, still passes.

Definitions that differ between programs:

- Modified polyfit. Each pass clips the data that the earlier passes already clipped. pybaselines
  calls this the form of Gan et al. (2006) and makes it its default (use_original=False). It
  attributes clipping the original data each pass to Lieber and Mahadevan-Jansen (2003), whom the
  code comment cites. The two programs also stop differently: this site stops when the clipped
  data change by less than 10⁻³, pybaselines when the fit does. They are compared after the same
  number of fits.
- Peak positions. scipy's find_peaks takes the middle of a flat top; this site takes the first
  point. Measured spectra have no exactly flat tops, so both find the same peaks.

### Particles

Data: tests/fixtures/validation/particles.pgm, a 192 × 160 8-bit test image written by
make_particles.py. It holds 14 bright ellipses of known axes (7 to 34 px) and angles on a dark
background with noise σ 11, with edges supersampled 4 × 4. scikit-image, NumPy and SciPy results
are in particles-skimage.json. ImageJ's results go to particles-imagej.json, written by
ImageJCheck.java in the workflow.

| Check                                                                          | Reference                                        | Tolerance                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------- |
| Otsu, Default (IsoData), Minimum, Triangle                                     | skimage.filters threshold_*                      | same grey level (118, 118, 115, 82)           |
| Li; Mean                                                                       | threshold_li (103.49); threshold_mean (66.86)    | within 1 level; ⌊mean⌋                        |
| Particles above 127: number, pixel count, centroid, equal-area diameter        | skimage.measure.label (8-connected), regionprops | exact; 10⁻⁹                                   |
| Ellipse axes from the second moments                                           | regionprops inertia_tensor_eigvals               | 10⁻⁹                                          |
| Ellipse axes and angle against the drawn ellipses                              | synthetic, known answer                          | 1.2 px; 3°                                    |
| 90° turn, left-right mirror, top-bottom flip                                   | invariance                                       | sizes unchanged to 10⁻⁹; angle +90°, 180° − θ |
| Image enlarged × 2 (nearest neighbour)                                         | invariance                                       | area × 4, Feret × 2 exactly; ellipse 1 %      |
| Percentiles (10, 25, 50, 75, 90), mean, sample SD of 300 lognormal sizes       | numpy.percentile (linear), mean, std(ddof=1)     | 10⁻¹⁰                                         |
| Sturges and Freedman–Diaconis bins, bin width and counts                       | numpy.histogram_bin_edges, numpy.histogram       | exact; 10⁻¹⁰                                  |
| Normal and lognormal fits and their log-likelihoods                            | scipy.stats norm.fit, lognorm.fit(floc=0)        | 10⁻⁹; 10⁻⁷                                    |
| Two pooled images, in either order                                             | invariance                                       | same summary as all sizes together            |
| Every automatic threshold; area, centroid, ellipse, Feret, MinFeret, perimeter | ImageJ 1.54f (AutoThresholder, ParticleAnalyzer) | same level; 10⁻³ (from the workflow)          |

Definitions that differ between programs:

- scikit-image puts pixel centres at whole numbers; this site and ImageJ put pixel corners there.
  The fixture adds 0.5.
- scikit-image's ellipse axes are 4√λ of the pixel-centre covariance. ImageJ's, which this site
  copies, add 1/12 for each pixel's own extent and then scale both axes so that the ellipse area is
  the pixel count. The test applies that step to scikit-image's eigenvalues.
- scikit-image's feret_diameter_max and perimeter use the marching-squares contour through pixel
  centres. This site and ImageJ use the pixel-edge outline. These are different quantities and are
  compared only with ImageJ.
- scikit-image's Li iterates on continuous values and its Mean is not rounded; ImageJ rounds to a
  whole grey level.
- Perimeter: this site now uses ImageJ's traced perimeter (PolygonRoi.getTracedPerimeter):
  summed sides minus 2 − √2 at each counted corner, where on a staircase of unit steps only every
  other vertex counts, starting where ImageJ's Wand starts. Before the ImageJ comparison the site
  cut 1 − √2/2 at every corner, which read up to 2.9 % longer (62.77 against 61.01 px); fixed, see
  "Faults found by ImageJ" below. Because the count depends on the start, a turned or mirrored
  image can change a perimeter by a whole number of (2 − √2), within 5 % (tested).
- The perimeter of a × 2 enlarged image is not always twice the perimeter. Enlarged, every corner
  counts; a unit staircase doubles exactly and a 2 × 2 square reads 1.207 times twice. The test
  checks that the ratio lies between 1 and 1.207 (1.02 to 1.04 on the test image). The site
  measures on a working copy made by averaging, never by enlarging.
- Triangle threshold: this site follows ImageJ, which moves the split one more level towards the
  tail. scikit-image's threshold_triangle stops one level short for a bright tail (82 against 83
  on the test image); the test expects that one level.

Faults found by ImageJ (the workflow's ImageJ 1.54f run, 2026-11-14), both fixed with tests:

- Perimeter and circularity used a different corner rule from ImageJ's (above). Now equal to
  ImageJ's Perim. to 10⁻³ px for all 14 particles; a square's circularity reads 0.886, as in
  ImageJ.
- Triangle gave 82 where ImageJ gives 83: the extra level towards the tail was applied only for a
  dark tail. Rewritten step by step from ij/process/AutoThresholder.Triangle.

All other ImageJ checks passed on the first run: Default, Intermodes, IsoData, Li, MaxEntropy,
Mean, Minimum, Moments and Otsu levels; area exactly; centroid to 10⁻⁶ px; Major, Minor, Feret and
MinFeret to 10⁻³; ellipse angle to 0.01°.

### Real files

tests/fixtures-real/ holds XRD files (Bruker .raw and .brml, Rigaku .rasx) and, since 19b, two
real UV-Vis files in tests/fixtures-real/uvvis/: diffuse reflectance of TiO₂ annealed at 200 and
300 °C, 208 to 848 nm in 2 nm steps, from Zenodo record 10.5281/zenodo.14608640 (Kuzhir,
Maltanava and Belko, 2025, CC BY 4.0). No published band gap goes with them: the record gives
none, and the one Zenodo dataset found with a paper (Fe₂O₃–TiO₂, doi:10.1016/j.cattod.2022.02.005)
links to a closed-access article. So the files check the reader and the arithmetic on real data,
against scripts/validation/spectra/uvvis_real.py (tests/validation-uvvis-real.test.ts):

| Check                                           | Reference                     | Tolerance      |
| ----------------------------------------------- | ----------------------------- | -------------- |
| Reading: 325 points, semicolons, decimal commas | plain Python reader           | exact          |
| F(R) = (1 − R)² / 2R                            | NumPy                         | 1e-12 relative |
| Direct Tauc line, 3.25–3.60 eV: Eg and σ(Eg)    | scipy curve_fit, delta method | 1e-8 eV; 1e-6  |
| Indirect Tauc line, 3.10–3.30 eV: Eg and σ(Eg)  | scipy curve_fit, delta method | 1e-8 eV; 1e-6  |
| Row order reversed; % and fraction              | invariance                    | 1e-12 eV       |
| Suggested direct region on the edge             | the fixed-window gap          | 0.04 eV        |

With those windows: direct 3.231 ± 0.006 eV (200 °C) and 3.217 ± 0.005 eV (300 °C); indirect
2.884 ± 0.003 eV and 2.872 ± 0.002 eV. The windows were chosen by eye on the steep part of the
edge; they are not a published analysis.

Fault found with these files and fixed. The suggested Tauc region picked the slow, straight rise
above the edge, where F(R) saturates at low reflectance (4.6 to 5.4 eV, giving 3.72 eV for the
direct plot and no gap at all for the indirect one). suggestRegion now checks the chosen line:
when it meets y = 0 above the steepest part of the edge, or at or below zero, the region is chosen
again among the windows that overlap that steepest part. A region chosen on the edge is not
changed, so every synthetic result above and in 19a is unchanged. Suggested now: direct 3.221 and
3.249 eV, indirect 2.885 eV (200 °C).

The files have no header, so the site guesses transmittance and the user chooses reflectance, as
for any file without one. There is a small step in R at 690 nm (a lamp or detector change in the
instrument), well below the edge.

FTIR and particle files: none yet. Each is listed under Open with the file needed and, for the same
file, the numbers the instrument software gives.

### FTIR group table

data/ftir/groups.json comes from one review article: Pasieczna-Patkowska, Cichy and Flieger,
Molecules 30 (2025) 684, Tables 3 and 2. Its transcription was checked against the article on
2026-10-28. It is still one review's typical ranges, not a textbook table, and is flagged for the
owner's verification; the site shows every suggestion as a ranked estimate with this source.

Rows the owner should compare with a textbook (for example Socrates, Infrared and Raman
Characteristic Group Frequencies, or Silverstein's tables). The reasons below come from the table
itself, not from other values:

- Single wavenumber given as a range: fg-25 aromatic ring C=C str. (phenol) 1660–1660
- Single wavenumber given as a range: fg-47 aromatic C–H def. vib. in phenolic compounds 1110–1110
- Unusually wide range: fg-35 in-plane O–H def. vib. (alcohol) 1260–1440
- Unusually wide range: fg-54 N–H out-of-plane b. vib. 650–895
- Unusually wide range: fg-23 COO⁻ asym. str. 1540–1695
- Unusually wide range: fg-19 C=O (carboxylic acids) 1650–1740
- The same range under two labels: fg-7 (2° amides, N–H str.) and fg-8 (O–H, N–H) are both
  3270–3370.
- A label that names amines under "amide III": fg-44 C–N str. (amide III) (2° amines),
  1200–1305, 1170–1190 and 1130–1145.
- The metal-oxide rows (13), single band positions, for example ZnO 440 to 878 cm⁻¹ and TiO₂
  anatase 431 to 800 cm⁻¹. A position depends strongly on particle size and shape, so compare
  these with measured references of the same material.

### Open

- ATR penetration depth: no published table could be read. The PIKE application note at the old
  address returned 404. The formula is Harrick's and is checked by invariance only. Needed: one
  printed row with crystal, n₁, n₂, angle, wavenumber and dp.
- Modified polyfit: which clipping rule Lieber and Mahadevan-Jansen (2003) use, the clipped data
  or the original data each pass, should be checked in the paper (Appl. Spectrosc. 57,
  1363–1367). pybaselines' description and the earlier "checked against the paper" note do not
  agree.
- Real UV-Vis file with a published or software band gap: still wanted. The TiO₂ files above have none. Wanted: a film or powder spectrum (.csv or .txt export) and the Eg that the instrument or Origin gives for a stated Tauc region.
- Real FTIR file wanted: a JCAMP-DX (.jdx) export and the peak table the instrument software (OMNIC, OPUS or Spectrum) prints for it, with its threshold.
- Real particle image wanted: an SEM or TEM image with a scale bar and the ImageJ Analyze Particles table (Area, Feret, MinFeret, Perim.) for a stated threshold.

## 19c: FTIR peak table, hand edits and comparison across samples

New methods: width at half height and area above a local baseline, an intensity class, hand-added
and removed peaks, and the grouping of peaks of several samples into bands
(src/core/ftir/peakShape.ts, src/core/ftir/compare.ts, src/modules/ftir/analysis.ts).

Local baseline: the straight line through the lowest data point on each side of a band, searched
up to the neighbouring band or the end of the search range (the valley-to-valley baseline of band
integration). Width: where the absorbance above that line falls to half the band's height, with
linear interpolation between points. Area: trapezoid rule above the line, in absorbance · cm⁻¹.

### Checks

Data: tests/fixtures/validation/ftir-peaks-reference.json, written by
scripts/validation/spectra/ftir_peaks.py (numpy 2.5.4, scipy 1.18.1).

| Check                                                                          | Reference                                                       | Tolerance            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------- |
| Isolated Gaussian, FWHM 30 cm⁻¹, height 0.5: width and area                    | synthetic: FWHM, h · FWHM · √(π / (4 ln 2))                     | 0.05 cm⁻¹; 5 × 10⁻⁴  |
| Isolated Lorentzian, FWHM 20 cm⁻¹, ±500 cm⁻¹: width and area                   | synthetic: exact values for the band cut at ±500 cm⁻¹           | 0.05 cm⁻¹; 5 × 10⁻⁴  |
| The same two bands                                                             | scipy.signal.peak_widths (rel_height 0.5), trapezoid            | 10⁻⁶                 |
| Two bands on a sloping, curved, noisy background: limits, height, FWHM, area   | baseline written with numpy; peak_widths and trapezoid above it | same points; 10⁻⁶    |
| Constant offset added; spectrum × 3                                            | invariance                                                      | unchanged; × 3, 10⁻⁹ |
| Mirror image of the spectrum (wavenumber reversed)                             | invariance                                                      | 10⁻⁹                 |
| Bands 25 cm⁻¹ apart (FWHM 30) flagged as overlapping; 100 cm⁻¹ apart not       | synthetic, known answer                                         | exact                |
| Grouping of three samples with known shifts (+3 and −4 cm⁻¹, one band missing) | synthetic, known answer                                         | exact                |
| Grouping after 20 random reorderings of samples and peaks                      | invariance                                                      | identical            |
| Removed and added peaks with baseline and smoothing switched on and off        | invariance (edits kept by position)                             | same peaks           |
| Spectral regions of the figure                                                 | envelope of the named rows of data/ftir/groups.json             | exact                |

The Lorentzian area above the local baseline is smaller than the full analytic area π · h · FWHM /
2, because the line between the two ends removes the wings; the test uses the exact value for the
cut band. This is why the table marks areas as measured above a local baseline.

Choices of this site, stated on screen: the intensity classes (strong from 60 %, medium from 25 %
of the highest band above its local baseline, broad from 100 cm⁻¹ FWHM; IR tables use s, m, w and
br without numeric limits), the overlap flag (the valley to a neighbour lies above half the
band's height), the 10 cm⁻¹ snap distance for a peak added by hand and the 10 cm⁻¹ default
grouping tolerance (2.5 times the common 4 cm⁻¹ resolution).

### Open

- Peak table against instrument software: the FWHM and area that OMNIC, OPUS or Spectrum report for one band of a real file, with their baseline points. No such file is in tests/fixtures-real/. Closed by the owner on 2026-11-15: no raw files are available to test with.
- Grouping across samples: no other program with the same rule (one peak per sample, span at most the tolerance) was found, so the rule is checked by the known-answer and order tests only.

## 19d: FTIR reflectance, CO₂ line and normalisation to a band

New methods (src/core/ftir/process.ts, src/core/ftir/assign.ts):

- Kubelka–Munk function F(R) = (1 − R)² / (2R), R the diffuse reflectance as a fraction (default
  for reflectance data), and the apparent absorbance log₁₀(1/R) as the alternative.
- CO₂ line: the absorbance between two wavenumbers (default 2280–2400 cm⁻¹, around the 2349 cm⁻¹
  band of data/ftir/atmosphere.json; the width is this site's choice, adjustable) is replaced by
  the straight line between the values interpolated at the two limits. It runs first, before ATR,
  baseline, smoothing and normalisation, and peaks are not picked inside it.
- Normalisation to a band: the spectrum is divided by the height or the trapezoid area of a
  chosen range, both measured above the straight line between the range ends (bandArea, the
  local baseline of the Bands step). A band is counted as absent, and the spectrum is left unchanged with a
  warning, when the maximum lies at an end of the range, when the height is not above
  max(3 × the local noise, 10⁻⁹ × the largest |A|), or when the value is zero or negative.
- Suggestions: when a table label says "broad", a broad peak (from the peak's FWHM and the 19c
  broad class) is ranked before a narrow one at the same distance, and the reason says so.

### Checks

Data: tests/fixtures/validation/ftir-processing-reference.json, written by
scripts/validation/spectra/ftir_processing.py (numpy 2.5.4, scipy 1.18.1), a step in the
Validation workflow.

| Check                                                                       | Reference                                    | Tolerance    |
| --------------------------------------------------------------------------- | -------------------------------------------- | ------------ |
| F(R) at R = 0.5, 0.2, 1 (0.25, 1.6, 0); percent and fraction give the same  | synthetic, exact values                      | 10⁻¹²        |
| R recovered from F(R): R = 1 + F − √(F² + 2F)                               | round trip                                   | 10⁻¹²        |
| Zero reflectance points removed with a message                              | synthetic                                    | exact        |
| CO₂ line on a band over a linear baseline recovers the line at its ends     | synthetic, known answer                      | 10⁻⁶         |
| CO₂ line with the limits swapped; applied twice                             | invariance, idempotence                      | identical    |
| Peaks inside the CO₂ range (picked and added by hand) are not reported      | synthetic                                    | exact        |
| Band height and area of a Gaussian (1400–1800 cm⁻¹): h and h·FWHM·√(π/4ln2) | synthetic, known answer                      | 10⁻¹⁰; 10⁻⁶  |
| Normalisation of the spectrum × 7.5; limits swapped                         | invariance                                   | 10⁻¹²        |
| Absent, end-of-range, outside, untyped and negative bands give a warning    | synthetic                                    | exact        |
| F(R), log₁₀(1/R), CO₂ line, band height and area on a noisy spectrum        | numpy (np.interp), scipy.integrate.trapezoid | 10⁻¹²; 10⁻¹⁰ |
| Broad table row ranked first for a broad peak, last for a narrow one        | synthetic                                    | exact        |

The numpy and scipy check is a second implementation of the same equations, not another
program's own conversion; it catches indexing, interpolation and integration errors only.

### Open

- Kubelka–Munk: no published worked example (a measured R with its tabulated F(R)) was found to compare with, and no real DRIFTS file is in tests/fixtures-real/ (closed by the owner on 2026-11-15: no raw files are available). The assumptions shown on screen (optically thick, diluted, strongly scattering layer) are the general conditions of the theory, stated without a specific citation.
- CO₂ region: the real width of the CO₂ doublet in a lab spectrum was not measured; 2280–2400 cm⁻¹ is a default to adjust.
- Broad ranking: only four rows of data/ftir/groups.json say "broad", so the rule is tested on those.
- Wider group table (19d item 4): done on 2026-11-15, see "19d item 4" below.

## 19d item 4: wider FTIR group table (2026-11-15)

The owner supplied the PDFs of the candidate sources. Only tables under a licence that allows
redistribution without conditions beyond attribution (CC BY) were added; each row keeps its
source, and each suggestion names it.

| Source                                                                                    | Licence   | Rows added                                   |
| ----------------------------------------------------------------------------------------- | --------- | -------------------------------------------- |
| Al-Amin et al., Nanoscale Adv. 7 (2025) 6677, Table 1, doi:10.1039/d5na00522a             | CC BY 4.0 | 27 (inorganic: M–O, carbonate, sulfate, ...) |
| Elgayyar et al., Phys. Chem. Chem. Phys. 27 (2025) 22871, Table 1, doi:10.1039/d5cp02197a | CC BY 4.0 | 4 (the four fundamental modes of carbonate)  |
| Gautam et al., ISRN Ceramics 2012 (2012) 428497, Table 6, doi:10.5402/2012/428497         | CC BY     | 22 of 23 (borate glasses; "<600" left out)   |

Added on 2026-11-15 with the owner's approval (non-commercial licences and one closed book). These
rows are typed in scripts/ftir-groups-added.ts, each with its table and page, because the book's
text may not be stored in a public repository, Bishop's tables are images and the other two are
short:

| Source                                                                                                 | Licence                                  | Rows added                                                            |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------- |
| Socrates, Infrared and Raman Characteristic Group Frequencies, 3rd edn, Wiley 2001, ISBN 0-471-85298-8 | all rights reserved; band positions only | 17 (alkyne, aldehyde C–H, nitro, C–F, C–Cl, C–Br, S=O, P=O, P–O–C)    |
| Kaaouass et al., Heliyon 10 (2024) e31219, Table 2 (IR rows), doi:10.1016/j.heliyon.2024.e31219        | CC BY-NC 4.0                             | 5 (Mn borovanadate glasses; each range spans the five compositions)   |
| Bishop et al., Earth Space Sci. 8 (2021) e2021EA001844, Tables 9 and 10, doi:10.1029/2021EA001844      | CC BY-NC 4.0                             | 6 minerals (magnesite, calcite, aragonite, LiNO₃, NaNO₃, KNO₃), ν1–ν4 |
| Luo et al., RSC Adv. 12 (2022) 24055, Tables 1 and 3, doi:10.1039/d2ra03539a                           | CC BY-NC 4.0                             | CeO₂ (436) and LaAlO₃ (646, 402), calculated by DFT and labelled so   |

Method: the text of each table page is taken from the PDF with `pdftotext -layout` and cached
unedited in data/ftir/source/*.txt; scripts/ftir-groups-parse.ts reads it and
scripts/build-ftir-groups.ts writes data/ftir/groups.json. Glyphs the PDF fonts print wrongly
("]" for "=", "^" for "≡", "n" for ν) and the lost sub- and superscripts of formulas are written
back by explicit pairs in the parser. Every row was compared with the rendered page.

### Checks

Tests: tests/ftir-groups.test.ts.

| Check                                                                              | Reference                        | Tolerance |
| ---------------------------------------------------------------------------------- | -------------------------------- | --------- |
| groups.json equals what the parser reads from each cached table                    | round trip, the cached text      | identical |
| Row counts 27, 4, 22 (Gautam's open-ended "<600" row left out)                     | the printed tables               | exact     |
| S–H 2550–2600, M=O 850–1000, M≡N 1000–1100, nitrate bend 800–850 (Al-Amin)         | the rendered page                | exact     |
| Carbonate ν2 850–880 (Elgayyar); "∼875" approximate and "806" not (Gautam)         | the rendered page                | exact     |
| Formula pairs change only the formulas                                             | synthetic text                   | exact     |
| Every row's source exists, with a CC BY licence, a DOI and a verification note     | the data file                    | —         |
| The book has no DOI, its ISBN and "all rights reserved"; the three others CC BY-NC | the data file                    | —         |
| Typed rows unchanged in groups.json; counts 17 (Socrates) and 5 (Kaaouass)         | scripts/ftir-groups-added.ts     | exact     |
| C≡C 2100–2150, Fermi 2650–2745, P=O 1175–1350 (Socrates); BO₄ 830–888 (Kaaouass)   | the rendered pages               | exact     |
| Calcite 1420, 1067, 888, 716; KNO₃ ν3 1424 (Bishop); CeO₂ 436, calculated (Luo)    | the rendered pages               | exact     |
| A matched mineral band is named ("Calcite (CaCO₃), CO₃²⁻ ν3, asymmetric stretch")  | the data file                    | exact     |
| 890 cm⁻¹: Al-Amin's 880–900 (inside) and Elgayyar's 850–880 (10 cm⁻¹) both offered | sources that disagree, both kept | exact     |

The second of the three ways (an independent implementation) does not apply to a transcription;
the check is the row-by-row comparison with the rendered page, recorded in each source's
`verification` field.

### Open

- Not added, licence: Hadjiivanov et al., Chem. Rev. 2021 (MOFs, CC BY-NC-ND: no derivatives);
  Taylor, Proc. Indian Acad. Sci. 1990 (no open licence stated); Naumenko et al. 2008 (Raman of
  zirconia, not IR; no licence stated).
- Not added, no general table: Kaaouass et al., Biointerface Res. Appl. Chem. 2022 (CC BY; bands
  observed in one glass system), Alnehia et al., Discover Nano 2026 (CC BY; one sample, no band
  table), and Rao et al., Ceram. Int. 2019 (zirconia-toughened alumina, supplied by the owner;
  bands observed in its own samples only).
- Not added, not practical to transcribe reliably: Hunt, Wisherd and Bonham, Anal. Chem. 22 (1950)
  1478 (supplied by the owner). Its Table I is a rotated scan of band positions in micrometres for
  each mineral; the text cannot be extracted reliably, and typing hundreds of cells by eye and
  converting them (10⁴/λ) would add more risk of error than it is worth next to Bishop's measured
  carbonate and nitrate bands.
- Still missing from the table: Al–O and band lists for individual oxides (Al₂O₃, MgO, ZrO₂, MnO₂,
  WO₃, V₂O₅, ferrites); Al-Amin et al. give only class-wide ranges (M–O, M=O, Fe–O/Co–O/Zn–O). CeO₂
  and LaAlO₃ are calculated positions only.

## 19e: UV-Vis peak table, path length, cross-checks and optical constants

New methods (src/core/uvvis/peaks.ts, crossChecks.ts, optics.ts):

- Band table: local maxima of the cleaned absorbance (F(R) for diffuse reflectance) with the
  prominence picker of the FTIR tool on the wavelength axis, each position refined by the parabola
  through the highest point and its two neighbours, E = hc/λ. Shoulders are second-derivative
  minima offered as suggestions. λmax in the results table keeps its old meaning (highest point).
- Path length: α = ln(10)·A/l with l a film thickness (nm) or a cuvette path (cm).
- Cody plot: (α/E)^(1/2) against E, a straight line, Eg where it meets zero (A. R. Zanatta,
  Sci. Rep. 9 (2019) 11225, citing G. D. Cody et al.).
- Sigmoid (Boltzmann) fit: α(E) = α_max + (α_min − α_max)/(1 + exp((E − E0)/δE)) (Zanatta Eq. 8),
  Eg = E0 − n·δE with n = 0.3 (direct), 4.3 (indirect), 3.6 (amorphous) (Eq. 9), σ(Eg) from the
  full covariance.
- Reflection-corrected α of a film: α = (1/d)·ln[(1 − R)²/(2T) + √((1 − R)⁴/(4T²) + R²)] (Zanatta
  Eq. 6; also Kasikov and Aarik, Bulg. J. Phys. 51 (2024) 311, Eq. 27), no substrate.
- k = αλ/(4π). n from Eg by Moss (n⁴Eg = 95 eV), Ravindra (n = 4.084 − 0.62 Eg) and Hervé–Vandamme
  (n² = 1 + (13.6/(Eg + 3.47))²), as written by S. K. Tripathy, Opt. Mater. 46 (2015) 240, Eqs. 1–3,
  shown as rough estimates with the stated ranges.

### Checks

Data: tests/fixtures/validation/uvvis-completion-reference.json, written by
scripts/validation/spectra/uvvis_completion.py (numpy 2.5.4, scipy 1.18.1), a step in the
Validation workflow. Tests: tests/uvvis-completion.test.tsx and
tests/validation-uvvis-completion.test.ts.

| Check                                                                          | Reference                                | Tolerance         |
| ------------------------------------------------------------------------------ | ---------------------------------------- | ----------------- |
| Cody Eg of S = B·E·(E − Eg)², Eg = 1.7 eV                                      | synthetic, known answer                  | 10⁻¹⁰ eV          |
| Cody Eg with S × 123                                                           | invariance                               | 10⁻¹⁰ eV          |
| Cody Eg, slope and σ(Eg) on a noisy edge                                       | scipy curve_fit, delta method            | 10⁻⁹ eV; 10⁻⁶ rel |
| Sigmoid E0, δE and Eg = E0 − n·δE (three types) on a noise-free curve          | synthetic, known answer                  | 10⁻⁶ eV           |
| Sigmoid with the range limits swapped and S × 0.01                             | invariance                               | 10⁻⁶ eV           |
| Sigmoid S_min, S_max, E0, δE, Eg and their s.u. on a noisy curve (three types) | scipy curve_fit (unweighted, covariance) | 10⁻⁶ eV; 10⁻³ rel |
| Default sigmoid range centred near E0                                          | synthetic                                | 0.03 eV           |
| Reflection-corrected α: round trip through the slab transmittance              | round trip                               | 10⁻¹⁰ rel         |
| R = 0 gives Beer–Lambert; large αd gives Zanatta Eq. 5                         | limits of the equation                   | 10⁻⁶; 10⁻⁸ rel    |
| α from T and R in five cases                                                   | scipy brentq on the slab model           | 10⁻⁹ rel          |
| k = 0.1 at 500 nm from α = 25132.74 cm⁻¹; three more cases                     | hand value; numpy                        | 10⁻¹²             |
| Ravindra(1 eV) = 3.464, HV(3.33 eV) = √5, Moss(95/16 eV) = 2; six Eg values    | hand values; numpy                       | 10⁻¹²             |
| Band positions, heights and prominences of two Gaussian bands with noise       | scipy.signal.find_peaks, numpy.polyfit   | 10⁻⁹ nm; 10⁻¹²    |
| Band removed and added by hand, shoulder accepted                              | synthetic                                | exact             |
| 1 cm cuvette: α = ln(10)·A and the same Eg as without a path                   | invariance                               | 10⁻¹⁰; 10⁻⁶ eV    |
| Reflection correction through the analysis, with its message                   | the core function                        | 10⁻⁶              |
| Version 4 session: step moved past Bands, Eg unchanged                         | round trip                               | identical         |

The SciPy script is a second implementation of the same equations; it checks the fitting, the
covariance and the root finding, not the equations themselves.

### Open

- The original papers of Cody (1981), Moss (1950), Ravindra et al. (1979) and Hervé–Vandamme (1994)
  were not opened; the equations are taken from Zanatta (2019) and Tripathy (2015). Still open after
  stage 22 (part A skipped: the papers were not supplied).
- Hervé–Vandamme B: Tripathy prints B = 3.47 eV; other secondary sources give 3.4 eV. 3.47 is used
  and flagged for verification.
- The default sigmoid range (±0.25 eV around the midpoint of the rise near the Tauc gap) is my
  reading of Zanatta's "~500 meV energy range centered in between the min-max α values".
- Zanatta gives no worked table of a fit to compare with, so no published example was run.
- Optical conductivity (σ = αnc/4π) was not built: it needs n at each wavelength together with α,
  and no SI form of the equation from a source opened in the session was found. Still open after stage
  22 (part D1 skipped: the textbook page was not supplied).
- The reflection correction models a free-standing slab; the substrate is not included, which
  Kasikov and Aarik find matters for films thinner than about 1 µm.

## 19f: particle size statistics, shapes and the session file

New methods (src/core/particles/statistics.ts):

- Standard error and confidence interval of the mean: SEM = s/√N, Ȳ ± t(1 − α/2, N − 1)·s/√N
  (NIST/SEMATECH e-Handbook of Statistical Methods, §1.3.5.2), s with divisor N − 1. The Student t
  quantile is computed from the density of §1.3.6.6.4 by Simpson's rule and Newton's method.
- Coefficient of variation CV = s/x̄ (NIST SP 960-1).
- Moment means D[1,0] = Σd/n, D[3,2] = Σd³/Σd² and D[4,3] = Σd⁴/Σd³, from the volume forms
  D[3,2] = ΣV/Σ(V/d) and D[4,3] = ΣVd/ΣV of A. Virden, "D[3,2] vs. D[4,3]" (Malvern Panalytical,
  2026), with V ∝ d³ (each particle treated as a sphere).
- Volume-weighted Dv10, Dv50, Dv90 and span: the inverted-CDF percentile with weights d³.
- Goodness of fit: Anderson–Darling A² with the mean and SD estimated (NIST §1.3.5.14), on d for
  the normal fit and on ln d for the lognormal fit, against the 5 % critical value
  0.752/(1 + 0.75/N + 2.25/N²) (M. A. Stephens, J. Am. Stat. Assoc. 69 (1974) 730, as in
  scipy.stats.anderson). Shown as a guide; Kolmogorov–Smirnov was not used because its critical
  values are not valid once the parameters come from the data (NIST §1.3.5.16).
- Shape distributions: aspect ratio (longest/shortest caliper), circularity (4π·area/perimeter²,
  ImageJ's traced perimeter) and solidity (area/convex hull area, new), of detected particles.

Number-based values stay the default; every table, CSV row and the methods text names the
weighting (number, surface or volume, the last two "assumes spheres").

### Checks

Data: tests/fixtures/validation/particle-stats-reference.json, written by
scripts/validation/particles/distribution_stats.py (numpy 2.5.4, scipy 1.18.1), a step in the
Validation workflow, on four seeded samples (lognormal n = 400, normal n = 150, n = 12, bimodal
n = 260). Tests: tests/particles-statistics.test.ts, tests/validation-particle-stats.test.ts and
tests/particles-completion.test.tsx.

| Check                                                                        | Reference                                    | Tolerance             |
| ---------------------------------------------------------------------------- | -------------------------------------------- | --------------------- |
| t(0.975, ν) for ν = 1, 2, 5, 10, 30, 100; ν → ∞ gives 1.960                  | NIST §1.3.6.7.2 table                        | 5·10⁻⁴                |
| t, lower and upper limit of the NIST worked example (N = 195)                | NIST §1.3.5.2: 1.9723, 9.258242, 9.264679    | 5·10⁻⁵; 5·10⁻⁶        |
| t(0.975, n − 1), SEM, CI on four samples                                     | scipy.stats.t.ppf, scipy.stats.sem           | 10⁻⁷; 10⁻¹⁰; 10⁻⁹ rel |
| Interval covers the true mean in about 95 % of 2000 samples (n = 12)         | synthetic, known answer                      | 93.5–96.5 %           |
| ln Φ(z) and ln(1 − Φ(z)) at nine z from −12 to 20                            | scipy.stats.norm.logcdf, logsf               | 10⁻⁹ rel              |
| CV, D[1,0], D[3,2], D[4,3] on four samples                                   | numpy                                        | 10⁻¹⁰; 10⁻¹² rel      |
| Dv10, Dv50, Dv90 on four samples                                             | numpy.percentile(weights = d³, inverted_cdf) | identical             |
| Equal sizes give that size for every mean and percentile                     | synthetic, known answer                      | 10⁻¹²                 |
| One 1 µm and one 10 µm sphere: D[4,3] = 10001/1001 µm, Dv10 = 10 µm          | hand value                                   | 10⁻¹²                 |
| D[1,0] ≤ D[3,2] ≤ D[4,3]; sizes × k scale every value; order does not matter | invariance                                   | 10⁻¹²                 |
| A² and the 5 % critical value for d and ln d on four samples                 | scipy.stats.anderson                         | 10⁻⁷ rel; 5·10⁻⁴      |
| A² unchanged when the sizes are shifted or scaled                            | invariance                                   | 10⁻⁹                  |
| About 5 % of normal samples rejected at the 5 % level; bimodal rejected      | synthetic, known answer                      | 3–7 % of 1000         |
| Discs: aspect ratio < 1.1, solidity > 0.95, circularity 0.8 to 1             | synthetic, known answer                      | as stated             |
| Session file round trip (Int32Array outlines, scale, hash); version 6 opens  | round trip                                   | identical             |

scipy.stats.anderson rounds its critical values to three decimals, hence the 5·10⁻⁴ tolerance on
the critical value.

### Open

- A real SEM or TEM micrograph measured in ImageJ by a person was not supplied, so the whole chain
  (scale, threshold, split, sizes) has not been compared with ImageJ numbers on a real image. The
  synthetic image of 19b is still the only ImageJ comparison. Closed by the owner on 2026-11-15: no raw files are available to test with.
- ISO 9276-2 (moment means and weighting) was not opened; the moment-mean equations come from the
  Malvern Panalytical article named above.
- Surface- and volume-weighted values assume spheres of the equal-area diameter; for elongated or
  porous particles they are rough estimates.

Closed by the owner (November 2026, stage 22 part D2): no polydispersity index is built. The PDI of
dynamic light scattering is a different quantity and is not reported for sizes measured on images;
the help beside the CV says so, and the CV and the span describe the width.

## 19g: binary FTIR and UV-Vis instrument files (2026-11-15)

Readers in src/core/spectrumFiles for Thermo OMNIC .spa, Bruker OPUS (.0, .1, …), PerkinElmer .sp
(Spectrum, UV WinLab) and Galactic .spc (new layout, little-endian, one or many subfiles, with or
without stored x values). The owner has no instrument files yet, so, as for the XRD packed formats,
the readers were written against openly licensed real files from public test corpora
(tests/fixtures-real/README.md): Orange-spectroscopy (GPL-3.0), rohanisaac/spc (GPL-3.0) and
specio (BSD-3-Clause). A unit code becomes an axis or a y kind only when one of these files
confirms it; any other code is passed on as "not stated", and the tool asks the user.

### Checks

Tests: tests/spectrum-files.test.ts, tests/spectrum-files-independent.test.ts.

| Check                                                                                                                                                                     | Reference                                                   | Tolerance                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| Galactic .spc, 3 files (one with 20 subfiles), every x and y                                                                                                              | the text rohanisaac/spc wrote for the same files            | x 1e-6, y relative 1e-10           |
| OPUS, every x and y of 1,816 points                                                                                                                                       | the .dpt text OPUS itself exported for the same measurement | 5e-6 (half the last printed digit) |
| OPUS point 4 (3994.330014648437 cm⁻¹, 0.90655535)                                                                                                                         | Orange-spectroscopy's test for the same file                | 1e-9, 1e-8                         |
| OMNIC .spa: 1,738 points from 3999.703125 to 649.903564453125 cm⁻¹, absorbance                                                                                            | Orange-spectroscopy's test for the same file                | 1e-6                               |
| PerkinElmer .sp: y[4] = 100.65028381347656 %T, x from 750 to 4000 cm⁻¹                                                                                                    | Orange-spectroscopy's test for the same file                | exact                              |
| PerkinElmer .sp: lowest and highest y equal the ordinate range stored in each file                                                                                        | invariant stored in the file                                | exact                              |
| OPUS: the first final-spectrum block decodes to the MXY and MNY stored with it                                                                                            | invariant stored in the file                                | exact                              |
| Galactic 32-bit and 16-bit integer y (integer · 2^(e − 32), 2^(e − 16)) on an even axis                                                                                   | synthetic files with known values                           | exact                              |
| Old or big-endian .spc, XYXY .spc, truncated .spc, OLE ".spc", OPUS without a final spectrum, PerkinElmer range that disagrees with its interval                          | refused with a plain message, not guessed                   | —                                  |
| FTIR loads all six infrared files, increasing in wavenumber, with the kind from the file; UV-Vis loads the 20 near-infrared spectra; each tool sends the other's files on | the importers                                               | —                                  |
| Every point of each file read by SpectroChemPy, brukeropusreader, spc-io and specio                                                                                       | independent readers, run by the Validation workflow         | relative 1e-6                      |

A finding of the OPUS check: peach_juice.0 holds two final-spectrum (type 15) blocks. The first
reader took the first, which differs from OPUS's own export by up to 0.017. The last block matches
the export and Orange-spectroscopy's published value, so the reader takes the last block.

### Independent readers (Validation workflow, run of 2026-11-15)

| File                            | SpectroChemPy 1.3.1                       | brukeropusreader 1.3.4 | spc-io 0.2.1       | specio 0.1.0         |
| ------------------------------- | ----------------------------------------- | ---------------------- | ------------------ | -------------------- |
| omnic_sample1.spa               | every point agrees                        | —                      | —                  | —                    |
| opus_peach_juice.0              | not read (see below)                      | every point agrees     | —                  | —                    |
| perkinelmer\_\*.sp (2 files)    | —                                         | —                      | —                  | every point agrees   |
| galactic_Ft-ir.spc, s_evenx.spc | every point agrees (x to 1e-3, see below) | —                      | every point agrees | not read (see below) |
| galactic_nir.spc (20 subfiles)  | subfile 1 agrees; 2–20 misread (below)    | —                      | every point agrees | not read (see below) |

Ten readings by four other programs agree with this site point by point
(tests/spectrum-files-independent.test.ts, y to 1e-6 relative).

- SpectroChemPy prints x to 3 decimals from a float32 axis, so its x is compared to 1e-3 cm⁻¹;
  its y agrees to 1e-6.
- SpectroChemPy scales every subfile of galactic_nir.spc by the main header's exponent (4), also
  subfiles 2 to 20, whose own exponent is −128 (float32 values). The test checks that its values
  are exactly the same bytes read as int32 · 2^(4 − 32), so the difference is explained to the
  bit. spc-io and rohanisaac/spc read those subfiles as float32, as this site does, and agree.
- SpectroChemPy returns no dataset for the OPUS file, even when asked for the AB block by name
  (it logs a warning and returns nothing). brukeropusreader reads it and agrees.
- specio reads Galactic files through a module named `spc` that it does not install, so it reads
  only the PerkinElmer files here. spc-io covers the Galactic files instead.
- specio 0.1.0 needs Python 3.9 (collections.Iterable), which the runner image no longer offers
  through setup-python; the workflow makes its venv with uv.

### Open

- Unit codes not held in any real file are not mapped: PerkinElmer x labels other than "cm-1"
  (a UV WinLab file in nm), OPUS result types other than AB and RFL (for example TR), Galactic y
  codes other than absorbance and transmittance (galactic_nir.spc's code 3, which SpectroChemPy
  calls Kubelka–Munk, is left for the user to choose), OMNIC codes other than wavenumber and
  absorbance. The tool asks the user for the kind instead.
- Not read: old-layout and big-endian Galactic files, XYXY Galactic files, OPUS files in another
  number format, PerkinElmer images and maps, Shimadzu .spc (a compound document). Each is refused
  with an export hint.

### Closed by the owner

- Files from the owner's own instruments: closed by the owner on 2026-11-15 ("I don't have
  currently any raw files to test or validate with so close those section"). The readers are
  validated on the public real files above; a user's file that differs is refused or asks for the
  kind rather than being guessed.

## 20: open items of 17a to 17i (owner request, November 2026)

The owner asked for the items left open by stages 17a to 17i to be solved. What could be checked
in the session container was checked; what was built is listed with its checks. Scripts:
scripts/validation/tables/make_tables.py, scripts/validation/gsas2/dispersion.py. Tests:
tests/validation-tables.test.ts, tests/rietveld-su-factor.test.ts, tests/rietveld-dispersion.test.ts,
tests/sequential.test.ts. Fixture: tests/fixtures/validation/tables.json.

| Method                          | Check                                                                                                                                                                                              | Source                                        | Tolerance      | Result |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------- | ------ |
| Covalent radii table            | all 96 elements equal the Cordero radii in the periodictable package 2.1.0; against mendeleev 1.3.0 only C, Mn, Fe and Co differ, the four elements for which Cordero lists several values         | two independent copies of the published table | exact          | pass   |
| X-ray wavelengths               | Kα1 and Kα2 of every anode against the line energies of xraylib 4.3.0 (λ = 12.398419843 keV Å / E); largest difference 6.2e-5 Å (Co Kα2)                                                           | independent tabulation (xraylib)              | 1e-4 Å         | pass   |
| Bond-valence parameter file     | data/reference/source/bvparm2020.cif has the recorded SHA-1; the same text (apart from line endings) is distributed with VESTA and with pparBVM, compared in the session                           | two other distributed copies                  | identical text | pass   |
| Capillary absorption formula    | the Lobanov & Alte da Veiga expression against the absorption integral over the circular cross-section of a cylinder (direct numerical integration, converged to 1e-3), μR 0.1 to 8, 2θ 10 to 150° | physical definition, independent of GSAS-II   | 1.1 %          | pass   |
| Capillary refinement in GSAS-II | with the sample broadening held at zero through every step, GSAS-II's refinement of its own capillary simulation ends at R_wp 2.854 % (R_exp 2.887 %; this site 2.86 %)                            | GSAS-II                                       | as in 17d      | pass   |
| Bérar–Lelann factor applied     | with the switch on, every s.u. is the least-squares one times the factor and the covariance used for bond s.u. is times the factor squared; the refined values are unchanged                       | synthetic, known answer                       | 1e-14          | pass   |
| Counting-noise ratio            | 1 for Poisson counts: 0.8 to 1.25 on GSAS-II's simulated patterns, 0.94, 1.00 and 0.75 on three measured count patterns of tests/fixtures-real/                                                    | independent program's noise; real data        | 0.7 to 1.25    | pass   |
| Counting-noise ratio, scaled    | counts multiplied by k give k times the ratio; smoothed counts give less than 0.2; fewer than 100 points give no value; the refinement warns for counts × 5 and not for counts                     | synthetic, known answer                       | 0.05           | pass   |
| Series: atoms copied forward    | with a stand-in refinement that moves z by 0.001 and B by 0.1 Å² from wherever the atom starts, three patterns start at z = 0.380, 0.381, 0.382 with copy-forward and at 0.380 each without        | synthetic, known answer                       | 1e-12          | pass   |

What was found:

- GSAS-II's capillary fit ended above the noise (R_wp 3.06 % against R_exp 2.88 %) because of the
  validation script, not the model. GSAS-II limits the crystallite size to 10 µm whenever it stores
  results (GSASIIstrIO: `min(10., max(0.001, size))`), so the "no size broadening" value of 1e5 µm
  set by the script became 10 µm after the first step and added about 0.0009° of Lorentzian width.
  dispersion.py now sets the size again before each step. bonds.py, load_export.py, structure.py
  and substitution.py set the same value before multi-step refinements and were left unchanged:
  their comparisons pass at their stated tolerances with this small width included.
- The Bérar–Lelann eq 12: the factor is z = f₂/(f₁ + f₂) with the χ² densities
  f₁ = e^(−x/2)/√(2πx) (one degree of freedom) and f₂ = e^(−x/2)/2 (two), which gives
  z = √(2πx)/(2 + √(2πx)). So 2π follows from the derivation, as in the Fortran, in Andreev's
  eq 3 and in the independent rietx program; the "2" printed in eq 12 is a misprint.
- Rescaled intensities: the Bérar–Lelann factor, R_exp, χ² and the s.u. assume counts. The site
  now estimates the variance-to-intensity ratio from the fourth differences of the pattern
  (`countingNoiseRatio`, median of d²/(70 ȳ), which a smooth curve does not contribute to) and
  warns in plain language when it is above 2 or below 0.5.
- The "recognised, cannot read" note on .brml, .rasx and .raw was out of date: readers exist since
  16a for .brml, .rasx and .raw version 4, written against the real files in tests/fixtures-real/.
  What stays unread is listed in section 19.
- The ZnO example's bond-valence sum: the published structure (COD 1577381) gives 1.904 for Zn, and
  the end-to-end run shows 1.906(3) after refinement. A sum of 1.69 was not reproduced.
- The tracker in docs/EXECUTION-PLAN.md had rows "17" and "18" beside 17a to 17i; they are now 18
  and 19, and this work is row 20.

Decisions kept (the owner can change them):

- Kα2 stays at its exact Bragg angle (GSAS-II uses a first-order step; 17d).
- The Bérar–Lelann factor is off by default, so tables stay comparable with GSAS-II; the switch
  "Apply the Bérar–Lelann factor to the ±" is under Advanced, and the methods text says which was used.
- Texture stays cylindrical sample symmetry only (17f).

Open:

- No measured patterns with known answers are held for a capillary run, a textured sample, a
  heating series or a refinement with a published bond table (the line standards are in
  section 21).
- The differences found in other programs are reported, not resolved: GSAS-II's transposed matrix
  in its angles, its bond s.u. without the cell covariance, its larger s.u. of the hexagonal a, its
  Zr–O R₀, and pymatgen's different bond-valence model.
- The counting-noise ratio cannot tell a pattern multiplied by a factor between 0.5 and 2 from
  counts, and it is not a test of a variable-counting-time scan.

The IUCr copy of bvparm2020.cif, the owner's approval of the two bond-valence rules and the
capillary formula above μR 8 are settled in section 21.

## 21: the owner's files and decisions (November 2026)

The owner supplied the IUCr copy of bvparm2020.cif, two NIST data releases (SRM 660c LaB₆ and SRM
640f Si, powder CIFs), and, for the capillary formula, the GSAS Technical Manual pages and the
Lobanov abstract. The owner also approved two rules of the site (below). A second PDF supplied
with them (Willett et al., Am. J. Epidemiol. 1985, a food questionnaire) is unrelated and was not
used. Tests: tests/validation-tables.test.ts, tests/rietveld-dispersion.test.ts,
tests/validation-gsas2-dispersion.test.ts, tests/validation-nist-srm.test.ts,
tests/xrd-pdcif.test.ts.

| Method                       | Check                                                                                                                                                                                                                 | Source                                   | Tolerance      | Result |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------- | ------ |
| Bond-valence parameter file  | replaced by the IUCr copy (SHA-1 141eb3c7…); it differs from the earlier copy (VESTA, pparBVM, matminer) only in the authors of reference bt ("Suescun & Rabuffetti") and an unchecked Mn²⁺–I row the site leaves out | the IUCr page, via the owner             | recorded SHA-1 | pass   |
| Capillary formula, manual    | every coefficient of Absorb('Cylinder') against the GSAS Technical Manual (2004) pp. 134–135: identical above μR 3; below μR 3 the manual's k1 (0.024514, 26.0456) differs from GSAS-II's (0.024551, 26.04556)        | published formula                        | 1e-12; 0.8 %   | pass   |
| Capillary formula, integral  | against the absorption integral of a cylinder (numerical, converged), μR 0.1 to 10, 2θ 10 to 170°: largest error 1.30 %; above μR 10 the fit fails (5 % at μR 12, 16 % at 15)                                         | physical definition                      | 1.4 %          | pass   |
| μR limit                     | the refinement keeps μR at or below 10, the manual's range of validity, and says so in a warning                                                                                                                      | GSAS Technical Manual p. 135             | exact          | pass   |
| Powder CIF reader            | 2θ from a column or a range, the s.u. in parentheses, σ = 1/√w from _pd_proc_ls_weight, a calculated block skipped, a structure CIF sent to step 3                                                                    | synthetic, known answer                  | 1e-12          | pass   |
| Weights from the file        | with σ given, points are weighted by 1/σ², the counting-statistics warnings are not shown, and the methods text says so; on the 640f pattern χ² = 1.30 with NIST's weights                                            | real data (NIST)                         | GOF < 1.2      | pass   |
| Lattice parameter, Si 640f   | the site's refinement (TCH, Bérar–Baldinozzi asymmetry, displacement, zero fixed because NIST's 2θ is corrected, Kα1 from Ge 111) of NIST's pattern: a = 5.431150(6) Å against NIST's 5.431144 Å, +1.0 ppm            | real data, NIST's refinement (Topas FPA) | 5 ppm          | pass   |
| Lattice parameter, LaB₆ 660c | the same on NIST's Kα1 + Kα2 pattern (graphite analyser, 6.8° Soller slits): a = 4.156476(5) Å against 4.156783 Å, −74 ppm; −63 ppm with the zero refined and −74 to +101 ppm with the other asymmetry models         | real data, NIST's refinement             | 100 ppm        | pass   |

What was found:

- The capillary fit has no full paper; the GSAS Technical Manual is the published source, and it
  states the range μR ≤ 10. The site limits μR to 10 in the refinement and in the input box.
- With wide Soller slits (660c) the lattice parameter depends on the asymmetry model by up to
  about 1e-4 relative, far more than its s.u. (1 ppm). The site's simple asymmetry models are the
  limit there; NIST's fundamental-parameters profile is not available on the site. With narrow
  slits (640f) the site matches NIST within its s.u.
- Refining both zero and displacement on these patterns correlates them at r = −0.99 to −1.00 and
  moves a by 129 ppm (Si) and 11 ppm (LaB₆): for corrected 2θ data the zero should be fixed.

Decisions kept (the owner can change them):

- The owner approved (November 2026) the two rules of the bond-valence table: the suggested
  oxidation state (anion by the table, cation state nearest its own sum, labelled as a suggestion)
  and the note on a sum more than 10 % from the oxidation state (a display choice of the site).
- The decisions of section 20 stay as they were: Kα2 at its exact Bragg angle, the Bérar–Lelann
  factor off by default, cylindrical texture symmetry.

Open:

- Bruker .raw versions 1 to 3 and multi-scan .rasx and .brml files: no openly licensed real file
  was found. The files listed by xylib (SDPD course, IUCr CPD round robin) could not be fetched
  (the host is gone, the IUCr site needs a browser) and carry no stated licence. They stay
  "recognised, cannot read". Closed by the owner on 2026-11-15: no raw files are
  available to test with.
- The differences found in GSAS-II are drafted as reports in docs/gsas2-issue-drafts.md, for the
  owner to send; they are not resolved.
- The counting-noise limits (0.5 and 2) stay a rule of the site, as the owner left them.

## 22: UV-Vis open items (2026-11-15)

Four parts were set by the owner. Part A (original papers of Cody, Moss, Ravindra and Hervé–Vandamme)
and part D1 (optical conductivity) need sources that were not supplied, so they were skipped and
their Open entries in 19e stay.

### Part B: suggested Tauc region anchored on the steepest part of the edge

Code: src/core/uvvis/tauc.ts (`suggestRegion`, `steepestRise`, `slopesOverSpan`). Tests:
tests/uvvis-tauc-region.test.ts, tests/validation-uvvis-real.test.ts.

The rule, all own choice (no paper stating it was opened in the session):

- The slope of the Tauc curve at each point is the straight-line slope over ±0.05 eV (at least
  four points each side). Its lower bound is slope − 3σ.
- The main rise starts at the first point whose bound reaches half the highest bound, and ends
  where the bound falls below half the best bound so far. The steepest point is the highest bound
  on it, the lower energy on a tie.
- Only fit windows that contain the steepest point and have at least half its slope compete. Among
  them the earlier choice is kept: widest with R² ≥ 0.995, then straightest.
- A window is rejected when its line meets y = 0 at or below zero energy, inside or above the
  window, or above the steepest point.
- When the slope is still rising within 0.1 eV of the end of the data, the curve has no steepest
  part to anchor on, and the earlier rule is used. Without this, a background that curves up
  (scattering, part C) under a straight-line correction pulled the anchor to the top of the data:
  3.69 eV for a 3.20 eV edge with 0.2·(E/3.2)² added, against 3.21 eV with the earlier rule. The
  real files and the noisy copies below never reach this fallback.
- The 2026-11-14 guard for saturated diffuse reflectance is kept only for the earlier rule. Saved
  sessions keep their region and their rule (session version 6 marks them "widest"). The new rule
  needs no guard.

| Check                                                             | Kind                    | Tolerance         | Result                                      |
| ----------------------------------------------------------------- | ----------------------- | ----------------- | ------------------------------------------- |
| Local slope of a straight line; of x² on a 0.007 eV grid          | synthetic, known answer | 10⁻⁹              | pass                                        |
| Piecewise curve (slope 10 from 3.2 to 3.4 eV, then 2/3), old rule | regression              | recorded          | 0.40 eV                                     |
| The same, new rule                                                | synthetic, known answer | 3.20 ± 0.02 eV    | 3.200 eV, pass                              |
| 300 °C TiO₂ file, indirect, baseline subtracted (case 1)          | real data, hand region  | 2.87 ± 0.05 eV    | 2.901 eV (was 2.691), region > 2.9 eV, pass |
| 200 noisy copies of the 19a edge (direct), level 0: scatter of Eg | Monte Carlo             | not above before  | 0.00162 eV (before 0.00173), pass           |
| The same, level 0.2                                               | Monte Carlo             | not above before  | 0.00169 eV (before 0.00179), pass           |
| Mean Eg of those copies                                           | synthetic, known answer | 3.200 ± 0.002 eV  | pass                                        |
| Signal × 123, synthetic and both real files                       | invariance              | same region, 10⁻⁹ | pass                                        |
| Earlier rule on the real files reproduces the earlier gaps        | regression              | 10⁻¹²             | pass                                        |
| Flat curve                                                        | guard                   | no suggestion     | pass                                        |

Not a pass criterion, recorded for the owner: on an indirect plot of the same edge (not the 19a
check) the scatter rose, 0.0053 to 0.0072 eV at level 0 and 0.0067 to 0.0083 eV at level 0.2.

Values that changed (old rule → new rule). Every one stays inside its recorded tolerance:

| Result                                                           | Old                | New               | Tolerance                                                    |
| ---------------------------------------------------------------- | ------------------ | ----------------- | ------------------------------------------------------------ |
| 200 °C TiO₂, direct, automatic                                   | 3.2211 (axis)      | 3.2423 (subtract) | 3.231 ± 0.04 eV                                              |
| 300 °C TiO₂, direct, automatic                                   | 3.2485 (subtract)  | 3.2253 (axis)     | 3.217 ± 0.04 eV                                              |
| 200 °C TiO₂, indirect, automatic                                 | 2.8853             | 2.8941            | 2.884 ± 0.02 eV                                              |
| 300 °C TiO₂, indirect, subtract                                  | 2.6907             | 2.9008            | 2.87 ± 0.05 eV                                               |
| 19a dye case, subtract-baseline (Tauc of the dye edge)           | 2.42266            | 2.42325           | error > 0.5 eV (recorded)                                    |
| 19a dye case, crossing                                           | 2.39583            | 2.39661           | error > 0.5 eV (recorded)                                    |
| Noisy zero level, indirect, automatic                            | 3.19656            | 3.20551           | not recorded (the identity check runs with the earlier rule) |
| Kubelka–Munk + 0.01, direct, automatic (axis)                    | 3.19727            | 3.19805           | method by the 0.01 eV rule                                   |
| Kubelka–Munk + 0.05, direct, axis intercept                      | 3.18649            | 3.19030           | method by the 0.01 eV rule                                   |
| Kubelka–Munk + 0.05, direct, automatic                           | 3.20000 (subtract) | 3.19030 (axis)    | method by the 0.01 eV rule                                   |
| 19a dye case, indirect, subtract-baseline (Tauc of the dye edge) | 1.63601            | 1.83597           | error > 0.5 eV (recorded)                                    |
| 19a dye case, indirect, crossing; axis                           | 1.70651; 1.59896   | 1.92899; 1.80155  | error > 0.5 eV (recorded)                                    |

The subtraction rows of 19a (3.200 ± 0.002 eV) are unchanged. On the Kubelka–Munk spectrum with
0.05 added, subtraction still gives 3.200 eV, but the axis intercept now lies 0.0097 eV from it, under
the 0.01 eV at which the automatic choice switches to subtraction, so the automatic result is the
axis intercept, 0.010 eV low. The zero-level identity check of 19a is run with the earlier rule.

### Part C: power-law (scattering) baseline

Code: src/core/uvvis/tauc.ts (`fitPowerBaseline`, `powerSubtractedGap`, `suggestPower`, options
`baselineShape` and `baselineExponent`). Tests: tests/uvvis-tauc-baseline.test.ts,
tests/validation-uvvis.test.ts. Independent: scripts/validation/spectra/uvvis.py, block
`scattering` (SciPy `curve_fit`, bounded, tolerances 10⁻¹⁵).

Source opened in the session: Kubetschek, Backes and Goldie, "Algorithm for reproducible analysis
of semiconducting 2D nanomaterials based on UV/VIS spectroscopy", Adv. Mater. Interfaces (2024)
2400311 (arXiv:2402.08517), eq 8, p. 8: the scattering part of the extinction goes as λ⁻ᵐ, with
m = 4 for Rayleigh scattering and m = 2 in the van de Hulst approximation of Mie scattering. They
state it holds only in the non-resonant region away from the transitions, and that the
extrapolation can fail. Own choice: the constant a, the bounds 0 ≤ m ≤ 4, fitting to all the data
below the edge (the owner's instruction), the 0.05 eV σ limit of the warning and the factor 0.5 of
the suggestion.

The model: S_b = a + c·Eᵐ (λ⁻ᵐ ∝ Eᵐ), least squares over the sub-gap window, which for this shape is
everything measured below the edge (ending 0.1 eV below the gap). m is fitted (grid of 0.1, golden
section, then Gauss–Newton) or typed. σ(Eg) adds J·C·Jᵀ to the σ of the edge fit, with C the
covariance s²(JᵀJ)⁻¹ of (a, c, m) and J by central differences, as for the straight line.

Today's errors with the straight line (edge at 3.200 eV, c = 0.2/3.2ᵐ, noise σ 0.003 seeded):

| Background | Straight line, no noise | Straight line, noise | Power law, no noise | Power law, noise         | Tolerance               |
| ---------- | ----------------------- | -------------------- | ------------------- | ------------------------ | ----------------------- |
| c·E¹       | 3.2000 ± 0              | 3.1973 ± 0.0025      | 3.2000, m 1.000     | 3.1980 ± 0.0025, m 0.912 | 0.02 eV; within σ; pass |
| c·E²       | 3.2095 ± 0.0013         | 3.2078 ± 0.0025      | 3.2000, m 2.000     | 3.1985 ± 0.0025, m 1.929 | 0.02 eV; within σ; pass |
| c·E⁴       | 3.2651 ± 0.0036         | 3.2360 ± 0.0053      | 3.2000, m 4.000     | 3.2003 ± 0.0028, m 3.937 | 0.02 eV; within σ; pass |

| Check                                                                    | Kind                      | Tolerance                      | Result                        |
| ------------------------------------------------------------------------ | ------------------------- | ------------------------------ | ----------------------------- |
| The six cases above                                                      | synthetic, known answer   | 0.02 eV without noise; σ with  | pass                          |
| a, c, m without noise                                                    | synthetic, known answer   | m 10⁻⁴; a, c 10⁻⁶              | pass                          |
| m typed as 4 on the c·E⁴ case                                            | synthetic, known answer   | 0.02 eV                        | pass                          |
| σ(Eg): 400 data sets, noise only below 3.15 eV, c·E² background          | Monte Carlo (independent) | mean σ / scatter = 1 ± 15 %    | 6.70·10⁻⁴ / 6.35·10⁻⁴ = 1.055 |
| a, c, m, covariance and Eg against SciPy curve_fit (free m; m = 4 fixed) | independent (SciPy)       | 10⁻⁶ relative; covariance 10⁻⁵ | pass (run 42, 2026-11-15)     |
| Signal × 123; points in reverse order                                    | invariance                | same Eg and m, 10⁻⁹            | pass                          |
| "Straight line" chosen explicitly against the default                    | regression                | identical, every 19a number    | pass                          |
| Suggestion: offered (not applied) for c·E² and c·E⁴; none for a level    | guard                     | as stated                      | pass                          |
| Warning: m on a bound; user window shorter than 0.5 eV                   | guard                     | shown                          | pass                          |

The suggestion is offered when the power law's RMS residual below the edge is at most half that of
the straight line over the same points and its corrected curve passes `flatBelowGap`; it is shown as
a message with a button and never switches on its own. The warning beside the result appears when
σ(Eg) > 0.05 eV, m sits on a bound or the window is shorter than 0.5 eV.

Performance, measured on 50,001 points: the power fit takes about 0.1 s (m fitted) or 0.014 s (m
typed). The whole analysis of such a file took 45 to 155 s on the main thread, almost all of it in
the region search of earlier stages (`windows`); this was fixed on 2026-11-15 (below).

#### Speed of the region search, and the band gap worker (2026-11-15)

Code: src/core/math/windowSums.ts (`WindowSums`, `linearFitMargin`), src/core/uvvis/tauc.ts
(`windows`, `Candidate`, `decide`), src/modules/uvvis/bandGap.ts, src/modules/uvvis/bandGapClient.ts,
src/workers/bandgap.worker.ts. Tests: tests/uvvis-tauc-speed.test.ts,
tests/uvvis-bandgap-worker.test.tsx.

The search fits a straight line to every window of 0.1 to 0.6 eV, about 300,000 windows of up to
7,000 points on a 50,000-point spectrum, and `linearFit` made that O(points × window). Each line now
comes in constant time from prefix sums of x, y, x², xy and y² kept in double-double (exact
products by Dekker's TwoProduct, sums by Knuth's TwoSum; Hida, Li and Bailey 2001 for the
double-double add and multiply). Those numbers are more accurate than `linearFit` but not
bit-identical to it, and on a noise-free Tauc line many windows tie at R² ≈ 1 to the last digit,
so `linearFit`'s rounding decides the winner. Every comparison of the search (slope > 0, R²
thresholds, the gap tests, the half-slope anchor test, the choice of the highest R² and of the
steepest window) that is closer than `linearFitMargin` of the scale of the values is therefore
decided again with `linearFit` on the windows involved. The margin is 64·n·ε·(|x̄|/σx + |ȳ|/σy),
at least 10⁻⁸ (own choice): `linearFit`'s sequential sums are off by about n·ε, magnified by how far
the means lie from the spread. The suggested regions, and so every band gap, are bit-identical to
the earlier code.

The analysis then still takes about 5 s on 50,001 points (four transitions are compared), so the
whole band gap analysis (`analyseBandGap`) runs in a web worker. The Band gap step, the Results
step, its Tauc figure and the analysis record send their jobs to it; results are kept by the
content of the inputs (a hash of the curves and the settings), one job runs at a time, and a job
nobody waits for any more is dropped before it starts. While new settings are analysed, the last
result of the same spectrum stays on screen with "Updating…". Where workers do not exist (the
jsdom unit tests) the analysis runs on the main thread as before.

| Check                                                                                                | Kind                      | Tolerance                    | Result                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------- | ------------------------------------------ |
| Points on y = 2 + 3x: slope, intercept, R² of a window                                               | synthetic, known answer   | exact                        | 3, 2, 1: pass                              |
| 50,001-point edge at 3.2 eV, level 0.05, noise σ 0.003: Eg with the level subtracted                 | synthetic, known answer   | 0.01 eV                      | pass                                       |
| Window sums against exact rational arithmetic (BigInt), x ≈ 10⁴ with spreads down to 3·10⁻⁴          | independent (exact)       | 10⁻¹⁴ relative               | pass                                       |
| `linearFit` against the same exact values (R² off by up to 2.8·10⁻⁷ there; Python `Fraction` agrees) | independent (exact)       | inside `linearFitMargin`     | pass                                       |
| Regions against the earlier search (kept in the test): 20 curves × 2 powers × 2 rules                | independent (old code)    | bit-identical                | 80 of 80                                   |
| Same, run in the session on 200 curves × 4 transitions × 2 rules (200 to 3,000 points)               | independent (old code)    | bit-identical                | 1,600 of 1,600                             |
| Noise-free straight Tauc line (ties at R² ≈ 1)                                                       | regression (tie-breaking) | bit-identical                | pass                                       |
| 50,001 points, analysis before and after the change                                                  | regression                | identical Eg, all digits     | 3.1974344175383336 both: pass              |
| Analysis in the worker against the main thread                                                       | invariance                | equal fit, Tauc curve, table | pass                                       |
| Window sums asked for in another order                                                               | invariance                | equal                        | pass                                       |
| A job replaced before it starts is never run; results stay while new ones run                        | guard                     | as stated                    | pass                                       |
| Chromium, 50,001-point CSV uploaded, Band gap step: longest main-thread task while it runs           | browser (Playwright)      | no task over 100 ms          | one of 67 ms; 3.197 ± 0.004 eV after 6.7 s |

Timings on the development container (Node 22), synthetic absorbance with a 3.2 eV
direct edge, level 0.05 and noise σ 0.003, before → after:

| Points | `suggestRegion`, steepest rule | `analyseTaucGap` | Whole analysis (`analyseBandGap`) |
| ------ | ------------------------------ | ---------------- | --------------------------------- |
| 1,201  | –                              | –                | 0.16 s → 0.06 s                   |
| 5,001  | –                              | –                | 1.66 s → 0.34 s                   |
| 50,001 | 10.3 s → 0.60 s                | 18.1 s → 0.94 s  | 155 s → 4.9 s, now in the worker  |

What remains of the 4.9 s is mostly the smoothed derivative of the region anchor (`slopesOverSpan`,
part B, about a third) and garbage collection; it runs in the worker, so the page stays responsive.

Open:

- No real spectrum of a scattering sample with a known gap was available to test the power law on.

### Part D: optical conductivity; polydispersity index

| Item                    | Check                                                                | Source                    | Result                            |
| ----------------------- | -------------------------------------------------------------------- | ------------------------- | --------------------------------- |
| D1 optical conductivity | not built: the textbook page with the SI definition was not supplied | none                      | skipped; the 19e Open entry stays |
| D2 polydispersity index | not built; one help sentence beside the CV                           | owner decision, Nov. 2026 | 19f Open entry closed             |

### Part A: original papers

Not done: the papers of Cody et al. 1981, Moss 1950, Ravindra and Srivastava 1979 and Hervé and
Vandamme 1994 were not supplied. The code, the on-screen text and the methods text are unchanged
(Hervé–Vandamme B stays 3.47 eV, as printed by Tripathy 2015), and the 19e Open entries stay.
