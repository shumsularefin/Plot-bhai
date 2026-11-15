"""Independent references for the UV-Vis tool, read by tests/validation-uvvis.test.ts.

Every number is computed here with NumPy, SciPy and lmfit, not with this site's code, on
seeded synthetic spectra that are stored in the fixture so the test uses the same input:

  constants   h c / e from scipy.constants (CODATA 2022) in eV nm
  tauc        a direct-gap film (250 nm thick): alpha = ln(10) A / t, the Tauc quantity
              (alpha E)^2, a straight-line fit by scipy.optimize.curve_fit over a fixed window,
              Eg = -a / b and its standard uncertainty by the delta method from the full
              covariance matrix of (a, b)
  urbach      ln S against E by curve_fit; Eu = 1 / slope, sigma(Eu) = sigma(slope) / slope^2
  derivative  the maximum of dA/dE and d ln A/dE, each from numpy.polyfit lines through 9 points
  smoothing   scipy.signal.savgol_filter(window 11, order 3, mode='interp')
  calibration Beer-Lambert standards: scipy.stats.linregress (free intercept) and curve_fit of
              A = k c (through the origin)
  kinetics    ln(C0 / C) = k t through the origin by curve_fit
  scattering  a direct edge at 3.2 eV under a power-law background 0.03 + 0.2 (E / 3.2)^2.5 with
              noise: S_b = a + c E^m by bounded curve_fit (0 <= m <= 4, and m fixed at 4) over
              the sub-gap range, S - S_b, the Tauc line over a fixed window, and sigma(Eg) from
              the edge fit plus J C J^T with J by numpy central differences (stage 22)
  plasmon     a Lorentzian band on a straight background on the energy axis, lmfit
              LorentzianModel + LinearModel (FWHM = 2 sigma, height = amplitude / (pi sigma))

Run:  python3 -I scripts/validation/spectra/uvvis.py tests/fixtures/validation
"""

import json
import math
import sys
from pathlib import Path

import lmfit
import numpy as np
import scipy
from lmfit.models import LinearModel, LorentzianModel
from scipy import constants, optimize, signal, stats

out = Path(sys.argv[1])
rng = np.random.default_rng(20261114)
HC = constants.h * constants.c / constants.e * 1e9


def line_fit(x, y):
    """Straight line y = a + b x by curve_fit; returns a, b and the scaled covariance."""
    p, cov = optimize.curve_fit(lambda x, a, b: a + b * x, x, y, p0=[0.0, 1.0])
    return p, cov


def origin_fit(x, y):
    p, cov = optimize.curve_fit(lambda x, k: k * x, x, y, p0=[1.0])
    return float(p[0]), float(math.sqrt(cov[0, 0]))


# Tauc: direct gap at 3.2 eV, absorbance A = C sqrt(E - Eg) / E + baseline + noise.
wavelength = np.arange(300.0, 600.0 + 1e-9, 0.5)
energy_w = HC / wavelength
edge = np.where(energy_w > 3.2, 1.1 * np.sqrt(np.clip(energy_w - 3.2, 0, None)) / energy_w, 0.0)
absorbance = np.round(edge + 0.04 + rng.normal(0, 0.002, wavelength.size), 6)
thickness_nm = 250.0
order = np.argsort(energy_w)
energy = energy_w[order]
alpha = math.log(10) * absorbance[order] / (thickness_nm * 1e-7)
tauc_y = (alpha * energy) ** 2
window = (3.30, 3.55)
inside = (energy >= window[0]) & (energy <= window[1])
(a, b), cov = line_fit(energy[inside], tauc_y[inside])
eg = -a / b
gradient = np.array([-1 / b, a / b**2])  # d Eg / d(a, b)
eg_sigma = math.sqrt(gradient @ cov @ gradient)

# Urbach tail S = 0.02 exp((E - 3) / 0.08) with 1 % noise.
u_energy = np.linspace(2.6, 3.1, 201)
u_signal = 0.02 * np.exp((u_energy - 3.0) / 0.08) * (1 + rng.normal(0, 0.01, u_energy.size))
u_window = (2.7, 3.0)
u_in = (u_energy >= u_window[0]) & (u_energy <= u_window[1])
(_, slope), u_cov = line_fit(u_energy[u_in], np.log(u_signal[u_in]))
eu = 1 / slope
eu_sigma = math.sqrt(u_cov[1, 1]) / slope**2


def derivative_max(e, s, lo, hi, log):
    values = np.log(s) if log else s
    best = None
    for i in range(4, e.size - 4):
        if not (lo <= e[i] <= hi):
            continue
        slope_i = np.polyfit(e[i - 4 : i + 5], values[i - 4 : i + 5], 1)[0]
        if best is None or slope_i > best[1]:
            best = (float(e[i]), float(slope_i))
    return best


a_e = absorbance[order]
d_lin = derivative_max(energy, a_e, 3.0, 4.0, False)
d_log = derivative_max(energy, a_e, 3.0, 4.0, True)

smoothed = signal.savgol_filter(absorbance, 11, 3, mode='interp')

# Beer-Lambert calibration, path 1 cm.
conc = np.array([0.0, 2.0, 4.0, 6.0, 8.0, 10.0])
std_a = np.round(0.012 + 0.0835 * conc + rng.normal(0, 0.004, conc.size), 5)
lr = stats.linregress(conc, std_a)
k0, k0_sigma = origin_fit(conc, std_a)

# Pseudo-first-order kinetics with a dark period at -30 min.
times = np.array([-30.0, 0.0, 10.0, 20.0, 40.0, 60.0, 90.0])
kin_a = np.round(
    np.where(times < 0, 1.02, 0.95 * np.exp(-0.021 * np.clip(times, 0, None)))
    * (1 + rng.normal(0, 0.01, times.size)),
    5,
)
used = times >= 0
a0 = kin_a[times == 0][0]
k, k_sigma = origin_fit(times[used], np.log(a0 / kin_a[used]))

# Plasmon band: Lorentzian in energy, centre 2.38 eV, FWHM 0.32 eV, height 0.8, on a line.
p_wavelength = np.arange(400.0, 700.0 + 1e-9, 1.0)
p_energy = HC / p_wavelength
p_abs = np.round(
    0.8 / (1 + 4 * (p_energy - 2.38) ** 2 / 0.32**2)
    + 0.05
    + 0.03 * (p_energy - 2.4)
    + rng.normal(0, 0.003, p_wavelength.size),
    6,
)
p_from, p_to = HC / 650.0, HC / 430.0
p_in = (p_energy >= p_from) & (p_energy <= p_to)
model = LorentzianModel(prefix='b_') + LinearModel(prefix='l_')
params = model.make_params(b_center=HC / 525, b_sigma=0.15, b_amplitude=0.4, l_slope=0, l_intercept=0)
fit = model.fit(p_abs[p_in], params, x=p_energy[p_in])
pb = fit.params
height = pb['b_amplitude'].value / (math.pi * pb['b_sigma'].value)

# Power-law (scattering) baseline, stage 22. Its own generator, so the numbers above do not move.
s_rng = np.random.default_rng(20261115)
s_wavelength = np.arange(250.0, 850.0 + 1e-9, 1.0)
s_energy_raw = HC / s_wavelength
s_abs = np.round(
    np.where(s_energy_raw > 3.2, 1.2 * np.sqrt(np.clip(s_energy_raw - 3.2, 0, None)) / s_energy_raw, 0)
    + 0.03
    + 0.2 * (s_energy_raw / 3.2) ** 2.5
    + s_rng.normal(0, 0.003, s_wavelength.size),
    6,
)
s_order = np.argsort(s_energy_raw)
s_energy = s_energy_raw[s_order]
s_signal = s_abs[s_order]
s_top = 3.1
s_edge = (3.25, 3.8)
s_below = s_energy <= s_top
s_in = (s_energy >= s_edge[0]) & (s_energy <= s_edge[1])


def power_law(e, a, c, m):
    return a + c * e**m


def scattering_gap(params):
    a_b, c_b, m_b = params
    y = ((s_signal - power_law(s_energy, a_b, c_b, m_b)) * s_energy) ** 2
    (a_e, b_e), cov_e = line_fit(s_energy[s_in], y[s_in])
    grad = np.array([-1 / b_e, a_e / b_e**2])
    return -a_e / b_e, math.sqrt(grad @ cov_e @ grad)


def scattering_result(params, cov):
    eg_s, sigma_edge = scattering_gap(params)
    jac = np.zeros(3)
    for i in range(3):
        h = math.sqrt(cov[i, i]) / 10
        if h > 0:
            up, down = np.array(params, float), np.array(params, float)
            up[i] += h
            down[i] -= h
            jac[i] = (scattering_gap(up)[0] - scattering_gap(down)[0]) / (2 * h)
    return {
        'a': float(params[0]),
        'c': float(params[1]),
        'm': float(params[2]),
        'covariance': cov.tolist(),
        'egEv': eg_s,
        'egSigma': math.sqrt(sigma_edge**2 + jac @ cov @ jac),
    }


tight = {'ftol': 1e-15, 'xtol': 1e-15, 'gtol': 1e-15, 'max_nfev': 100000}
p_free, cov_free = optimize.curve_fit(
    power_law,
    s_energy[s_below],
    s_signal[s_below],
    p0=[0.0, 0.01, 2.0],
    bounds=([-np.inf, -np.inf, 0.0], [np.inf, np.inf, 4.0]),
    **tight,
)
p_four, cov_four = optimize.curve_fit(
    lambda e, a, c: power_law(e, a, c, 4.0),
    s_energy[s_below],
    s_signal[s_below],
    p0=[0.0, 0.01],
    method='trf',
    **tight,
)
cov_four3 = np.zeros((3, 3))
cov_four3[:2, :2] = cov_four

result = {
    'source': (
        f'numpy {np.__version__}, scipy {scipy.__version__}, lmfit {lmfit.__version__}; '
        'scripts/validation/spectra/uvvis.py'
    ),
    'hcEvNm': HC,
    'tauc': {
        'wavelengthNm': wavelength.tolist(),
        'absorbance': absorbance.tolist(),
        'thicknessNm': thickness_nm,
        'window': window,
        'taucCheck': {str(i): float(tauc_y[i]) for i in (0, 200, 400, 600)},
        'egEv': eg,
        'egSigma': eg_sigma,
        'slope': float(b),
        'intercept': float(a),
        'n': int(inside.sum()),
        'derivativeLinear': d_lin,
        'derivativeLog': d_log,
        'smoothed': {str(i): float(smoothed[i]) for i in (0, 3, 5, 300, 595, 597, 600)},
    },
    'urbach': {
        'energyEv': u_energy.tolist(),
        'signal': u_signal.tolist(),
        'window': u_window,
        'euEv': eu,
        'euSigma': eu_sigma,
    },
    'calibration': {
        'concentrations': conc.tolist(),
        'absorbances': std_a.tolist(),
        'slope': lr.slope,
        'intercept': lr.intercept,
        'slopeSigma': lr.stderr,
        'interceptSigma': lr.intercept_stderr,
        'rSquared': lr.rvalue**2,
        'originSlope': k0,
        'originSlopeSigma': k0_sigma,
    },
    'kinetics': {
        'timesMin': times.tolist(),
        'absorbances': kin_a.tolist(),
        'kPerMin': k,
        'kSigma': k_sigma,
    },
    'scattering': {
        'wavelengthNm': s_wavelength.tolist(),
        'absorbance': s_abs.tolist(),
        'subGapToEv': s_top,
        'edgeWindow': list(s_edge),
        'free': scattering_result(p_free, cov_free),
        'fixedFour': scattering_result([p_four[0], p_four[1], 4.0], cov_four3),
    },
    'plasmon': {
        'wavelengthNm': p_wavelength.tolist(),
        'absorbance': p_abs.tolist(),
        'fromNm': 430.0,
        'toNm': 650.0,
        'startNm': 525.0,
        'centerEv': pb['b_center'].value,
        'centerEvSigma': pb['b_center'].stderr,
        'fwhmEv': 2 * pb['b_sigma'].value,
        'fwhmEvSigma': 2 * pb['b_sigma'].stderr,
        'height': height,
    },
}
(out / 'uvvis-reference.json').write_text(json.dumps(result, indent=1) + '\n')
print('Eg', eg, '+-', eg_sigma, 'Eu', eu, 'k', k, 'plasmon', pb['b_center'].value)
