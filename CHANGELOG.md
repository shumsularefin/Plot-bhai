# Changelog

Versions follow [semantic versioning](https://semver.org): a new minor number (1.1.0) adds features
and keeps every saved session readable; a new major number (2.0.0) would break something users
depend on. Each version is archived on Zenodo; the concept DOI
[10.5281/zenodo.24222105](https://doi.org/10.5281/zenodo.24222105) always points to the latest.
Details of every check are in [docs/validation.md](docs/validation.md).

## 1.1.0 (2026-11-15)

The UV-Vis, FTIR and Particles tools, audited, validated three ways and extended (stages 19a to
19g and 22). XRD, Rietveld and thermal analysis are unchanged from 1.0.0. Sessions saved with
1.0.0 open in 1.1.0; where a default changed, the saved setting is kept (see "Changed values").

### New features

**UV-Vis**

- Four ways to read Eg under "How Eg is read": axis intercept, sub-gap baseline subtracted first
  (the default when it moves Eg by more than 0.01 eV), crossing with a baseline line (Makuła,
  Pacia and Macyk 2018), and the spectrum of a second component subtracted first (their eq. 4).
- Power-law background a + c·Eᵐ for scattering films (Kubetschek et al. 2024), m fitted in [0, 4]
  or typed, with its uncertainty carried into σ(Eg).
- New "Absorption bands" step: band table in nm and eV, bands added and removed by hand,
  second-derivative shoulders, and band fitting (Gaussian, Lorentzian, pseudo-Voigt).
- Path length for films (nm) and solutions (cm), α in cm⁻¹, and α corrected with a measured
  reflectance spectrum (Zanatta, eq. 6).
- Several transitions per sample reported in Results; Cody plot and sigmoid fit as cross-checks.
- Optical constants: extinction coefficient k, refractive index estimates from Eg (Moss, Ravindra,
  Hervé–Vandamme) and optical conductivity σ = ε₀cnα from a typed refractive index.
- Combined figures of all spectra and of all Tauc plots, ready to export.

**FTIR**

- Peaks added and removed by hand, shoulders, and new table columns: height, FWHM, area,
  intensity class and an overlap flag.
- Comparison of bands across samples with shifts from a reference sample, and a wide CSV with one
  column per sample.
- Diffuse reflectance (DRIFTS) as a data type, converted to Kubelka–Munk F(R) or log₁₀(1/R).
- Optional straight line over the CO₂ band, and normalisation to a chosen band.
- A larger reference table of functional groups: 53 rows from three CC BY papers, then 17 group
  ranges from Socrates' book, borovanadate glass bands, carbonate and nitrate minerals, and
  calculated CeO₂ and LaAlO₃ modes. Every suggestion names its source.
- Spectral regions and assignment labels on the combined figure.

**Instrument files (FTIR and UV-Vis)**

- Read in the browser: Thermo OMNIC .spa, Bruker OPUS (.0, .1, …), PerkinElmer .sp and
  Galactic .spc. Each file goes to the right tool, with a plain message otherwise.

**Particle size**

- Session file that saves the whole analysis and re-attaches it to the same image (matched by
  SHA-256 in the browser).
- Further statistics: SEM, 95 % confidence interval, CV, D[1,0], D[3,2], D[4,3], Dv10, Dv50, Dv90,
  span, and the Anderson–Darling test of the normal and lognormal fits.
- Shape distributions: aspect ratio, circularity and solidity.
- Particle size and DSC results in the sample report; free height for histogram figures.

**Site**

- The About page lists what each tool does and the new UV-Vis equations.

### Changed values

Results that change when the same data are analysed again. Saved sessions keep their earlier
settings unless the user changes them.

| Where                                  | Before                                      | Now                                                             | Why                                                                                                    |
| -------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| UV-Vis, Hervé–Vandamme n               | B = 3.47 eV                                 | B = 3.4 eV; n rises 0.5–1.3 % (2.2179 → 2.2361 at 3.4 eV)       | The original paper (eq. 10) prints 3.4 eV                                                              |
| UV-Vis, suggested Tauc region          | Best straight window anywhere on the edge   | Window through the steepest part of the edge                    | The old rule picked the saturated rise of the 300 °C TiO₂ file: 2.691 → 2.901 eV (hand region 2.87 eV) |
| UV-Vis, Tauc region on saturating F(R) | Could pick 4.6–5.4 eV (3.72 eV direct)      | Lines meeting y = 0 above the edge are rejected                 | Found with the real TiO₂ reflectance files                                                             |
| UV-Vis, Eg with background absorption  | Axis intercept only                         | Baseline subtracted first when it moves Eg by more than 0.01 eV | A sub-gap level biased Eg; zero-level spectra are unchanged                                            |
| UV-Vis, c·E⁴ scattering background     | 3.265 eV                                    | 3.200 eV (the synthetic gap)                                    | Power-law background                                                                                   |
| UV-Vis, percent or fraction            | A fraction could be read as percent         | Percent only from a % sign                                      | Bug fix                                                                                                |
| FTIR and XRD, arPLS baseline           | Standard deviation with divisor n           | Divisor n − 1, as pybaselines                                   | Baselines move by up to 0.015 %                                                                        |
| FTIR, assignments after reprocessing   | Lost                                        | Re-attached to the nearest peak within 20 cm⁻¹                  | Bug fix                                                                                                |
| FTIR, reflectance files                | Read as transmittance                       | Recognised as reflectance                                       | Bug fix                                                                                                |
| Particles, perimeter and circularity   | Up to 2.9 % long perimeter, circularity low | ImageJ's traced perimeter                                       | Checked against ImageJ 1.54f                                                                           |
| Particles, Triangle threshold          | 82 on the test image                        | 83, as ImageJ                                                   | Checked against ImageJ 1.54f                                                                           |

### Validation

- New independent checks in CI: SciPy, lmfit, pybaselines, scikit-image, ImageJ 1.54f,
  SpectroChemPy, brukeropusreader, spc-io and specio.
- docs/validation.md grew from 20 to 30 sections and from 229 to 453 recorded check rows.

## 1.0.0 (2026-11-14)

First archived release (version DOI
[10.5281/zenodo.24222106](https://doi.org/10.5281/zenodo.24222106)): the five tools (XRD, UV-Vis,
FTIR, particle size, thermal analysis), the XRD full package and the Rietveld refinement checked
against GSAS-II (stages 0 to 21).
