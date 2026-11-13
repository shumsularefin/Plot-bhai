"""Spherical-harmonic preferred orientation check against GSAS-II (run by .github/workflows/validation.yml).

Usage: python -I texture.py <work dir> <repo dir>
Writes tests/fixtures/validation/texture.json with
  plm:        GSAS-II's normalised associated Legendre functions (pytexture.pyplmpsi, the Fortran
              PLMPSI) for l = 2..16, m = -l..l and several angles;
  functions:  for every Laue class (and unique axis), a cell, GSASIIlattice.CrsAng angles of a few
              h k l, the coefficient names of GenSHCoeffT(Laue, '0', order, False) and GetKcl of
              each term at those angles; GetKsl(l, 0, '0', psi, 0) on a grid of psi; Lnorm(l);
  patterns:   the per-reflection preferred-orientation correction (reflection list column 12,
              from SHPOcal) of several phases from scripts/cif-cache with chosen coefficients, in
              Bragg-Brentano and (ZnO) Debye-Scherrer geometry, from zero-cycle calculations;
  simulation and gsas2: a ZnO (COD 1577381) pattern simulated in GSAS-II with order-4 texture,
              Poisson noise (seed 43), refined in GSAS-II from zero coefficients (scale, background,
              cell, then the coefficients). The pattern goes to zno-texture.xy.
No anomalous dispersion and U_iso = 0 for every atom (the test computes |F|^2 with the same).
"""
import json, os, sys
import numpy as np
import GSASII.GSASIIElem as G2el
import GSASII.GSASIIlattice as G2lat
import GSASII.GSASIIscriptable as G

try:
    import GSASII.pytexture as ptx
except ImportError:
    import pytexture as ptx

G2el.FPcalc = lambda orbs, kev: (0.0, 0.0, 0.0)  # no anomalous dispersion, as on the site

work, repo = sys.argv[1], sys.argv[2]
out = os.path.join(repo, 'tests', 'fixtures', 'validation')
run = os.path.join(work, 'texture')
os.makedirs(out, exist_ok=True)
os.makedirs(run, exist_ok=True)
inst = os.path.join(repo, 'scripts', 'validation', 'rietveld', 'cu.instprm')
cifs = os.path.join(repo, 'scripts', 'cif-cache')
ptx.pyqlmninit()

# 1. Legendre functions.
PSI = [0.0, 13.0, 37.5, 61.0, 90.0, 118.0, 166.0]
plm = []
for l in range(2, 17, 2):
    for m in range(-l, l + 1):
        plm.append({'l': l, 'm': m, 'psi': PSI,
                    'p': [float(v) for v in ptx.pyplmpsi(l, m, len(PSI), np.array(PSI))[0]]})

# 2. Angles and crystal harmonics for every Laue class.
HKLS = [(1, 2, 3), (2, -1, 4), (3, 1, -2), (0, 0, 2), (1, 1, 0), (4, 0, 1)]
TRICLINIC = [5.1, 6.3, 7.2, 81.0, 97.0, 103.0]
HEX = [3.25, 3.25, 5.21, 90.0, 90.0, 120.0]
CASES = [
    ('-1', '', TRICLINIC, 12), ('-1', '', [5.1, 6.3, 7.2, 90.0, 90.0, 90.0], 12),
    ('2/m', 'a', [5.1, 6.3, 7.2, 97.0, 90.0, 90.0], 12), ('2/m', 'a', [5.1, 6.3, 7.2, 90.0, 90.0, 90.0], 12),
    ('2/m', 'b', [7.3, 7.54, 7.69, 90.0, 90.9, 90.0], 12), ('2/m', 'b', [7.3, 7.54, 7.69, 90.0, 90.0, 90.0], 12),
    ('2/m', 'c', [5.1, 6.3, 7.2, 90.0, 90.0, 104.0], 12), ('2/m', 'c', [5.1, 6.3, 7.2, 90.0, 90.0, 90.0], 12),
    ('mmm', '', [3.96, 13.86, 3.7, 90.0, 90.0, 90.0], 12),
    ('4/m', '', [5.2, 5.2, 11.4, 90.0, 90.0, 90.0], 12), ('4/mmm', '', [4.594, 4.594, 2.959, 90.0, 90.0, 90.0], 12),
    ('3', '', HEX, 12), ('3m1', '', HEX, 12), ('31m', '', HEX, 12), ('6/m', '', HEX, 12), ('6/mmm', '', HEX, 12),
    ('3R', '', [5.1, 5.1, 5.1, 55.3, 55.3, 55.3], 12), ('3mR', '', [5.1, 5.1, 5.1, 55.3, 55.3, 55.3], 12),
    ('m3', '', [10.6, 10.6, 10.6, 90.0, 90.0, 90.0], 16), ('m3m', '', [5.411, 5.411, 5.411, 90.0, 90.0, 90.0], 16),
]
functions = []
for laue, uniq, cell, order in CASES:
    sg = {'SGLaue': laue, 'SGUniq': uniq}
    names = G2lat.GenSHCoeffT(laue, '0', order, False)
    angles, kcl = [], []
    for hkl in HKLS:
        phi, beta = G2lat.CrsAng(np.array(hkl), cell, sg)
        phi, beta = float(phi), float(beta)
        angles.append([phi, beta])
        row = []
        for name in names:
            L, N = eval(name.strip('C'))
            row.append(float(np.ravel(G2lat.GetKcl(L, N, laue, np.array([phi]), np.array([beta])))[0]))
        kcl.append(row)
    functions.append({'laue': laue, 'unique': uniq, 'cell': cell, 'order': order, 'names': names,
                      'hkls': HKLS, 'angles': angles, 'kcl': kcl})
ksl = [{'l': l, 'psi': PSI,
        'k': [float(np.ravel(G2lat.GetKsl(l, 0, '0', np.array([p]), np.array([0.0]))[0])[0]) for p in PSI]}
       for l in range(2, 17, 2)]
lnorm = {l: float(G2lat.Lnorm(l)) for l in range(2, 17, 2)}


def isotropic_zero(ph):
    cx, ct, cs, cia = ph.data['General']['AtomPtrs']
    for a in ph.data['Atoms']:
        a[cia] = 'I'
        a[cia + 1] = 0.0


def hap_of(ph):
    return list(ph.data['Histograms'].values())[0]


def set_sh(ph, order, coefficients, refine):
    names = G2lat.GenSHCoeffT(ph.data['General']['SGData']['SGLaue'], '0', order, False)
    values = {n: float(coefficients.get(n, 0.0)) for n in names}
    hap_of(ph)['Pref.Ori.'] = ['SH', 1.0, refine, [0, 0, 1], order, values, [''], 0.1]
    return names


# 3. Per-reflection corrections of real phases (zero cycles).
PATTERNS = [
    ('zno-flat', '1577381.cif', 'Bragg-Brentano', 6, {'C(2,0)': 0.35, 'C(4,0)': -0.2, 'C(6,0)': 0.1, 'C(6,6)': 0.05}),
    ('zno-capillary', '1577381.cif', 'Debye-Scherrer', 6, {'C(2,0)': 0.35, 'C(4,0)': -0.2, 'C(6,0)': 0.1, 'C(6,6)': 0.05}),
    ('ceo2', '9009008.cif', 'Bragg-Brentano', 8, {'C(4,1)': 0.3, 'C(6,1)': -0.2, 'C(8,1)': 0.1}),
    ('corundum', '1000032.cif', 'Bragg-Brentano', 6, {'C(2,0)': 0.2, 'C(4,0)': 0.1, 'C(4,3)': 0.15, 'C(6,3)': -0.08, 'C(6,6)': 0.05}),
    ('moo3', '9014282.cif', 'Bragg-Brentano', 4, {'C(2,0)': 0.3, 'C(2,2)': -0.15, 'C(4,0)': 0.1, 'C(4,2)': 0.05, 'C(4,4)': -0.05}),
    ('rutile', '9007531.cif', 'Bragg-Brentano', 4, {'C(2,0)': -0.25, 'C(4,0)': 0.1, 'C(4,4)': 0.08}),
    ('wo3', '2106382.cif', 'Bragg-Brentano', 4, {'C(2,0)': 0.2, 'C(2,2)': 0.1, 'C(2,-2)': -0.1, 'C(4,0)': 0.05, 'C(4,-2)': 0.04}),
]
patterns = []
for name, cif, geometry, order, coefficients in PATTERNS:
    gpx = G.G2Project(newgpx=os.path.join(run, f'{name}.gpx'))
    ph = gpx.add_phase(os.path.join(cifs, cif), phasename=name, fmthint='CIF')
    h = gpx.add_simulated_powder_histogram('sim', inst, 15.0, 120.0, Tstep=0.02, phases=[ph], scale=100.0)
    isotropic_zero(ph)
    h.data['Sample Parameters']['Type'] = geometry
    names = set_sh(ph, order, coefficients, False)
    gpx.data['Controls']['data']['max cyc'] = 0
    gpx.do_refinements([{}])
    sgdata = ph.data['General']['SGData']
    refl = h.reflections()[name]['RefList']
    patterns.append({'name': name, 'cif': cif, 'geometry': geometry, 'laue': sgdata['SGLaue'],
                     'unique': sgdata.get('SGUniq', ''), 'spaceGroup': sgdata['SpGrp'],
                     'cell': ph.get_cell(), 'order': order, 'names': names,
                     'coefficients': {n: coefficients.get(n, 0.0) for n in names},
                     'reflections': [[int(r[0]), int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[5]),
                                      float(r[12])] for r in refl]})

# 4. Simulation with texture, refined in GSAS-II.
TRUTH = {'order': 4, 'C(2,0)': 0.45, 'C(4,0)': -0.2}
gpx = G.G2Project(newgpx=os.path.join(run, 'sim.gpx'))
ph = gpx.add_phase(os.path.join(cifs, '1577381.cif'), phasename='zno', fmthint='CIF')
h = gpx.add_simulated_powder_histogram('sim', inst, 20.0, 130.0, Tstep=0.02, phases=[ph], scale=400.0)
isotropic_zero(ph)
set_sh(ph, 4, TRUTH, False)
h.data['Background'][0] = ['chebyschev-1', True, 3, 200.0, -40.0, 10.0]
gpx.data['Controls']['data']['max cyc'] = 0
gpx.do_refinements([{}])
cell_true = ph.get_cell()
x = np.array(h.getdata('x'))
ycalc = np.array(h.getdata('ycalc'))
y = np.random.default_rng(43).poisson(ycalc).astype(float)
np.savetxt(os.path.join(out, 'zno-texture.xy'), np.c_[x, y], fmt='%.4f %.0f')
np.savetxt(os.path.join(run, 'zno-texture.xy'), np.c_[x, y], fmt='%.4f %.0f')
reflections = [[int(r[0]), int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[9]), float(r[12])]
               for r in h.reflections()['zno']['RefList']]

gpx = G.G2Project(newgpx=os.path.join(run, 'refine.gpx'))
h = gpx.add_powder_histogram(os.path.join(run, 'zno-texture.xy'), inst, fmthint='xye')
ph = gpx.add_phase(os.path.join(cifs, '1577381.cif'), phasename='zno', fmthint='CIF', histograms=[h])
isotropic_zero(ph)
set_sh(ph, 4, {}, False)
h.data['Background'][0] = ['chebyschev-1', True, 6, 100.0, 0, 0, 0, 0, 0]
gpx.data['Controls']['data']['max cyc'] = 30
gpx.do_refinements([
    {'set': {'Background': {'no. coeffs': 6, 'refine': True}, 'Sample Parameters': ['Scale']}},
    {'set': {'Cell': True}},
])
hap_of(ph)['Pref.Ori.'][2] = True
gpx.do_refinements([{}, {}])
cov = gpx['Covariance']['data']
esd = dict(zip(cov['varyList'], [float(s) for s in cov['sig']]))
ip0 = {k.split(':')[0]: float(k.split(':')[1]) for k in open(inst).read().split()
       if ':' in k and k.split(':')[1].replace('.', '').replace('-', '').isdigit()}
po = hap_of(ph)['Pref.Ori.']
result = {
    'source': 'GSAS-II (github.com/AdvancedPhotonSource/GSAS-II) commit ' + os.environ.get('GSAS2_COMMIT', 'unknown'),
    'cif': '1577381.cif',
    'wavelengths': {'kAlpha1': ip0['Lam1'], 'kAlpha2': ip0['Lam2'], 'ratio': ip0['I(L2)/I(L1)']},
    'instrument': {k: ip0[k] for k in ('Zero', 'U', 'V', 'W', 'X', 'Y', 'SH/L', 'Polariz.')},
    'plm': plm,
    'functions': functions,
    'ksl': ksl,
    'lnorm': lnorm,
    'patterns': patterns,
    'truth': {**TRUTH, 'cell': cell_true, 'uiso': 0.0, 'anomalousDispersion': False},
    'reflections': reflections,
    'ymax': float(ycalc.max()),
    'gsas2': {
        'Rwp': h.get_wR(),
        'cell': ph.get_cell(),
        'coefficients': dict(po[5]),
        'textureIndex': float(G2lat.textureIndex(po[5])),
        'esd': esd,
    },
    'python': sys.version.split()[0],
    'numpy': np.__version__,
}
json.dump(result, open(os.path.join(out, 'texture.json'), 'w'), indent=1)
print(json.dumps(result['gsas2']))
