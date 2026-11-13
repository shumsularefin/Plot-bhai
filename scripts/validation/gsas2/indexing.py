"""Indexes the line lists of tests/fixtures/validation/indexing-lines.json with GSAS-II.

Usage: python -I indexing.py <repo dir> [case id ...]
With case ids only those are searched and the others keep their stored result (the monoclinic
searches take minutes each).
GSAS-II's indexing (GSASIIindex.DoIndexPeaks: a Monte Carlo search over trial cells with
least-squares refinement, ranked by M20 divided by 1 + the number of unindexed lines) is a
different method from this site's. Every Bravais lattice from cubic to orthorhombic is searched
(and the monoclinic ones for the cases marked monoclinic), with GSAS-II's default controls (zero
0, Nc/Nobs 4, start volume 25 A^3), a fixed random seed and at most TIMEOUT_S seconds per Bravais
lattice. GSAS-II lists every cell it finds by M20 and leaves the choice to the user, and a multiple
or lower-symmetry cell often has the highest M20, so this writes, for each case, the cell with
the highest M20 in each Bravais lattice among those that index every line
(tests/fixtures/validation/indexing-gsas2.json).
"""
import json, math, os, sys
import numpy as np
import GSASII.GSASIIindex as G2indx

NAMES = ['Cubic-F', 'Cubic-I', 'Cubic-P', 'Trigonal-R', 'Trigonal/Hexagonal-P', 'Tetragonal-I', 'Tetragonal-P',
         'Orthorhombic-F', 'Orthorhombic-I', 'Orthorhombic-A', 'Orthorhombic-B', 'Orthorhombic-C', 'Orthorhombic-P',
         'Monoclinic-I', 'Monoclinic-A', 'Monoclinic-C', 'Monoclinic-P', 'Triclinic']
TIMEOUT_S = 60
MONOCLINIC = {'baddeleyite', 'bismite', 'wo3-monoclinic', 'tenorite'}
repo = sys.argv[1]
fixtures = os.path.join(repo, 'tests', 'fixtures', 'validation')
cases = json.load(open(os.path.join(fixtures, 'indexing-lines.json')))
path = os.path.join(fixtures, 'indexing-gsas2.json')
stored = {c['id']: c for c in json.load(open(path)).get('cases', [])} if os.path.exists(path) else {}
only = sys.argv[2:]
out = []
for case in cases:
    if only and case['id'] not in only:
        if case['id'] in stored:
            out.append(stored[case['id']])
        continue
    np.random.seed(11)
    lam = case['wavelength']
    # GSAS-II peak rows: 2theta, intensity, use, indexed, h, k, l, d_obs, d_calc
    peaks = [[t, 100.0, True, False, 0, 0, 0, lam / (2 * math.sin(math.radians(t / 2))), 0.0] for t in case['twoTheta']]
    last = 17 if case['id'] in MONOCLINIC else 13
    bravais = [i < last for i in range(18)]
    ok, dmin, cells = G2indx.DoIndexPeaks(peaks, [0, 0.0, 4, 25.0], bravais, None, ifX20=True, timeout=TIMEOUT_S)
    if not ok:
        raise SystemExit(case['id'] + ': GSAS-II found no cell')
    # Of the cells that index every line, the one with the highest M20 in each Bravais lattice.
    best = {}
    for c in cells:
        name = NAMES[c[2]]
        if c[1] == 0 and (name not in best or c[0] > best[name]['m20']):
            best[name] = {'m20': float(c[0]), 'bravais': name, 'cell': [float(v) for v in c[3:9]], 'volume': float(c[9])}
    out.append({'id': case['id'], 'cells': sorted(best.values(), key=lambda c: -c['m20'])})
    print(case['id'], json.dumps(out[-1]['cells']), flush=True)
json.dump({'source': 'GSAS-II (github.com/AdvancedPhotonSource/GSAS-II) commit ' + os.environ.get('GSAS2_COMMIT', 'unknown'),
           'numpy': np.__version__, 'cases': out}, open(path, 'w'), indent=1)
