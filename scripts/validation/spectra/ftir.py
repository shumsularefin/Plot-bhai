"""Independent references for the FTIR tool, read by tests/validation-ftir.test.ts.

A seeded synthetic absorbance spectrum (400 to 4000 cm-1, step 2 cm-1: Gaussian and Lorentzian
bands on a curved background with noise) is stored in the fixture together with:

  peaks         scipy.signal.find_peaks(prominence=0.02) and peak_prominences; the position is the
                vertex of numpy.polyfit(order 2) through the maximum and its two neighbours
  derivative    scipy.signal.savgol_filter(window 15, order 3, deriv=2, delta=2, mode='interp')
  area          scipy.integrate.trapezoid above the straight line between the two ends, with the
                ends interpolated by numpy.interp
  subtraction   the least-squares factor k by numpy.linalg.lstsq, with the reference on a grid
                shifted by 1 cm-1 (numpy.interp onto the sample's grid)
  baselines     pybaselines 1.2.1: whittaker.asls (lam 1e5, p 0.01, 10 solves), whittaker.arpls
                (lam 1e5, tol 1e-6, max_iter 100) and polynomial.modpoly (order 3, 200 fits); the rubber band from scipy.spatial.ConvexHull (Qhull)
  bandfit       two overlapping Gaussian bands on a line, lmfit GaussianModel x 2 + LinearModel
                (FWHM = 2 sqrt(2 ln 2) sigma, height = amplitude / (sigma sqrt(2 pi)))

Run:  python3 -I scripts/validation/spectra/ftir.py tests/fixtures/validation
"""

import json
import math
import sys
from pathlib import Path

import lmfit
import numpy as np
import pybaselines
import scipy
from lmfit.models import GaussianModel, LinearModel
from pybaselines import polynomial, whittaker
from scipy import integrate, signal
from scipy.spatial import ConvexHull

out = Path(sys.argv[1])
rng = np.random.default_rng(20261115)

x = np.arange(400.0, 4000.0 + 1e-9, 2.0)


def gauss(c, w, h):
    return h * np.exp(-4 * math.log(2) * (x - c) ** 2 / w**2)


def lorentz(c, w, h):
    return h / (1 + 4 * (x - c) ** 2 / w**2)


bands = (
    gauss(3400, 260, 0.35)
    + gauss(2925, 30, 0.22)
    + gauss(2855, 22, 0.14)
    + lorentz(1720, 24, 0.55)
    + gauss(1650, 40, 0.30)
    + gauss(1600, 30, 0.18)
    + lorentz(1450, 18, 0.20)
    + gauss(1100, 60, 0.45)
    + lorentz(800, 14, 0.12)
)
background = 0.08 + 0.05 * ((x - 400) / 3600) ** 2 - 0.03 * (x - 400) / 3600
y = np.round(bands + background + rng.normal(0, 0.002, x.size), 6)

# Peaks.
indices, props = signal.find_peaks(y, prominence=0.02)
peaks = []
for i in indices:
    a2, a1, _ = np.polyfit(x[i - 1 : i + 2], y[i - 1 : i + 2], 2)
    vertex = -a1 / (2 * a2) if a2 < 0 else x[i]
    peaks.append({'wavenumber': float(min(max(vertex, x[i - 1]), x[i + 1]))})
prominences = signal.peak_prominences(y, indices)[0]
for p, i, prom in zip(peaks, indices, prominences):
    p['height'] = float(y[i])
    p['prominence'] = float(prom)

d2 = signal.savgol_filter(y, 15, 3, deriv=2, delta=2.0, mode='interp')

# Band area between two points that are not on the grid.
lo, hi = 1551.3, 1799.1
inner = (x > lo) & (x < hi)
xs = np.concatenate([[lo], x[inner], [hi]])
ya, yb = np.interp(lo, x, y), np.interp(hi, x, y)
ys = np.interp(xs, x, y) - (ya + (yb - ya) * (xs - lo) / (hi - lo))
area = float(integrate.trapezoid(ys, xs))

# Subtraction: a reference with bands only above 3550 cm-1 (and at 1650), on a shifted grid.
rx = np.arange(401.0, 3999.0 + 1e-9, 2.0)
reference = np.round(
    0.3 * np.exp(-4 * math.log(2) * (rx - 3750) ** 2 / 40**2)
    + 0.2 * np.exp(-4 * math.log(2) * (rx - 3850) ** 2 / 30**2)
    + 0.1 * np.exp(-4 * math.log(2) * (rx - 1650) ** 2 / 20**2),
    6,
)
sample = np.round(y + 0.6 * np.interp(x, rx, reference), 6)
range_ = (3650.0, 3950.0)
sel = (x >= range_[0]) & (x <= range_[1])
k = float(np.linalg.lstsq(np.interp(x[sel], rx, reference)[:, None], sample[sel], rcond=None)[0][0])

# Baselines.
asls, _ = whittaker.asls(y, lam=1e5, p=0.01, max_iter=9, tol=-1.0)
arpls, _ = whittaker.arpls(y, lam=1e5, tol=1e-6, max_iter=100)
# pybaselines solves once before its loop, so max_iter = 199 is 200 fits; tol = -1 never stops
# early. use_original=False (the default) clips the already clipped data, as this site does.
modpoly, mp = polynomial.modpoly(y, x, poly_order=3, tol=-1.0, max_iter=199, use_original=False)
hull = ConvexHull(np.column_stack([x, y]))
lower = sorted({int(v) for simplex, eq in zip(hull.simplices, hull.equations) if eq[1] < 0 for v in simplex})
rubber = np.interp(x, x[lower], y[lower])

# Band fit of the 1650 and 1600 cm-1 Gaussian bands between 1560 and 1690 cm-1.
f_lo, f_hi = 1560.0, 1690.0
fsel = (x >= f_lo) & (x <= f_hi)
fx, fy = x[fsel], y[fsel]
model = GaussianModel(prefix='a_') + GaussianModel(prefix='b_') + LinearModel(prefix='l_')
params = model.make_params(
    a_center=1655, a_sigma=15, a_amplitude=10, b_center=1595, b_sigma=12, b_amplitude=5,
    l_slope=0, l_intercept=0.1,
)
# The 1720 cm-1 Lorentzian's tail is part of the background here; both programs fit the same
# model (two Gaussians and a straight line), so they must agree with each other, not with the
# generating bands.
fit = model.fit(fy, params, x=fx)
s2 = 2 * math.sqrt(2 * math.log(2))
fitted = []
for prefix in ('b_', 'a_'):
    p = fit.params
    sigma = p[prefix + 'sigma']
    fitted.append(
        {
            'center': p[prefix + 'center'].value,
            'centerSigma': p[prefix + 'center'].stderr,
            'fwhm': s2 * sigma.value,
            'fwhmSigma': s2 * sigma.stderr,
            'height': p[prefix + 'amplitude'].value / (sigma.value * math.sqrt(2 * math.pi)),
        }
    )

pick = lambda arr: {str(i): float(arr[i]) for i in (0, 7, 300, 900, 1500, 1793, 1800)}
result = {
    'source': (
        f'numpy {np.__version__}, scipy {scipy.__version__}, lmfit {lmfit.__version__}, '
        f'pybaselines {pybaselines.__version__}; scripts/validation/spectra/ftir.py'
    ),
    'wavenumber': x.tolist(),
    'absorbance': y.tolist(),
    'peaks': {'minProminence': 0.02, 'list': peaks},
    'secondDerivative': {'window': 15, 'order': 3, 'values': pick(d2)},
    'area': {'from': lo, 'to': hi, 'area': area},
    'subtraction': {
        'referenceX': rx.tolist(),
        'reference': reference.tolist(),
        'sample': sample.tolist(),
        'range': range_,
        'factor': k,
    },
    'baselines': {
        'asls': {'lambda': 1e5, 'p': 0.01, 'values': pick(asls)},
        'arpls': {'lambda': 1e5, 'values': pick(arpls)},
        'modpoly': {'degree': 3, 'fits': len(mp['tol_history']) + 1, 'values': pick(modpoly)},
        'rubberBand': pick(rubber),
    },
    'bandFit': {'from': f_lo, 'to': f_hi, 'starts': [1595.0, 1655.0], 'bands': fitted},
}
(out / 'ftir-reference.json').write_text(json.dumps(result, indent=1) + '\n')
print('peaks', len(peaks), 'area', area, 'k', k, 'modpoly fits', len(mp['tol_history']) + 1, fitted)
