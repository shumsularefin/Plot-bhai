"""Reference values for tests/xrd-peak-shapes.test.ts, from the Python standard library only.

ln Γ(z) from math.lgamma (an implementation independent of the site's Lanczos code), and the
Pearson VII area per unit height and FWHM,
    F(m) = √π Γ(m − ½) / [2 √(2^(1/m) − 1) Γ(m)],
evaluated with it. Run: python3 -I tests/fixtures/make_pearson_area.py > tests/fixtures/pearson-area-python.json
"""

import json
import math

z_values = [0.05, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3.3, 5, 7.25, 10, 17.5, 30, 55, 100, 170]
m_values = [0.6, 0.75, 1, 1.25, 1.5, 2, 3, 5, 10, 20, 50]


def area_factor(m):
    return (
        math.sqrt(math.pi)
        * math.exp(math.lgamma(m - 0.5) - math.lgamma(m))
        / (2 * math.sqrt(2 ** (1 / m) - 1))
    )


print(
    json.dumps(
        {
            "source": "Python " + ".".join(map(str, __import__("sys").version_info[:3])) + " math.lgamma",
            "lnGamma": [[z, math.lgamma(z)] for z in z_values],
            "pearsonAreaFactor": [[m, area_factor(m)] for m in m_values],
        },
        indent=1,
    )
)
