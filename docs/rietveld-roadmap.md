# Rietveld refinement: where it stands and how far it can go

Written November 2026 (stage 17a) at the owner's request: "find out how to make the best of the
Rietveld refinement … push it as far as it can … the most competitive refinement tool possible
within the current Spark plan".

## What the free plan does and does not limit

Firebase Spark only serves files; every refinement already runs in the user's browser, in a Web
Worker. So hosting is **not** the limit. What limits a browser refinement is:

1. **Speed.** Derivatives are finite differences of the whole calculated pattern, one parameter at
   a time. That is fine for a basic refinement (tens of parameters, a few seconds) but slow for a
   low-symmetry structure refinement with many atoms. Analytic derivatives (as GSAS-II has) are the
   cure; they are pure code, no server.
2. **Validation effort.** CLAUDE.md asks for every method to be checked three ways. GSAS-II runs on
   GitHub in `.github/workflows/validation.yml`, so each new model can be checked against GSAS-II's
   own code on the same data, at no cost.
3. **Data tables** that must come from a verified source (anomalous dispersion f′, f″; bond-valence
   parameters). They can be bundled as JSON once a source is verified.

Nothing in the list below needs a backend.

## What the refinement can do now

| Area                    | Available                                                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geometry and optics     | Bragg–Brentano, Kα1/Kα2 or Kα1 only, zero shift, sample displacement, **transparency** (17a), **monochromator polarisation** (graphite, germanium or a typed P; GSAS-II's Polariz.) (17a), **automatic divergence slit** (17a)            |
| Peak shape              | Pseudo-Voigt with Caglioti widths, or Thompson–Cox–Hastings (GSAS-II's U, V, W, X, Y); Bérar–Baldinozzi asymmetry; **fixed instrument profile** typed, read from a GSAS-II .instprm file or taken from the refinement of a standard (17a) |
| Sample broadening       | **Isotropic crystallite size and microstrain per phase, GSAS-II definitions, with optional Lorentzian fractions** (17a)                                                                                                                   |
| Intensities             | Structure factors from the CIF; March–Dollase preferred orientation; overall B; **Suortti surface roughness** (17a); **dopant on a shared site** (17b)                                                                                    |
| Structure               | Free coordinates (site-symmetry constrained), occupancies of partly filled sites, isotropic B, anisotropic U_ij (site-symmetry constrained, positive-definite check), bond restraints                                                     |
| Whole-pattern fitting   | **Le Bail mode per phase** (17a): cell and profile without a structure; **Le Bail of a cell from indexing** (17b)                                                                                                                         |
| Quantification          | Hill–Howard weight fractions with uncertainties; **amorphous content from an internal standard** and absolute weight fractions (17a)                                                                                                      |
| Statistics and checking | R_p, R_wp, R_exp, χ², R_Bragg, staged release of parameters, parameters at bounds; **Durbin–Watson d**, **list of strongly correlated parameters**, **excluded 2θ ranges**, **reflection list with I_obs and I_calc** (17a)               |
| Output                  | Results, atoms, pattern and **reflection** CSVs; methods paragraph naming every setting; GSAS-II starting set (.xye, .instprm with the polarisation, CIF per phase)                                                                       |

## What is still missing, ranked by value for the site's users

Ranked by how often an early-career materials researcher needs it, then by effort.

| Rank | Addition                                                                                                                                          | Why it matters                                                                                                                                                        | Effort | Independent check                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------- |
| 1    | Done in 17b: **Substitution on a shared site** (doping): put a second element on a site, refine its fraction with the total fixed, shared x and B | Most users refine doped oxides (Zn₁₋ₓMₓO, Ce₁₋ₓMₓO₂, ferrites). Today only partly filled sites in the CIF can be refined, and a dopant cannot be added.               | Medium | GSAS-II constraint on the same data in CI |
| 2    | Done in 17c: **Anisotropic microstrain** (Stephens, J. Appl. Cryst. 32 (1999) 281) and **uniaxial size** (GSAS-II)                                | hkl-dependent broadening is the most common reason for a high GOF in nanomaterials and layered compounds.                                                             | Medium | GSAS-II "generalized" mustrain in CI      |
| 3    | Done in 17b: **Le Bail of an indexed cell** (reflections generated from the cell and its centring, no reference)                                  | Closes the loop with "Index an unknown pattern" in step 3: confirm a suggested cell by a whole-pattern fit.                                                           | Small  | GSAS-II Le Bail in CI                     |
| 4    | Done in 17c: **Finger–Cox–Jephcoat axial divergence** (GSAS-II's SH/L)                                                                            | The physical asymmetry model; makes the profile identical to GSAS-II's, so .instprm files transfer exactly.                                                           | Medium | GSAS-II simulation in CI                  |
| 5    | **Anomalous dispersion f′, f″**                                                                                                                   | With Cu radiation, Fe, Co, Mn, Ni compounds have f′ of several electrons; ignoring it biases occupancies and B. Needs a verified table (to be agreed with the owner). | Small  | GSAS-II with its own f′ on (CI)           |
| 6    | **Analytic derivatives**                                                                                                                          | Structure refinements of low-symmetry phases become 10–50× faster; large scans (50,000 points) stay interactive.                                                      | Large  | Finite differences (invariance)           |
| 7    | **Spherical-harmonic texture** (GSAS-II)                                                                                                          | Plate- and needle-like samples (layered hydroxides, clays, BiOCl, MoO₃) that one March–Dollase direction cannot describe.                                             | Medium | GSAS-II in CI                             |
| 8    | **Sequential refinement** of a series (temperature, composition, time)                                                                            | Lattice parameters against x or T (Vegard's law, thermal expansion) in one go, with a table and plot.                                                                 | Medium | Same result as one-by-one refinement      |
| 9    | **Capillary (Debye–Scherrer) geometry** with absorption μR                                                                                        | Transmission instruments and air-sensitive samples.                                                                                                                   | Small  | GSAS-II Absorb() in CI                    |
| 10   | **Bond lengths and angles of the refined structure with uncertainties**, bond-valence sums                                                        | Needed to report a structure refinement; the geometry code exists (16c), the error propagation and a verified bond-valence table do not.                              | Medium | pymatgen in CI                            |
| 11   | Bérar–Lelann correction of the standard uncertainties                                                                                             | More honest uncertainties when the Durbin–Watson d is low.                                                                                                            | Small  | Published worked example                  |

Out of scope, as CLAUDE.md section 9 says: magnetic structures, neutron or synchrotron-specific
models, solving unknown structures, joint refinement of several radiation types.

## Suggested order

17b (done): items 1 and 3 (the two that change what users can publish). 17c (done): items 2 and 4. 17d: items 5
and 9. 17e: item 6. Then 7, 8, 10, 11. Each sub-stage adds its GSAS-II case to
`scripts/validation/gsas2/` and its rows to docs/validation.md.
