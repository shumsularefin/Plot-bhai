"""Loads the GSAS-II starting set written by this site's Export step into GSAS-II.

Usage: python -I load_export.py <export dir> <repo dir>
<export dir> holds anatase.xye, anatase.instprm and anatase.cif, written by
  GSAS_EXPORT_DIR=<export dir> npx vitest run tests/validation-gsas-export.test.ts
(this site's refinement of tests/fixtures/validation/anatase-tch.xy). GSAS-II reads the three
files as a user would, and the script records what it read, R_wp with only the scale and the
background refined, and R_wp and the cell after continuing the refinement in GSAS-II. Writes
tests/fixtures/validation/gsas-export.json.

As in structure.py, anomalous dispersion is switched off and sample broadening made negligible,
because the pattern was simulated that way and this site's model has neither.
"""
import json, os, sys
import numpy as np
import GSASII.GSASIIElem as G2el
import GSASII.GSASIIscriptable as G

G2el.FPcalc = lambda orbs, kev: (0.0, 0.0, 0.0)
work, repo = sys.argv[1], sys.argv[2]

gpx = G.G2Project(newgpx=os.path.join(work, 'export.gpx'))
h = gpx.add_powder_histogram(os.path.join(work, 'anatase.xye'), os.path.join(work, 'anatase.instprm'), fmthint='xye')
ph = gpx.add_phase(os.path.join(work, 'anatase.cif'), phasename='anatase', fmthint='CIF', histograms=[h])
for hap in ph.data['Histograms'].values():
    hap['Size'][1][0] = 1.0e5
    hap['Mustrain'][1][0] = 0.0

ip = h.data['Instrument Parameters'][0]
cx, ct, cs, cia = ph.data['General']['AtomPtrs']
x, w = np.array(h.getdata('x')), np.array(h.getdata('yweight'))
read = {
    'points': int(len(x)),
    'firstSigma': float(1 / np.sqrt(w[0])),
    'instrument': {k: float(ip[k][1]) for k in ('Lam1', 'Lam2', 'I(L2)/I(L1)', 'Zero', 'Polariz.', 'U', 'V', 'W', 'X', 'Y', 'SH/L')},
    'spaceGroup': ph.data['General']['SGData']['SpGrp'],
    'cell': [float(v) for v in ph.data['General']['Cell'][1:7]],
    'atoms': [{'label': a[ct - 1], 'element': a[ct], 'x': [float(v) for v in a[cx:cx + 3]],
               'occupancy': float(a[cx + 3]), 'uiso': float(a[cia + 1])} for a in ph.data['Atoms']],
}

h.data['Background'][0] = ['chebyschev-1', True, 6, 100.0, 0, 0, 0, 0, 0]
gpx.data['Controls']['data']['max cyc'] = 30
gpx.do_refinements([{'set': {'Background': {'no. coeffs': 6, 'refine': True}, 'Sample Parameters': ['Scale']}}])
read['rwpAsExported'] = float(h.get_wR())
gpx.do_refinements([
    {'set': {'Cell': True, 'Instrument Parameters': ['Zero']}},
    {'set': {'Instrument Parameters': ['U', 'V', 'W', 'X', 'Y']}},
    {'set': {'Atoms': {'all': 'XU'}}},
    {},
])
read['rwpContinued'] = float(h.get_wR())
c = ph.get_cell()
read['cellContinued'] = [c['length_a'], c['length_b'], c['length_c']]
read['source'] = 'GSAS-II (github.com/AdvancedPhotonSource/GSAS-II) commit ' + os.environ.get('GSAS2_COMMIT', 'unknown')
json.dump(read, open(os.path.join(repo, 'tests', 'fixtures', 'validation', 'gsas-export.json'), 'w'), indent=1)
print(json.dumps(read))
