# Rietveld engine check against GSAS-II

Independent check of `src/core/xrd/rietveld/` (not run in CI; its output is the fixture used by
`tests/rietveld-gsas.test.ts`).

1. Build GSAS-II from source (commit 2c62562 of github.com/AdvancedPhotonSource/GSAS-II was used;
   it needs gfortran) into a virtual environment: `pip install ./GSAS-II`.
2. `python -I sim.py <work dir> <repo dir>` simulates an anatase + rutile pattern (Cu Kα1/Kα2,
   20–90°, step 0.02°) from the COD CIFs 9015929 and 9007531 in `scripts/cif-cache/`, with the
   instrument file `cu.instprm`, the anatase cell changed by +0.3 % (a) and −0.2 % (c), a zero
   shift of 0.04°, phase fractions 1.0 and 0.6, and Poisson noise. It writes `run/mix.xy` and
   `run/truth.json` (copied to `tests/fixtures/rietveld/`).
3. `python -I ref.py <work dir> <repo dir>` refines the same data in GSAS-II from the reference
   cells.

Results (GSAS-II's weight fraction is phase fraction × cell mass, normalised; its intensities
carry a 1/V factor, so this is the Hill–Howard S·ZMV of this engine):

|                         | truth    | GSAS-II refinement | this engine |
| ----------------------- | -------- | ------------------ | ----------- |
| anatase a (Å)           | 3.795854 | 3.795836           | 3.795861    |
| anatase c (Å)           | 9.495271 | 9.495211           | 9.495229    |
| rutile a (Å)            | 4.594100 | 4.594137           | 4.594160    |
| rutile c (Å)            | 2.958900 | 2.958913           | 2.958904    |
| zero shift (°)          | 0.0400   | 0.0398             | 0.0401      |
| anatase weight fraction | 0.76923  | 0.76837(83)        | 0.7680(10)  |
| R_wp                    |          | 4.82 %             | 4.94 %      |

GSAS-II uses a Thompson–Cox–Hastings profile with asymmetry, so the peak-shape parameters are
not comparable and this engine's χ² is 1.08 rather than 1.
