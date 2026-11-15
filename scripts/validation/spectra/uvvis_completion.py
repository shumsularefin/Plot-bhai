"""Independent references for the UV-Vis completion (sub-stage 19e), read by
tests/validation-uvvis-completion.test.ts.

Every number is computed here with NumPy and SciPy, not with this site's code, on seeded
synthetic data stored in the fixture so the test uses the same input:

  sigmoid     A. R. Zanatta, Sci. Rep. 9 (2019) 11225, Eq. 8, alpha(E) = a_max + (a_min - a_max) /
              (1 + exp((E - E0) / dE)), fitted by scipy.optimize.curve_fit (unweighted) over a fixed
              range; Eq. 9, Eg = E0 - n dE with n = 0.3, 4.3 and 3.6, and sigma(Eg) from the full
              covariance matrix
  cody        (alpha / E)^(1/2) against E, a straight line by curve_fit over a fixed window, Eg = -a/b
              and its uncertainty by the delta method from the covariance of (a, b)
  slab        alpha from T and R: the root in alpha of T = (1 - R)^2 x / (1 - R^2 x^2), x = exp(-alpha d)
              (Zanatta Eq. 6 is its closed form), found by scipy.optimize.brentq
  k           k = alpha lambda / (4 pi), lambda in cm
  index       n from Eg: Moss n^4 Eg = 95 eV, Ravindra n = 4.084 - 0.62 Eg, Herve-Vandamme
              n^2 = 1 + (13.6 / (Eg + 3.47))^2, as written by S. K. Tripathy, Opt. Mater. 46 (2015) 240
  peaks       scipy.signal.find_peaks with a prominence threshold on two Gaussian bands, each
              position refined by the vertex of the parabola through the highest point and its two
              neighbours (numpy.polyfit, degree 2)

Run:  python3 -I scripts/validation/spectra/uvvis_completion.py tests/fixtures/validation
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import scipy
from scipy import constants, optimize, signal

out = Path(sys.argv[1])
rng = np.random.default_rng(20261115)
HC = constants.h * constants.c / constants.e * 1e9
N_TYPE = {"direct": 0.3, "indirect": 4.3, "amorphous": 3.6}


def boltzmann(e, s_min, s_max, e0, d):
    return s_max + (s_min - s_max) / (1 + np.exp((e - e0) / d))


# Sigmoid: alpha in cm^-1 rising from 1e3 to 5e4 around E0 = 3.25 eV, width 0.05 eV, with noise.
energy_s = np.round(np.arange(2.6, 3.8 + 1e-9, 0.005), 6)
alpha_s = np.round(boltzmann(energy_s, 1.0e3, 5.0e4, 3.25, 0.05) + rng.normal(0, 200, energy_s.size), 3)
range_s = (3.0, 3.5)
m = (energy_s >= range_s[0]) & (energy_s <= range_s[1])
p, cov = optimize.curve_fit(
    boltzmann, energy_s[m], alpha_s[m], p0=[alpha_s[m][0], alpha_s[m][-1], 3.25, 0.05], maxfev=20000
)
sigmoid = {
    "energyEv": energy_s.tolist(),
    "signal": alpha_s.tolist(),
    "range": list(range_s),
    "n": int(m.sum()),
    "sMin": float(p[0]),
    "sMax": float(p[1]),
    "e0Ev": float(p[2]),
    "e0Sigma": float(math.sqrt(cov[2, 2])),
    "deltaEv": float(p[3]),
    "deltaSigma": float(math.sqrt(cov[3, 3])),
    "eg": {
        t: {
            "egEv": float(p[2] - k * p[3]),
            "egSigma": float(math.sqrt(cov[2, 2] + k * k * cov[3, 3] - 2 * k * cov[2, 3])),
        }
        for t, k in N_TYPE.items()
    },
}

# Cody: alpha = B E (E - Eg)^2 above Eg = 1.7 eV (an amorphous-like edge) plus noise.
energy_c = np.round(np.arange(1.2, 2.6 + 1e-9, 0.01), 6)
alpha_c = np.where(energy_c > 1.7, 4.0e4 * energy_c * (energy_c - 1.7) ** 2, 0.0)
alpha_c = np.round(alpha_c + 50 + rng.normal(0, 20, energy_c.size), 3)
window_c = (1.9, 2.4)
mc = (energy_c >= window_c[0]) & (energy_c <= window_c[1])
cody_y = np.sqrt(alpha_c[mc] / energy_c[mc])
pc, covc = optimize.curve_fit(lambda x, a, b: a + b * x, energy_c[mc], cody_y, p0=[0.0, 1.0])
a, b = pc
eg_c = -a / b
grad = np.array([-1 / b, a / b**2])
cody = {
    "energyEv": energy_c.tolist(),
    "signal": alpha_c.tolist(),
    "window": list(window_c),
    "n": int(mc.sum()),
    "egEv": float(eg_c),
    "egSigma": float(math.sqrt(grad @ covc @ grad)),
    "slope": float(b),
}


def slab_t(alpha, r, d):
    x = math.exp(-alpha * d)
    return (1 - r) ** 2 * x / (1 - r * r * x * x)


slab = []
for t, r, d_nm in [(0.5, 0.1, 500), (0.05, 0.25, 1000), (0.8, 0.02, 200), (0.001, 0.3, 2000), (0.3, 0.0, 300)]:
    d = d_nm * 1e-7
    # T falls monotonically with alpha from (1 - R)^2 / (1 - R^2) at alpha = 0.
    root = optimize.brentq(lambda al: slab_t(al, r, d) - t, 0.0, 1e9, xtol=1e-12, rtol=1e-14)
    slab.append({"t": t, "r": r, "thicknessNm": d_nm, "alpha": root})

k_cases = [
    {"alpha": al, "wavelengthNm": wl, "k": al * wl * 1e-7 / (4 * math.pi)}
    for al, wl in [(1.0e4, 400.0), (2.5e5, 300.0), (123.0, 800.0)]
]

index = []
for eg in [1.0, 1.5, 2.0, 3.2, 3.37, 5.0]:
    index.append(
        {
            "egEv": eg,
            "moss": (95 / eg) ** 0.25,
            "ravindra": 4.084 - 0.62 * eg,
            "herveVandamme": math.sqrt(1 + (13.6 / (eg + 3.47)) ** 2),
        }
    )

# Peaks: two Gaussian bands on a sloping background with a little noise, 1 nm grid.
wl = np.arange(300.0, 800.0 + 1e-9, 1.0)
absorb = (
    0.8 * np.exp(-0.5 * ((wl - 452.3) / 18.0) ** 2)
    + 0.45 * np.exp(-0.5 * ((wl - 618.7) / 30.0) ** 2)
    + 0.05
    + 0.0001 * (800 - wl)
)
absorb = np.round(absorb + rng.normal(0, 0.0005, wl.size), 6)
prominence_percent = 5.0
threshold = (absorb.max() - absorb.min()) * prominence_percent / 100
idx, props = signal.find_peaks(absorb, prominence=threshold)
positions = []
for i in idx:
    c = np.polyfit(wl[i - 1 : i + 2], absorb[i - 1 : i + 2], 2)
    positions.append(float(-c[1] / (2 * c[0])))
peaks = {
    "wavelengthNm": wl.tolist(),
    "absorbance": absorb.tolist(),
    "prominencePercent": prominence_percent,
    "positionsNm": positions,
    "energiesEv": [HC / x for x in positions],
    "heights": [float(absorb[i]) for i in idx],
    "prominences": [float(v) for v in props["prominences"]],
}

fixture = {
    "generator": "scripts/validation/spectra/uvvis_completion.py",
    "versions": {"numpy": np.__version__, "scipy": scipy.__version__},
    "hcEvNm": HC,
    "sigmoid": sigmoid,
    "cody": cody,
    "slab": slab,
    "extinction": k_cases,
    "index": index,
    "peaks": peaks,
}
(out / "uvvis-completion-reference.json").write_text(json.dumps(fixture, indent=1) + "\n")
print("wrote", out / "uvvis-completion-reference.json")
