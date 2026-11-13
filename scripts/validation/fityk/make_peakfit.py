"""Runs Fityk (cfityk) on the peak-fit test data and writes its results as JSON.

Run from the repository root (Fityk installed, for example `apt-get install fityk`):
    python3 -I scripts/validation/fityk/make_peakfit.py > tests/fixtures/validation/peakfit-fityk.json
Fityk's PseudoVoigt mixes unit-height shapes with `shape`, the same definition as this site's η.
"""

import json
import subprocess

run = subprocess.run(
    ["cfityk", "-q", "scripts/validation/fityk/peakfit.fit"],
    capture_output=True, text=True, check=True,
)
version = subprocess.run(["cfityk", "-V"], capture_output=True, text=True, check=True).stdout.strip()
peaks = {}
for line in run.stdout.splitlines():
    parts = line.split()
    if parts and parts[0] in ("doublet-a", "doublet-b", "pearson", "real"):
        center, fwhm, shape, height, area = map(float, parts[1:6])
        peaks[parts[0]] = {
            "center": center, "fwhm": fwhm, "shape": shape, "height": height, "area": area,
        }
assert len(peaks) == 4, run.stdout
print(json.dumps({"source": version, "peaks": peaks}, indent=2))
