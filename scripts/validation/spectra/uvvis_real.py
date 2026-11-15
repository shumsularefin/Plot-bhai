"""Independent Tauc numbers for the real TiO2 diffuse reflectance files, read by
tests/validation-uvvis-real.test.ts.

The files are tests/fixtures-real/uvvis/DRS_TiO2_annealed_at_{200,300}_oC.csv from Zenodo record
10.5281/zenodo.14608640 (Kuzhir, Maltanava and Belko, 2025, CC BY 4.0): wavelength in nm and
diffuse reflectance in %, separated by a semicolon, with a decimal comma. The record gives no band
gap, so these numbers check the arithmetic on real data, not a published value.

For each file, read here with plain Python (not this site's reader):

  F(R)     the Kubelka-Munk function (1 - R)^2 / (2 R), R as a fraction
  E        h c / (e lambda) from scipy.constants (CODATA 2022), eV
  Tauc     (F E)^2 for a direct and (F E)^(1/2) for an indirect allowed transition
  fit      a straight line by scipy.optimize.curve_fit over a fixed window on the steep part of the
           edge (direct 3.25 to 3.60 eV, indirect 3.10 to 3.30 eV, chosen by eye from the data);
           Eg = -a / b and its standard uncertainty by the delta method from the full covariance

Run:  python3 -I scripts/validation/spectra/uvvis_real.py tests/fixtures-real/uvvis tests/fixtures/validation
"""

import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np
import scipy
from scipy import constants, optimize

folder, out = Path(sys.argv[1]), Path(sys.argv[2])
HC = constants.h * constants.c / constants.e * 1e9
WINDOWS = {'direct': (2.0, (3.25, 3.60)), 'indirect': (0.5, (3.10, 3.30))}


def read(path):
    rows = []
    for line in path.read_text(encoding='latin-1').splitlines():
        fields = line.strip().split(';')
        if len(fields) != 2 or fields[1].strip() == '--':
            continue
        rows.append((float(fields[0].replace(',', '.')), float(fields[1].replace(',', '.'))))
    return np.array(rows)


result = {
    'source': (
        f'numpy {np.__version__}, scipy {scipy.__version__}; scripts/validation/spectra/uvvis_real.py; '
        'data: Zenodo 10.5281/zenodo.14608640 (CC BY 4.0)'
    ),
    'files': {},
}
for name in ('DRS_TiO2_annealed_at_200_oC.csv', 'DRS_TiO2_annealed_at_300_oC.csv'):
    path = folder / name
    data = read(path)
    order = np.argsort(HC / data[:, 0])
    energy = (HC / data[:, 0])[order]
    r = data[order, 1] / 100
    km = (1 - r) ** 2 / (2 * r)
    entry = {
        'md5': hashlib.md5(path.read_bytes()).hexdigest(),
        'points': int(data.shape[0]),
        'wavelengthRangeNm': [float(data[:, 0].min()), float(data[:, 0].max())],
        'kubelkaMunk': {str(i): float(km[i]) for i in (0, 100, 200, 300)},
        'fits': {},
    }
    for transition, (exponent, (lo, hi)) in WINDOWS.items():
        y = (km * energy) ** exponent
        inside = (energy >= lo) & (energy <= hi)
        (a, b), cov = optimize.curve_fit(lambda x, a, b: a + b * x, energy[inside], y[inside], p0=[0.0, 1.0])
        gradient = np.array([-1 / b, a / b**2])
        entry['fits'][transition] = {
            'exponent': exponent,
            'window': [lo, hi],
            'n': int(inside.sum()),
            'egEv': float(-a / b),
            'egSigma': float(math.sqrt(gradient @ cov @ gradient)),
        }
    result['files'][name] = entry
(out / 'uvvis-real-reference.json').write_text(json.dumps(result, indent=1) + '\n')
print(json.dumps({k: v['fits'] for k, v in result['files'].items()}, indent=1))
