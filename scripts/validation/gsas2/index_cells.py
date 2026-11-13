"""Lets GSAS-II index and refine the cells this site suggests, on the same lines.

Usage: python -I index_cells.py <repo dir>
For each case of tests/fixtures/validation/indexing-lines.json (2theta list and the cell this
site suggests), GSAS-II generates the allowed hkl of that Bravais lattice, assigns them to the
lines and refines the cell by least squares (GSASIIindex.refinePeaks). Writes the refined cell,
GSAS-II's M20, the number of calculated lines and the number of lines it could not index to
tests/fixtures/validation/indexing-gsas2-refined.json.
"""
import json, math, os, sys
import numpy as np
import GSASII.GSASIIindex as G2indx
import GSASII.GSASIIlattice as G2lat

# GSAS-II's Bravais lattice numbers (GSASIIindex.DoIndexPeaks)
IBRAV = {'cubicF': 0, 'cubicI': 1, 'cubicP': 2, 'hexagonalP': 4, 'tetragonalI': 5, 'tetragonalP': 6,
         'orthorhombicF': 7, 'orthorhombicI': 8, 'orthorhombicA': 9, 'orthorhombicC': 11, 'orthorhombicP': 12,
         'monoclinicI': 13, 'monoclinicA': 14, 'monoclinicC': 15, 'monoclinicP': 16}
repo = sys.argv[1]
fixtures = os.path.join(repo, 'tests', 'fixtures', 'validation')
out = []
for case in json.load(open(os.path.join(fixtures, 'indexing-lines.json'))):
    lam, site = case['wavelength'], case['site']
    key = site['system'] + site['centring']
    cell = list(site['cell'])
    if site['system'] == 'hexagonal':
        cell[3:6] = [90.0, 90.0, 120.0]
    # GSAS-II peak rows: 2theta, intensity, use, indexed, h, k, l, d_obs, d_calc
    peaks = [[t, 100.0, True, False, 0, 0, 0, lam / (2 * math.sin(math.radians(t / 2))), 0.0] for t in case['twoTheta']]
    # Lines GSAS-II cannot index with this site's cell as it is (hkl generated to just below the
    # smallest d, with the 0.005 A cushion of GSAS-II's own search).
    start = G2lat.cell2A(cell)
    hkl = G2lat.GenHBravais(G2indx.getDmin(peaks) - 0.005, IBRAV[key], start)
    unindexed = sum(1 for p in G2indx.IndexPeaks(peaks, hkl)[1] if not p[3])
    n_calc, m20, x20, A = G2indx.refinePeaks(peaks, IBRAV[key], start)
    out.append({'id': case['id'], 'bravais': key, 'nCalc': int(n_calc), 'm20': float(m20), 'unindexed': unindexed,
                'cell': [float(v) for v in G2lat.A2cell(A)]})
    print(json.dumps(out[-1]))
json.dump({'source': 'GSAS-II (github.com/AdvancedPhotonSource/GSAS-II) commit ' + os.environ.get('GSAS2_COMMIT', 'unknown'),
           'numpy': np.__version__, 'cases': out}, open(os.path.join(fixtures, 'indexing-gsas2-refined.json'), 'w'), indent=1)
