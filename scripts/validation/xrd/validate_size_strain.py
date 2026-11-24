"""Independent SciPy/NumPy reference validation for Plot Bhai XRD size-strain methods.

Generates tests/fixtures/validation/xrd-size-reference.json checking:
- Scherrer, Monshi-Scherrer, Williamson-Hall UDM, Size-Strain Plot (SSP), Halder-Wagner, Dislocation density
against independent numpy + scipy.stats.linregress on Cu Kalpha1 peaks with known D = 25.0 nm and eps = 0.0020.
"""
import json
from pathlib import Path
import numpy as np
from scipy import stats

K = 0.9
LAMBDA_NM = 0.1540598
TRUE_D_NM = 25.0
TRUE_EPS = 0.0020
TWO_THETAS = [31.77, 34.42, 36.25, 47.54, 56.60, 62.86, 67.96]

thetas = np.deg2rad(np.array(TWO_THETAS) / 2.0)
# Linear additive broadening (Williamson-Hall UDM exact): beta = K*lambda/(D*cos(theta)) + 4*eps*tan(theta)
betas_wh = K * LAMBDA_NM / (TRUE_D_NM * np.cos(thetas)) + 4.0 * TRUE_EPS * np.tan(thetas)
# Pure size broadening (Scherrer / Monshi exact): eps = 0
betas_size = K * LAMBDA_NM / (TRUE_D_NM * np.cos(thetas))

# 1. Scherrer mean on pure size peaks
scherrer_d = K * LAMBDA_NM / (betas_size * np.cos(thetas))

# 2. Monshi-Scherrer: ln(beta) = ln(K*lambda/D) + ln(1/cos(theta))
ms_fit = stats.linregress(np.log(1.0 / np.cos(thetas)), np.log(betas_size))
monshi_d = float(K * LAMBDA_NM / np.exp(ms_fit.intercept))

# 3. Williamson-Hall UDM: beta*cos(theta) = K*lambda/D + 4*eps*sin(theta)
wh_fit = stats.linregress(4.0 * np.sin(thetas), betas_wh * np.cos(thetas))
wh_d = float(K * LAMBDA_NM / wh_fit.intercept)
wh_eps = float(wh_fit.slope)

# 4. Size-Strain Plot (SSP): (d*beta*cos(theta))^2 = (K*lambda/D)*(d^2*beta*cos(theta)) + (2*eps)^2
d_nm = LAMBDA_NM / (2.0 * np.sin(thetas))
x_ssp = (d_nm ** 2) * betas_wh * np.cos(thetas)
y_ssp = (d_nm * betas_wh * np.cos(thetas)) ** 2
ssp_fit = stats.linregress(x_ssp, y_ssp)
ssp_d = float(K * LAMBDA_NM / ssp_fit.slope)
ssp_eps = float(np.sqrt(max(ssp_fit.intercept, 0.0)) / (2.0 * LAMBDA_NM))

# 5. Halder-Wagner: (beta* / d*)^2 = (K/D)*(beta* / d*^2) + (2*eps)^2
# where beta* = beta*cos(theta)/lambda, d* = 2*sin(theta)/lambda
beta_star = betas_wh * np.cos(thetas) / LAMBDA_NM
d_star = 2.0 * np.sin(thetas) / LAMBDA_NM
x_hw = beta_star / (d_star ** 2)
y_hw = (beta_star / d_star) ** 2
hw_fit = stats.linregress(x_hw, y_hw)
hw_d = float(K / hw_fit.slope)
hw_eps = float(np.sqrt(max(hw_fit.intercept, 0.0)) / 2.0)

ref = {
    "k": K,
    "lambdaNm": LAMBDA_NM,
    "trueD": TRUE_D_NM,
    "trueEps": TRUE_EPS,
    "peaksSize": [{"twoTheta": tt, "beta": float(b)} for tt, b in zip(TWO_THETAS, betas_size)],
    "peaksWh": [{"twoTheta": tt, "beta": float(b)} for tt, b in zip(TWO_THETAS, betas_wh)],
    "scipy": {
        "scherrerD": round(float(np.mean(scherrer_d)), 6),
        "monshiD": round(monshi_d, 6),
        "whD": round(wh_d, 6),
        "whEps": round(wh_eps, 8),
        "sspD": round(ssp_d, 6),
        "sspEps": round(ssp_eps, 8),
        "hwD": round(hw_d, 6),
        "hwEps": round(hw_eps, 8),
        "dislocationDensity": round(1e18 / (TRUE_D_NM ** 2), 4),
    },
}

out_path = Path("tests/fixtures/validation/xrd-size-reference.json")
out_path.write_text(json.dumps(ref, indent=2) + "\n", encoding="utf-8")
print("WROTE:", out_path, "SciPy:", ref["scipy"])
