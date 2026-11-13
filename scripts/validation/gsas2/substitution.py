"""Shared-site substitution check against GSAS-II (run by .github/workflows/validation.yml).

Usage: python -I substitution.py <work dir> <repo dir>
Simulates Zn(0.85)Mg(0.15)O in GSAS-II from the ZnO CIF (COD 1577381): the Zn site holds Zn with
Frac 0.85 and an added Mg atom at the same position with Frac 0.15, both isotropic with the CIF's
U_iso of Zn (0.0065 A^2), O isotropic 0.0075 A^2; Cu Ka1/Ka2, the TCH widths of cu.instprm with
almost no asymmetry, no anomalous dispersion, no sample broadening. Then refines the same data in
GSAS-II with the instrument fixed: scale, background, cell, and the two fractions under GSAS-II's
constraints Frac(Zn) + Frac(Mg) = 1 and U_iso(Mg) = U_iso(Zn), starting from Mg 0.05.
Writes tests/fixtures/validation/znmgo-substitution.xy (2theta, counts with Poisson noise, seed 31)
and znmgo-substitution.json (truth, GSAS-II result with esd, GSAS-II's |F|^2 of every reflection).
"""
import json, os, sys
import numpy as np
import GSASII.GSASIIElem as G2el
import GSASII.GSASIIscriptable as G

G2el.FPcalc = lambda orbs, kev: (0.0, 0.0, 0.0)  # no anomalous dispersion, as on the site

work, repo = sys.argv[1], sys.argv[2]
out = os.path.join(repo, 'tests', 'fixtures', 'validation')
run = os.path.join(work, 'substitution')
os.makedirs(out, exist_ok=True)
os.makedirs(run, exist_ok=True)
inst = os.path.join(run, 'zno.instprm')
text = open(os.path.join(repo, 'scripts', 'validation', 'rietveld', 'cu.instprm')).read()
open(inst, 'w').write(text.replace('SH/L:0.002', 'SH/L:0.0001'))
CIF = os.path.join(repo, 'scripts', 'cif-cache', '1577381.cif')
X_MG, U_ZN, U_O = 0.15, 0.0065, 0.0075


def build(gpx, histograms, x_mg):
    ph = gpx.add_phase(CIF, phasename='zno', fmthint='CIF', histograms=histograms)
    cx, ct, cs, cia = ph.data['General']['AtomPtrs']
    for a in ph.data['Atoms']:
        a[cia] = 'I'
        a[cia + 1] = U_ZN if a[ct].startswith('Zn') else U_O
        if a[ct].startswith('Zn'):
            a[cx + 3] = 1.0 - x_mg
            zn = a[cx:cx + 3]
    ph.add_atom(zn[0], zn[1], zn[2], 'Mg', 'Mg1', occ=x_mg, uiso=U_ZN)
    for hap in ph.data['Histograms'].values():
        hap['Size'][1][0] = 1.0e5
        hap['Mustrain'][1][0] = 0.0
    return ph


def describe(ph):
    cx, ct, cs, cia = ph.data['General']['AtomPtrs']
    return [{'label': a[ct - 1], 'element': a[ct], 'x': a[cx:cx + 3], 'frac': a[cx + 3],
             'uiso': a[cia + 1]} for a in ph.data['Atoms']]


gpx = G.G2Project(newgpx=os.path.join(run, 'sim.gpx'))
h = gpx.add_simulated_powder_histogram('sim', inst, 20.0, 130.0, Tstep=0.02, scale=400.0)
ph = build(gpx, [h], X_MG)
h.data['Background'][0] = ['chebyschev-1', True, 3, 200.0, -40.0, 10.0]
gpx.data['Controls']['data']['max cyc'] = 0
gpx.do_refinements([{}])
x = np.array(h.getdata('x'))
ycalc = np.array(h.getdata('ycalc'))
y = np.random.default_rng(31).poisson(ycalc).astype(float)
np.savetxt(os.path.join(out, 'znmgo-substitution.xy'), np.c_[x, y], fmt='%.4f %.0f')
np.savetxt(os.path.join(run, 'znmgo-substitution.xy'), np.c_[x, y], fmt='%.4f %.0f')
truth = describe(ph)
cell_true = ph.get_cell()
reflections = [[int(r[0]), int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[9])]
               for r in h.reflections()['zno']['RefList']]

gpx = G.G2Project(newgpx=os.path.join(run, 'refine.gpx'))
h = gpx.add_powder_histogram(os.path.join(run, 'znmgo-substitution.xy'), inst, fmthint='xye')
ph = build(gpx, [h], 0.05)
h.data['Background'][0] = ['chebyschev-1', True, 6, 100.0, 0, 0, 0, 0, 0]
gpx.save()
gpx.add_EqnConstr(1.0, ['0::Afrac:0', '0::Afrac:2'], [1.0, 1.0])
gpx.add_EquivConstr(['0::AUiso:0', '0::AUiso:2'])
gpx.data['Controls']['data']['max cyc'] = 30
gpx.do_refinements([
    {'set': {'Background': {'no. coeffs': 6, 'refine': True}, 'Sample Parameters': ['Scale']}},
    {'set': {'Cell': True}},
    {'set': {'Atoms': {'Zn': 'F', 'Mg1': 'F'}}},
    {},
])
cov = gpx['Covariance']['data']
esd = dict(zip(cov['varyList'], [float(s) for s in cov['sig']]))
dep = {k: float(v) for k, v in cov.get('depSigDict', {}).items() if 'Afrac' in k for v in [v[1]]}
result = {
    'source': 'GSAS-II (github.com/AdvancedPhotonSource/GSAS-II) commit ' + os.environ.get('GSAS2_COMMIT', 'unknown'),
    'cif': '1577381.cif',
    'instrument': {k.split(':')[0]: float(k.split(':')[1]) for k in open(inst).read().split()
                   if ':' in k and k.split(':')[1].replace('.', '').replace('-', '').isdigit()},
    'truth': {'xMg': X_MG, 'uZn': U_ZN, 'uO': U_O, 'atoms': truth, 'cell': cell_true},
    'reflections': reflections,
    'ymax': float(ycalc.max()),
    'gsas2': {'Rwp': h.get_wR(), 'cell': ph.get_cell(), 'atoms': describe(ph), 'esd': esd,
              'dependentEsd': dep},
    'python': sys.version.split()[0],
    'numpy': np.__version__,
}
json.dump(result, open(os.path.join(out, 'znmgo-substitution.json'), 'w'), indent=1)
print(json.dumps(result['gsas2']))
