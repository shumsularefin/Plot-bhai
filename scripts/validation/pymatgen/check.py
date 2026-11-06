"""Independent distances and powder pattern from pymatgen (run by .github/workflows/validation.yml).

Usage: python -I check.py <repo dir>
For each CIF in scripts/cif-cache listed below: every interatomic distance up to 3.2 A from each
site of the asymmetric unit (pymatgen Structure.get_neighbors), and the Cu Ka1 powder pattern
from 10 to 100 deg 2theta without displacement factors (pymatgen XRDCalculator, relative
intensities scaled to 100). Writes tests/fixtures/validation/pymatgen.json.
"""
import json, os, sys, warnings
import pymatgen.core
from pymatgen.analysis.diffraction.xrd import XRDCalculator
from pymatgen.io.cif import CifParser

warnings.filterwarnings('ignore')
repo = sys.argv[1]
CIFS = ['9007531', '9015929', '7212242', '9007448']
out = {'source': f'pymatgen {pymatgen.core.__version__}', 'cases': []}
for cod in CIFS:
    structure = CifParser(os.path.join(repo, 'scripts', 'cif-cache', f'{cod}.cif')).parse_structures(primitive=False)[0]
    sites = []
    seen = set()
    for site in structure:
        key = site.species_string, round(site.frac_coords[0] % 1, 4), round(site.frac_coords[1] % 1, 4), round(site.frac_coords[2] % 1, 4)
        label = site.properties.get('label') if hasattr(site, 'properties') else None
        if label in seen:
            continue
        seen.add(label)
        neighbours = structure.get_neighbors(site, 3.2)
        sites.append({
            'label': label,
            'element': site.species_string,
            'x': [float(v) for v in site.frac_coords],
            'distances': sorted(round(float(n.nn_distance), 6) for n in neighbours),
        })
    pattern = XRDCalculator(wavelength='CuKa1').get_pattern(structure, scaled=True, two_theta_range=(10, 100))
    out['cases'].append({
        'cod': cod,
        'sites': sites,
        'peaks': [{'twoTheta': float(t), 'i': float(i), 'd': float(d), 'hkl': [list(x['hkl']) for x in hk]}
                  for t, i, d, hk in zip(pattern.x, pattern.y, pattern.d_hkls, pattern.hkls)],
    })
    print(cod, len(sites), len(out['cases'][-1]['peaks']))
os.makedirs(os.path.join(repo, 'tests', 'fixtures', 'validation'), exist_ok=True)
json.dump(out, open(os.path.join(repo, 'tests', 'fixtures', 'validation', 'pymatgen.json'), 'w'), indent=1)
