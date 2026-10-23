# Parser fixtures

Synthetic files written by `make_fixtures.py` (run `python3 make_fixtures.py .` here), not measurements. Unless noted, each holds the same
made-up curve: 2θ = 20.00° to 25.00° in 0.02° steps (251 points) and
I = round(100 + 1000 · exp(−4 ln 2 · (2θ − 22.5)² / 0.1²)), so the maximum is 1100 at 22.50° and
both ends are 100. The XRDML and RAS files follow the element and keyword layout read by the
open-source readers in xrayutilities and GSAS-II; they are not copies of instrument files.
