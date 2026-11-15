"""Independent references for the particle size statistics of sub-stage 19f, read by
tests/validation-particle-stats.test.ts.

Every number is computed here with NumPy and SciPy, not with this site's code, on seeded samples
stored in the fixture so the test uses the same input:

  t quantile   scipy.stats.t.ppf(0.975, n - 1)
  interval     mean +/- t s / sqrt(n), s with ddof=1, sem from scipy.stats.sem
  cv           s / mean
  moments      D[1,0] = sum d / n, D[3,2] = sum d^3 / sum d^2, D[4,3] = sum d^4 / sum d^3
  volume       numpy.percentile(d, [10, 50, 90], weights=d**3, method='inverted_cdf')
  anderson     scipy.stats.anderson(x, 'norm') on d (normal) and ln d (lognormal): the statistic
               and the critical value at the 5 % level
  normal tail  scipy.stats.norm.logcdf and logsf at a few z

Run:  python3 -I scripts/validation/particles/distribution_stats.py tests/fixtures/validation
"""

import json
import sys
import warnings
from pathlib import Path

import numpy as np
import scipy
from scipy import stats

out = Path(sys.argv[1])
rng = np.random.default_rng(20261115)

samples = {
    "lognormal": np.round(rng.lognormal(np.log(40.0), 0.35, 400), 4),
    "normal": np.round(rng.normal(120.0, 15.0, 150), 4),
    "small": np.round(rng.lognormal(np.log(8.0), 0.5, 12), 4),
    "bimodal": np.round(
        np.concatenate([rng.normal(20.0, 2.0, 200), rng.normal(60.0, 5.0, 60)]), 4
    ),
}


def anderson(x):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        res = stats.anderson(x, "norm")
    levels = list(res.significance_level)
    return {"a2": float(res.statistic), "critical5": float(res.critical_values[levels.index(5.0)])}


cases = {}
for name, d in samples.items():
    d = np.sort(d)
    n = d.size
    s = float(np.std(d, ddof=1))
    t = float(stats.t.ppf(0.975, n - 1))
    sem = float(stats.sem(d))
    dv = np.percentile(d, [10, 50, 90], weights=d**3, method="inverted_cdf")
    cases[name] = {
        "sizes": d.tolist(),
        "t975": t,
        "sem": sem,
        "lower": float(d.mean() - t * sem),
        "upper": float(d.mean() + t * sem),
        "cv": s / float(d.mean()),
        "d10": float(d.sum() / n),
        "d32": float((d**3).sum() / (d**2).sum()),
        "d43": float((d**4).sum() / (d**3).sum()),
        "dv10": float(dv[0]),
        "dv50": float(dv[1]),
        "dv90": float(dv[2]),
        "adNormal": anderson(d),
        "adLognormal": anderson(np.log(d)),
    }

t_table = [{"nu": nu, "t975": float(stats.t.ppf(0.975, nu))} for nu in [1, 2, 5, 10, 30, 100, 194]]
tails = [
    {"z": z, "logCdf": float(stats.norm.logcdf(z)), "logSf": float(stats.norm.logsf(z))}
    for z in [-12.0, -6.0, -2.5, -0.3, 0.0, 0.7, 3.1, 8.0, 20.0]
]

fixture = {
    "generator": "scripts/validation/particles/distribution_stats.py",
    "versions": {"numpy": np.__version__, "scipy": scipy.__version__},
    "cases": cases,
    "tQuantiles": t_table,
    "normalTails": tails,
}
(out / "particle-stats-reference.json").write_text(json.dumps(fixture, indent=1) + "\n")
print("wrote", out / "particle-stats-reference.json")
