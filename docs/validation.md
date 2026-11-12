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

- No fit of the same data by another program (Fityk or FullProf) has been compared: installing
  Fityk was not allowed in this environment. The formulas are checked against the documented
  forms and numerical integration instead. A comparison on a real pattern would close this.
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
- No comparison with pymatgen or VESTA (not installable here); the CIF tables stand in for it.

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

- No comparison with another indexing program (DICVOL, TREOR, McMaille) on the same lines; they
  could not be installed here. A real pattern indexed by one of them would close this.
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

- No comparison with GSAS-II refining the same pattern (structure and profile), and the files
  have not been loaded into GSAS-II itself: it cannot be installed here. Loading the exported
  .xye, .instprm and CIF into GSAS-II and refining would close both.
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
- No comparison with DICVOL, TREOR or McMaille for monoclinic and triclinic cells.
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

Open:

- Surface roughness B from the GSAS-II pattern is 1.0 % low (4 s.u.; GSAS-II's own refinement is
  0.3 % low). The likely cause is the scattering factors (International Tables 4-Gaussian here,
  GSAS-II's own table there), which change the intensity against angle as B does; not confirmed.
- The Le Bail cells here and in GSAS-II differ by 6e-5 Å (6 s.u.); both leave the transparency
  out, so both absorb its shift. GSAS-II's tiny axial-divergence term (SH/L = 0.0001) is not
  modelled here and may explain it; not confirmed.
- Monochromator spacings (graphite 002 d = 3.354 Å, germanium 111 d = 5.6579/√3 Å) and the
  mosaic or perfect-crystal choice are flagged for the owner's verification.
- Hill and Flack's Durbin–Watson paper is cited as J. Appl. Cryst. 20 (1987) 356; one IUCr issue
  listing gives pages 362–365. To be checked against the journal page.
