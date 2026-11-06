"""Independent figures of merit (de Wolff M20, Smith-Snyder F_N) for tests/xrd-indexing.test.ts.

Standard library only. Run from the repository root: python3 -I tests/fixtures/make_indexing_fom.py
Lines: the first 20 lines (intensity >= 1 %, Cu Ka1, lines closer than 0.06 deg merged) of a
reference phase, each moved by 0.004*sin(i+1) deg so the discrepancies are not zero. Calculated
lines use the general reciprocal metric with all index signs, so the enumeration and the d-spacing
formula are independent of the TypeScript code. Mean discrepancies below 0.001 deg (2theta) are
raised to it, as documented in src/core/xrd/indexing/index.ts.
"""
import json, math

LAMBDA = 1.5405929
TOL = 0.03
PRECISION = 0.001
CASES = [
    ("ceo2.json", "ceo2", "cubic", "F"),
    ("tio2.json", "rutile", "tetragonal", "P"),
    ("tio2.json", "anatase", "tetragonal", "I"),
    ("zno.json", "zno-wurtzite", "hexagonal", "P"),
    ("caco3.json", "aragonite", "orthorhombic", "P"),
]

def positions(phase):
    t = sorted(2 * math.degrees(math.asin(LAMBDA / (2 * p["d"]))) for p in phase["peaks"] if p["i"] >= 1)
    merged = []
    for x in t:
        if not merged or x - merged[-1] > 0.06:
            merged.append(x)
    return [x + 0.004 * math.sin(i + 1) for i, x in enumerate(merged[:20])]

def allowed(c, h, k, l):
    if c == "P": return True
    if c == "I": return (h + k + l) % 2 == 0
    if c == "C": return (h + k) % 2 == 0
    return (h + k) % 2 == 0 and (k + l) % 2 == 0

def q_of(system, a, b, c, h, k, l):
    if system == "hexagonal":
        return 4 / 3 * (h * h + h * k + k * k) / a ** 2 + l * l / c ** 2
    return h * h / a ** 2 + k * k / b ** 2 + l * l / c ** 2

out = []
for file, pid, system, centring in CASES:
    phase = next(p for p in json.load(open(f"tests/fixtures/cod-reference/{file}"))["phases"] if p["id"] == pid)
    a, b, c = phase["cell"]["a"], phase["cell"]["b"], phase["cell"]["c"]
    obs = positions(phase)
    q_obs = [(2 * math.sin(math.radians(t / 2)) / LAMBDA) ** 2 for t in obs]
    q_max = q_obs[-1] * 1.02
    calc = set()
    n = 16
    for h in range(-n, n + 1):
        for k in range(-n, n + 1):
            for l in range(-n, n + 1):
                if (h, k, l) == (0, 0, 0) or not allowed(centring, h, k, l):
                    continue
                q = q_of(system, a, b, c, h, k, l)
                if q <= q_max:
                    calc.add(round(q, 10))
    calc = sorted(calc)
    N = min(20, len(obs))
    dq = dt = floor = 0.0
    indexed = 0
    for i in range(N):
        tol_q = q_obs[i] / math.tan(math.radians(obs[i] / 2)) * math.radians(TOL)
        best = min(calc, key=lambda q: abs(q - q_obs[i]))
        if abs(best - q_obs[i]) > tol_q:
            continue
        indexed += 1
        dq += abs(best - q_obs[i])
        dt += abs(obs[i] - 2 * math.degrees(math.asin(LAMBDA * math.sqrt(best) / 2)))
        floor += q_obs[i] / math.tan(math.radians(obs[i] / 2)) * math.radians(PRECISION)
    n_calc = sum(1 for q in calc if q <= q_obs[N - 1] * (1 + 1e-9))
    mean_q = max(dq, floor) / indexed
    mean_t = max(dt / indexed, PRECISION)
    out.append({
        "id": pid, "file": file, "system": system, "centring": centring, "cell": [a, b, c],
        "positions": obs, "indexed": indexed, "nCalc": n_calc,
        "m20": q_obs[N - 1] / (2 * mean_q * n_calc), "fN": (1 / mean_t) * N / n_calc, "meanDelta": mean_t,
    })
json.dump(out, open("tests/fixtures/indexing-fom-python.json", "w"), indent=1)
for o in out:
    print(o["id"], o["indexed"], o["nCalc"], round(o["m20"], 2), round(o["fN"], 2))
