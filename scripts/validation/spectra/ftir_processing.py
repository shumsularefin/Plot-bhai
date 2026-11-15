"""Independent references for the FTIR processing of sub-stage 19d, read by
tests/validation-ftir-processing.test.ts.

One synthetic diffuse reflectance spectrum (%R, 400 to 4000 cm-1, step 2 cm-1) with two bands
and a CO2-like doublet near 2349 cm-1, then, written here with numpy and scipy:

  kubelka_munk  F(R) = (1 - R)^2 / (2R), R = %R / 100
  log_inverse   log10(1/R)
  co2           F(R) with 2280 to 2400 cm-1 replaced by the straight line between the values
                interpolated (numpy.interp) at the two ends
  band          the CO2-corrected F(R) divided by the height, and by the area
                (scipy.integrate.trapezoid), of the band in 1560 to 1680 cm-1 above the straight
                line between the values interpolated at the two ends

Run:  python3 -I scripts/validation/spectra/ftir_processing.py tests/fixtures/validation
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import scipy
from scipy import integrate

out = Path(sys.argv[1])


def gauss(x, c, w, h):
    return h * np.exp(-4 * math.log(2) * (x - c) ** 2 / w**2)


x = np.arange(400.0, 4000.0 + 1e-9, 2.0)
percent_r = 100 * (
    0.82
    + 0.00002 * (x - 400)
    - gauss(x, 1620, 40, 0.35)
    - gauss(x, 1100, 80, 0.2)
    - gauss(x, 2337, 10, 0.08)
    - gauss(x, 2361, 10, 0.1)
)
r = percent_r / 100
km = (1 - r) ** 2 / (2 * r)
log_inverse = -np.log10(r)


def straighten(y, lo, hi):
    out = y.copy()
    y_lo, y_hi = np.interp([lo, hi], x, y)
    inside = (x >= lo) & (x <= hi)
    out[inside] = y_lo + (y_hi - y_lo) * (x[inside] - lo) / (hi - lo)
    return out


co2 = straighten(km, 2280, 2400)

lo, hi = 1560.0, 1680.0
y_lo, y_hi = np.interp([lo, hi], x, co2)
inner = (x > lo) & (x < hi)
xs = np.concatenate([[lo], x[inner], [hi]])
net = np.concatenate([[0.0], co2[inner] - (y_lo + (y_hi - y_lo) * (x[inner] - lo) / (hi - lo)), [0.0]])
height = float(net.max())
area = float(integrate.trapezoid(net, xs))

reference = {
    "software": {"numpy": np.__version__, "scipy": scipy.__version__},
    "x": x.tolist(),
    "percentR": percent_r.tolist(),
    "kubelkaMunk": km.tolist(),
    "logInverse": log_inverse.tolist(),
    "co2": {"fromCm": 2280, "toCm": 2400, "y": co2.tolist()},
    "band": {
        "fromCm": lo,
        "toCm": hi,
        "height": height,
        "area": area,
        "byHeight": (co2 / height).tolist(),
        "byArea": (co2 / area).tolist(),
    },
}
(out / "ftir-processing-reference.json").write_text(json.dumps(reference))
print("wrote", out / "ftir-processing-reference.json")
