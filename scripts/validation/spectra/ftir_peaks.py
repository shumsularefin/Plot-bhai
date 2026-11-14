"""Independent references for the FTIR peak table of sub-stage 19c, read by
tests/validation-ftir-peaks.test.ts.

  isolated   one Gaussian (FWHM 30) and one Lorentzian (FWHM 20) band on a zero background,
             1000 to 2000 cm-1, step 1 cm-1: the width from scipy.signal.peak_widths
             (rel_height 0.5, widths interpolated by scipy) and the area from
             scipy.integrate.trapezoid above the straight line between the two ends
  sloped     two separated bands on a sloping, curved background with seeded noise (step 2 cm-1):
             the local baseline (straight line between the lowest points left and right of each
             band, searched up to the neighbouring band) written here with numpy, then the width
             from scipy.signal.peak_widths on the signal above that line and the area from
             scipy.integrate.trapezoid

Run:  python3 -I scripts/validation/spectra/ftir_peaks.py tests/fixtures/validation
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import scipy
from scipy import integrate, signal

out = Path(sys.argv[1])


def gauss(x, c, w, h):
    return h * np.exp(-4 * math.log(2) * (x - c) ** 2 / w**2)


def lorentz(x, c, w, h):
    return h / (1 + 4 * (x - c) ** 2 / w**2)


def isolated(kind):
    x = np.arange(1000.0, 2000.0 + 1e-9, 1.0)
    y = gauss(x, 1500, 30, 0.5) if kind == "gaussian" else lorentz(x, 1500, 20, 0.5)
    i = int(np.argmax(y))
    widths = signal.peak_widths(y, [i], rel_height=0.5)
    line = y[0] + (y[-1] - y[0]) * (x - x[0]) / (x[-1] - x[0])
    return {
        "x": x.tolist(),
        "y": y.tolist(),
        "peak": float(x[i]),
        "fwhm": float(widths[0][0] * 1.0),
        "area": float(integrate.trapezoid(y - line, x)),
    }


def sloped():
    rng = np.random.default_rng(20261119)
    x = np.arange(800.0, 2200.0 + 1e-9, 2.0)
    y = (
        gauss(x, 1150, 60, 0.45)
        + lorentz(x, 1720, 24, 0.55)
        + 0.1
        + 0.00004 * (x - 800)
        + 0.03 * ((x - 800) / 1400) ** 2
        + rng.normal(0, 0.002, x.size)
    )
    # The two maxima (highest data point near each band centre).
    centres = [int(np.argmax(np.where(np.abs(x - c) < 15, y, -np.inf))) for c in (1150, 1720)]
    peaks = []
    for k, c in enumerate(centres):
        lo = centres[k - 1] if k > 0 else 0
        hi = centres[k + 1] if k + 1 < len(centres) else x.size - 1
        L = lo + int(np.argmin(y[lo : c + 1]))
        R = c + int(np.argmin(y[c : hi + 1]))
        line = y[L] + (y[R] - y[L]) * (x[L : R + 1] - x[L]) / (x[R] - x[L])
        net = y[L : R + 1] - line
        width = signal.peak_widths(net, [c - L], rel_height=0.5, prominence_data=(
            np.array([net[c - L]]), np.array([0]), np.array([R - L])))
        peaks.append(
            {
                "wavenumber": float(x[c]),
                "from": float(x[L]),
                "to": float(x[R]),
                "height": float(net[c - L]),
                "fwhm": float(width[0][0] * 2.0),
                "area": float(integrate.trapezoid(net, x[L : R + 1])),
            }
        )
    return {"x": x.tolist(), "y": y.tolist(), "peaks": peaks}


reference = {
    "software": {"numpy": np.__version__, "scipy": scipy.__version__},
    "gaussian": isolated("gaussian"),
    "lorentzian": isolated("lorentzian"),
    "sloped": sloped(),
}
(out / "ftir-peaks-reference.json").write_text(json.dumps(reference))
print("wrote", out / "ftir-peaks-reference.json")
