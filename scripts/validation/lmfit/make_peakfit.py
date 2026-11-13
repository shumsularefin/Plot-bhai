"""Independent peak fits for tests/validation-lmfit.test.ts, made with lmfit (SciPy least squares).

Two small data sets are written with numpy (seeded, Poisson counting noise) and fitted with
lmfit's own built-in models, not with this site's formulas:

  doublet  two overlapping pseudo-Voigt peaks on a sloped straight background
           (PseudoVoigtModel + PseudoVoigtModel + LinearModel)
  pearson  one Pearson VII peak on a straight background (Pearson7Model + LinearModel)

Both fits are unweighted least squares, as this site's peak fit is.

lmfit's pseudo-Voigt mixes area-normalised shapes with the fraction α:
    f = A [(1 − α) G(σ_g) + α L(σ)],  σ_g = σ / √(2 ln 2),  FWHM = 2σ
This site mixes shapes of unit height with η. The heights of the two parts give
    η = h_L / (h_L + h_G),  h_L = α A / (π σ),  h_G = (1 − α) A / (σ_g √(2π))
and the peak height is h_L + h_G. The script stores α and the converted η.

Run (lmfit, scipy and numpy installed):
    python3 scripts/validation/lmfit/make_peakfit.py tests/fixtures/validation
It writes peakfit-doublet.xy, peakfit-pearson.xy and peakfit-lmfit.json there.
"""

import json
import math
import sys
from pathlib import Path

import lmfit
import numpy as np
import scipy
from lmfit.models import LinearModel, Pearson7Model, PseudoVoigtModel

out = Path(sys.argv[1])
rng = np.random.default_rng(20261112)


def gaussian(x, c, w):
    return np.exp(-4 * math.log(2) * (x - c) ** 2 / w**2)


def lorentzian(x, c, w):
    return 1 / (1 + 4 * (x - c) ** 2 / w**2)


def write_xy(name, x, y):
    lines = [f"{a:.4f} {int(b)}" for a, b in zip(x, y)]
    (out / name).write_text("\n".join(lines) + "\n")


def pv_result(params, prefix):
    a, c, s, al = (params[prefix + k].value for k in ("amplitude", "center", "sigma", "fraction"))
    h_l = al * a / (math.pi * s)
    h_g = (1 - al) * a / (s / math.sqrt(2 * math.log(2)) * math.sqrt(2 * math.pi))
    return {
        "center": c,
        "centerStderr": params[prefix + "center"].stderr,
        "fwhm": 2 * s,
        "fwhmStderr": 2 * params[prefix + "sigma"].stderr,
        "fraction": al,
        "eta": h_l / (h_l + h_g),
        "height": h_l + h_g,
        "area": a,
    }


# Doublet: peaks 0.35° apart, widths 0.16° and 0.22°, different Lorentzian character.
x = np.round(np.arange(34.0, 37.0001, 0.02), 4)
truth = 400 + 30 * (x - 35.5)
truth = truth + 5000 * (0.4 * lorentzian(x, 35.30, 0.16) + 0.6 * gaussian(x, 35.30, 0.16))
truth = truth + 2500 * (0.7 * lorentzian(x, 35.65, 0.22) + 0.3 * gaussian(x, 35.65, 0.22))
y = rng.poisson(truth).astype(float)
write_xy("peakfit-doublet.xy", x, y)

model = PseudoVoigtModel(prefix="a_") + PseudoVoigtModel(prefix="b_") + LinearModel(prefix="bg_")
params = model.make_params(
    a_amplitude=1000, a_center=35.28, a_sigma=0.1, a_fraction=0.5,
    b_amplitude=500, b_center=35.68, b_sigma=0.1, b_fraction=0.5,
    bg_slope=0, bg_intercept=400,
)
fit = model.fit(y, params, x=x)
doublet = {
    "peaks": [pv_result(fit.params, "a_"), pv_result(fit.params, "b_")],
    "background": {"slope": fit.params["bg_slope"].value, "intercept": fit.params["bg_intercept"].value},
    "sumSquares": float(np.sum(fit.residual**2)),
    "success": bool(fit.success),
}

# Pearson VII: m = 1.8, FWHM 0.30°.
x2 = np.round(np.arange(29.0, 31.0001, 0.02), 4)
k = 4 * (2 ** (1 / 1.8) - 1)
truth2 = 200 + 3000 * (1 + k * (x2 - 30.0) ** 2 / 0.30**2) ** -1.8
y2 = rng.poisson(truth2).astype(float)
write_xy("peakfit-pearson.xy", x2, y2)

model2 = Pearson7Model(prefix="p_") + LinearModel(prefix="bg_")
params2 = model2.make_params(
    p_amplitude=1000, p_center=30.02, p_sigma=0.2, p_expon=2, bg_slope=0, bg_intercept=200
)
fit2 = model2.fit(y2, params2, x=x2)
pearson = {
    "center": fit2.params["p_center"].value,
    "fwhm": fit2.params["p_fwhm"].value,
    "m": fit2.params["p_expon"].value,
    "height": fit2.params["p_height"].value,
    "area": fit2.params["p_amplitude"].value,
    "sumSquares": float(np.sum(fit2.residual**2)),
    "success": bool(fit2.success),
}

(out / "peakfit-lmfit.json").write_text(
    json.dumps(
        {
            "source": f"lmfit {lmfit.__version__}, scipy {scipy.__version__}, numpy {np.__version__}",
            "doublet": doublet,
            "pearson": pearson,
        },
        indent=2,
    )
    + "\n"
)
