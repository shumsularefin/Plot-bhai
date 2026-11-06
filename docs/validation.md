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
| Asymmetry keeps the area   | three (P1, P2) pairs: summed profile unchanged, centroid moves (down for a < 0)                                                                                                  | invariance (odd correction × even profile)                                                                      | 1e-9 relative                  | pass   |
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
