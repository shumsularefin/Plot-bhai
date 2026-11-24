"""Independent SciPy/NumPy reference validation for Plot Bhai thermal analysis.

Generates tests/fixtures/validation/thermal-reference.json covering:
1. TGA 3-step CaC2O4·H2O stoichiometric benchmark (12.33% H2O, 19.17% CO, 30.12% CO2, 38.38% CaO)
2. DSC endothermic melting enthalpy (scipy.integrate.trapezoid) & glass transition Tg (linregress)
3. ICTAC-style multi-heating-rate isoconversional kinetics (beta = 2, 5, 10, 20 K/min)
   integrated with scipy.integrate.solve_ivp (Ea = 120 kJ/mol, A = 1e10 s^-1, first-order)
   and checked with independent scipy.stats.linregress for Kissinger, FWO, KAS, Starink, Friedman.
"""
import json
from pathlib import Path
import numpy as np
from scipy import integrate, stats

R = 8.31446261815324  # J/(mol·K)
K0 = 273.15

# --- 1. TGA CaC2O4·H2O stoichiometric 3-step decomposition ---
T_tga = np.linspace(30.0, 900.0, 871)
steps_spec = [
    ("H2O", 160.0, 12.0, 12.33),
    ("CO", 470.0, 16.0, 19.17),
    ("CO2", 740.0, 18.0, 30.12),
]
mass_tga = np.full_like(T_tga, 100.0)
dtg_tga = np.zeros_like(T_tga)
for _, center, width, loss in steps_spec:
    z = (T_tga - center) / width
    sig = 1.0 / (1.0 + np.exp(-z))
    mass_tga -= loss * sig
    dtg_tga += (loss / width) * sig * (1.0 - sig)

def temp_at_mass(T, m, target):
    idx = np.where(m <= target)[0][0]
    if idx == 0:
        return float(T[0])
    t0, t1 = T[idx - 1], T[idx]
    m0, m1 = m[idx - 1], m[idx]
    return float(t0 + (target - m0) / (m1 - m0) * (t1 - t0))

tga_ref = {
    "T": [round(float(x), 4) for x in T_tga],
    "massPct": [round(float(x), 6) for x in mass_tga],
    "dtg": [round(float(x), 6) for x in dtg_tga],
    "expected": {
        "steps": [
            {"label": name, "fromC": center - 6 * width, "toC": center + 6 * width, "peakC": center, "lossPct": loss}
            for name, center, width, loss in steps_spec
        ],
        "residuePct": round(float(mass_tga[-1]), 4),
        "t5": round(temp_at_mass(T_tga, mass_tga, 95.0), 4),
        "t10": round(temp_at_mass(T_tga, mass_tga, 90.0), 4),
        "t50": round(temp_at_mass(T_tga, mass_tga, 50.0), 4),
    },
}

# --- 2. DSC melting peak (indium-like, 156.6 C, 28.5 J/g, 10 K/min) & Tg (100 C) ---
T_dsc = np.linspace(50.0, 220.0, 1701)  # 0.1 C step
rate_k_min = 10.0
rate_k_s = rate_k_min / 60.0
# Endo down (exo positive): Gaussian peak of area -28.5 J/g * (rate_k_s) in W/g
peak_center = 156.6
peak_sigma = 2.0
true_dh_j_g = 28.5  # positive endothermic enthalpy
# In exo-up convention, endothermic peak is negative heat flow (W/g):
# integral(exo dT) / rate_k_s = -28.5 J/g
amp_wg = true_dh_j_g * rate_k_s / (peak_sigma * np.sqrt(2.0 * np.pi))
exo_melt = -amp_wg * np.exp(-0.5 * ((T_dsc - peak_center) / peak_sigma) ** 2)
mask_melt = (T_dsc >= 145.0) & (T_dsc <= 170.0)
scipy_dh = float(-integrate.trapezoid(exo_melt[mask_melt], T_dsc[mask_melt]) / rate_k_s)

# Glass transition at 100 C, deltaCp = 0.45 J/(g·K) -> step in endo (W/g) = deltaCp * rate_k_s
T_tg = np.linspace(40.0, 160.0, 1201)
true_tg = 100.0
true_dcp = 0.45
step_wg = true_dcp * rate_k_s
# Endo-up step is +step_wg, so exo-up step is -step_wg
exo_tg = -step_wg / (1.0 + np.exp(-(T_tg - true_tg) / 2.5))
pre_mask = (T_tg >= 50.0) & (T_tg <= 75.0)
post_mask = (T_tg >= 125.0) & (T_tg <= 150.0)
pre_fit = stats.linregress(T_tg[pre_mask], -exo_tg[pre_mask])
post_fit = stats.linregress(T_tg[post_mask], -exo_tg[post_mask])
mid_vals = 0.5 * ((pre_fit.intercept + pre_fit.slope * T_tg) + (post_fit.intercept + post_fit.slope * T_tg))
diff_tg = (-exo_tg) - mid_vals
idx_tg = int(np.where(diff_tg >= 0)[0][0])
scipy_tg = float(T_tg[idx_tg - 1] + (0 - diff_tg[idx_tg - 1]) / (diff_tg[idx_tg] - diff_tg[idx_tg - 1]) * (T_tg[idx_tg] - T_tg[idx_tg - 1]))
scipy_dcp = float(((post_fit.intercept + post_fit.slope * scipy_tg) - (pre_fit.intercept + pre_fit.slope * scipy_tg)) / rate_k_s)

dsc_ref = {
    "melt": {
        "T": [round(float(x), 4) for x in T_dsc],
        "exo": [round(float(x), 6) for x in exo_melt],
        "rateKPerMin": rate_k_min,
        "fromC": 145.0,
        "toC": 170.0,
        "scipyEnthalpyJPerG": round(scipy_dh, 6),
        "peakC": peak_center,
    },
    "tg": {
        "T": [round(float(x), 4) for x in T_tg],
        "exo": [round(float(x), 6) for x in exo_tg],
        "rateKPerMin": rate_k_min,
        "pre": [50.0, 75.0],
        "post": [125.0, 150.0],
        "scipyTgC": round(scipy_tg, 4),
        "scipyDeltaCp": round(scipy_dcp, 6),
    },
}

# --- 3. ICTAC-style multi-heating-rate ODE kinetics ---
Ea_true_kj = 120.0
Ea_true_j = Ea_true_kj * 1000.0
A_s = 1e10
betas = [2.0, 5.0, 10.0, 20.0]  # K/min
T_kin = np.linspace(150.0, 450.0, 601)  # 0.5 C grid
alphas = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]

runs = []
tp_list = []
t_alpha_mat = []
dtg_alpha_mat = []

for beta in betas:
    beta_s = beta / 60.0
    def rhs(T_c, y):
        a = min(max(y[0], 0.0), 1.0)
        return [(A_s / beta_s) * np.exp(-Ea_true_j / (R * (T_c + K0))) * (1.0 - a)]
    sol = integrate.solve_ivp(rhs, (T_kin[0], T_kin[-1]), [0.0], t_eval=T_kin, method="Radau", rtol=1e-11, atol=1e-13)
    a_arr = np.clip(sol.y[0], 0.0, 1.0)
    mass_pct = 100.0 * (1.0 - a_arr)
    dtg = np.array([(A_s / beta_s) * np.exp(-Ea_true_j / (R * (tc + K0))) * (1.0 - a) * 100.0 for tc, a in zip(T_kin, a_arr)])
    tp_c = float(T_kin[int(np.argmax(dtg))])
    tp_list.append((beta, tp_c))
    # Exact T(alpha) by linear interpolation on a_arr
    t_al = [float(np.interp(al, a_arr, T_kin)) for al in alphas]
    dtg_al = [float(np.interp(t, T_kin, dtg)) / 100.0 for t in t_al]
    t_alpha_mat.append(t_al)
    dtg_alpha_mat.append(dtg_al)
    runs.append({
        "betaKPerMin": beta,
        "tpC": round(tp_c, 4),
        "T": [round(float(x), 3) for x in T_kin],
        "massPct": [round(float(x), 6) for x in mass_pct],
        "dtg": [round(float(x), 6) for x in dtg],
    })

# Independent SciPy regressions
inv_tp = [1.0 / (tp + K0) for _, tp in tp_list]
y_kiss = [np.log(b / ((tp + K0) ** 2)) for b, tp in tp_list]
kiss_ea = float(-stats.linregress(inv_tp, y_kiss).slope * R / 1000.0)

kas_eas, fwo_eas, starink_eas, friedman_eas = [], [], [], []
for k in range(len(alphas)):
    inv_t = [1.0 / (t_alpha_mat[r][k] + K0) for r in range(len(betas))]
    y_kas = [np.log(betas[r] / ((t_alpha_mat[r][k] + K0) ** 2)) for r in range(len(betas))]
    y_fwo = [np.log(betas[r]) for r in range(len(betas))]
    y_sta = [np.log(betas[r] / ((t_alpha_mat[r][k] + K0) ** 1.92)) for r in range(len(betas))]
    y_fri = [np.log(betas[r] * dtg_alpha_mat[r][k]) for r in range(len(betas))]
    kas_eas.append(float(-stats.linregress(inv_t, y_kas).slope * R / 1000.0))
    fwo_eas.append(float(-stats.linregress(inv_t, y_fwo).slope * R / (1.052 * 1000.0)))
    starink_eas.append(float(-stats.linregress(inv_t, y_sta).slope * R / (1.0008 * 1000.0)))
    friedman_eas.append(float(-stats.linregress(inv_t, y_fri).slope * R / 1000.0))

kinetics_ref = {
    "trueEaKJ": Ea_true_kj,
    "alphas": alphas,
    "runs": runs,
    "scipy": {
        "kissingerEaKJ": round(kiss_ea, 4),
        "kasMeanEaKJ": round(float(np.mean(kas_eas)), 4),
        "fwoMeanEaKJ": round(float(np.mean(fwo_eas)), 4),
        "starinkMeanEaKJ": round(float(np.mean(starink_eas)), 4),
        "friedmanMeanEaKJ": round(float(np.mean(friedman_eas)), 4),
    },
}

out_path = Path("tests/fixtures/validation/thermal-reference.json")
out_path.write_text(json.dumps({"tga": tga_ref, "dsc": dsc_ref, "kinetics": kinetics_ref}, indent=2) + "\n", encoding="utf-8")
print("WROTE:", out_path, "bytes:", out_path.stat().st_size)
print("SciPy Kinetics Ea (kJ/mol):", kinetics_ref["scipy"])
print("SciPy DSC melt dH (J/g):", dsc_ref["melt"]["scipyEnthalpyJPerG"], "Tg:", dsc_ref["tg"]["scipyTgC"], "dCp:", dsc_ref["tg"]["scipyDeltaCp"])
