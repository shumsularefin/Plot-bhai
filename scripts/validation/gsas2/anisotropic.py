"""Axial divergence and anisotropic broadening check against GSAS-II (run by .github/workflows/validation.yml).

Usage: python -I anisotropic.py <work dir> <repo dir>
Writes tests/fixtures/validation/zno-anisotropic.json with
  fcj:          GSAS-II's Finger-Cox-Jephcoat profile (GSASIIpwd.getFCJVoigt3, the Fortran PSVFCJO)
                on a grid of 2theta for several positions, Gaussian variances, Lorentzian widths and
                SH/L values, so the profile function itself can be compared point by point;
  coefficients: GSASIIspc.MustrainNames and MustrainCoeff (the Stephens terms) for every Laue class
                and a few h k l;
  widths:       GSAS-II's per-reflection Gaussian variance and Lorentzian width (reflection list
                columns 6 and 7) of ZnO (COD 1577381) for uniaxial size, uniaxial microstrain and
                generalized microstrain, from zero-cycle calculations;
  simulation and gsas2: a ZnO pattern simulated in GSAS-II with SH/L = 0.03, uniaxial crystallite
                size along [001] and generalized (Stephens) microstrain, with Poisson noise (seed 41),
                refined in GSAS-II with U, V, W, X, Y fixed (scale, background, cell, SH/L, size,
                microstrain). The pattern goes to zno-anisotropic.xy.
No anomalous dispersion and U_iso = 0, as this site's stored reference intensities.
"""
import json, os, sys
import numpy as np
import GSASII.GSASIIElem as G2el
import GSASII.GSASIIpwd as G2pwd
import GSASII.GSASIIspc as G2spc
import GSASII.GSASIIscriptable as G

G2el.FPcalc = lambda orbs, kev: (0.0, 0.0, 0.0)  # no anomalous dispersion, as on the site

work, repo = sys.argv[1], sys.argv[2]
out = os.path.join(repo, 'tests', 'fixtures', 'validation')
run = os.path.join(work, 'anisotropic')
os.makedirs(out, exist_ok=True)
os.makedirs(run, exist_ok=True)
base = open(os.path.join(repo, 'scripts', 'validation', 'rietveld', 'cu.instprm')).read()
CIF = os.path.join(repo, 'scripts', 'cif-cache', '1577381.cif')


def instprm(shl):
    path = os.path.join(run, f'shl-{shl}.instprm')
    open(path, 'w').write(base.replace('SH/L:0.002', f'SH/L:{shl}'))
    return path


# 1. The FCJ profile function on its own.
fcj = []
for pos in (8.0, 30.0, 80.0, 140.0):
    for shl in (0.005, 0.03):
        for sig, gam in ((2.0, 1.0), (20.0, 8.0), (5.0, 0.0)):
            x = np.arange(pos - 1.0, pos + 1.0 + 1e-9, 0.005)
            y = G2pwd.getFCJVoigt3(pos, sig, gam, shl, x)[0]
            fcj.append({'pos': pos, 'sig': sig, 'gam': gam, 'shl': shl, 'x0': float(x[0]),
                        'step': 0.005, 'y': [float(v) for v in y]})

# 2. Stephens coefficients for every Laue class.
HKLS = [(1, 2, 3), (2, -1, 4), (3, 1, -2), (0, 0, 2), (1, 1, 0)]
coefficients = []
for laue, uniq in (('m3m', ''), ('6/mmm', ''), ('3m1', ''), ('31m', ''), ('3R', ''), ('4/mmm', ''),
                   ('mmm', ''), ('2/m', 'a'), ('2/m', 'b'), ('2/m', 'c'), ('-1', '')):
    sg = {'SGLaue': laue, 'SGUniq': uniq}
    coefficients.append({'laue': laue, 'unique': uniq, 'names': G2spc.MustrainNames(sg),
                         'values': [[float(v) for v in G2spc.MustrainCoeff(h, sg)] for h in HKLS]})


def isotropic_zero(ph):
    cx, ct, cs, cia = ph.data['General']['AtomPtrs']
    for a in ph.data['Atoms']:
        a[cia] = 'I'
        a[cia + 1] = 0.0


def hap_of(ph):
    return list(ph.data['Histograms'].values())[0]


def stephens(cell, mu_a, mu_c, mu_ac):
    """Shkl (S400, S004, S202) that give microstrain mu_a in the plane, mu_c along c (GSAS-II units)."""
    a, c = cell['length_a'], cell['length_c']
    return [16 * mu_a ** 2 / (9 * a ** 4), mu_c ** 2 / c ** 4, 8 * mu_ac ** 2 / (9 * a ** 2 * c ** 2)]


# 3. Per-reflection widths for each model (zero cycles, SH/L of cu.instprm).
inst = instprm(0.002)
widths = []
cases = [
    {'name': 'uniaxial',
     'size': ['uniaxial', [0.05, 0.12, 0.6], [1, 0, 0]],
     'mustrain': ['uniaxial', [800.0, 2500.0, 0.3], [1, 0, 2]]},
    {'name': 'generalized',
     'size': ['isotropic', [0.08, 0.08, 0.8], [0, 0, 1]],
     'mustrain': ['generalized', None, [0, 0, 1], 0.5]},
]
for case in cases:
    gpx = G.G2Project(newgpx=os.path.join(run, f"widths-{case['name']}.gpx"))
    ph = gpx.add_phase(CIF, phasename='zno', fmthint='CIF')
    h = gpx.add_simulated_powder_histogram('sim', inst, 20.0, 130.0, Tstep=0.02, phases=[ph], scale=400.0)
    isotropic_zero(ph)
    hap = hap_of(ph)
    hap['Size'][0] = case['size'][0]
    hap['Size'][1] = list(case['size'][1])
    hap['Size'][3] = case['size'][2]
    m = case['mustrain']
    hap['Mustrain'][0] = m[0]
    hap['Mustrain'][3] = m[2]
    if m[0] == 'generalized':
        shkl = stephens(ph.get_cell(), 900.0, 1800.0, 1200.0)
        hap['Mustrain'][4] = shkl
        hap['Mustrain'][5] = [False] * len(shkl)
        hap['Mustrain'][1][2] = m[3]
        case['mustrain'] = ['generalized', shkl, m[2], m[3]]
    else:
        hap['Mustrain'][1] = list(m[1])
    gpx.data['Controls']['data']['max cyc'] = 0
    gpx.do_refinements([{}])
    refl = h.reflections()['zno']['RefList']
    widths.append({**case, 'cell': ph.get_cell(),
                   'reflections': [[int(r[0]), int(r[1]), int(r[2]), float(r[4]), float(r[5]),
                                    float(r[6]), float(r[7])] for r in refl]})

# 4. Simulation with SH/L, uniaxial size and generalized microstrain, refined in GSAS-II.
SHL = 0.03
TRUTH = {'SH/L': SHL, 'Size;i': 0.05, 'Size;a': 0.12, 'axis': [0, 0, 1]}
inst = instprm(SHL)
gpx = G.G2Project(newgpx=os.path.join(run, 'sim.gpx'))
ph = gpx.add_phase(CIF, phasename='zno', fmthint='CIF')
h = gpx.add_simulated_powder_histogram('sim', inst, 20.0, 130.0, Tstep=0.02, phases=[ph], scale=400.0)
isotropic_zero(ph)
cell_true = ph.get_cell()
TRUTH['Shkl'] = stephens(cell_true, 1000.0, 2000.0, 1500.0)
hap = hap_of(ph)
hap['Size'][0] = 'uniaxial'
hap['Size'][1] = [TRUTH['Size;i'], TRUTH['Size;a'], 1.0]
hap['Size'][3] = TRUTH['axis']
hap['Mustrain'][0] = 'generalized'
hap['Mustrain'][1][2] = 1.0
hap['Mustrain'][4] = list(TRUTH['Shkl'])
h.data['Background'][0] = ['chebyschev-1', True, 3, 200.0, -40.0, 10.0]
gpx.data['Controls']['data']['max cyc'] = 0
gpx.do_refinements([{}])
x = np.array(h.getdata('x'))
ycalc = np.array(h.getdata('ycalc'))
y = np.random.default_rng(41).poisson(ycalc).astype(float)
np.savetxt(os.path.join(out, 'zno-anisotropic.xy'), np.c_[x, y], fmt='%.4f %.0f')
np.savetxt(os.path.join(run, 'zno-anisotropic.xy'), np.c_[x, y], fmt='%.4f %.0f')
reflections = [[int(r[0]), int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[9])]
               for r in h.reflections()['zno']['RefList']]

START = {'SH/L': 0.01, 'size': 0.1, 'Shkl': stephens(cell_true, 1000.0, 1000.0, 1000.0)}
inst_start = instprm(START['SH/L'])
gpx = G.G2Project(newgpx=os.path.join(run, 'refine.gpx'))
h = gpx.add_powder_histogram(os.path.join(run, 'zno-anisotropic.xy'), inst_start, fmthint='xye')
ph = gpx.add_phase(CIF, phasename='zno', fmthint='CIF', histograms=[h])
isotropic_zero(ph)
hap = hap_of(ph)
hap['Size'][0] = 'uniaxial'
hap['Size'][1] = [START['size'], START['size'], 1.0]
hap['Size'][3] = TRUTH['axis']
hap['Mustrain'][0] = 'generalized'
hap['Mustrain'][1][2] = 1.0
hap['Mustrain'][4] = list(START['Shkl'])
h.data['Background'][0] = ['chebyschev-1', True, 6, 100.0, 0, 0, 0, 0, 0]
gpx.data['Controls']['data']['max cyc'] = 30
gpx.do_refinements([
    {'set': {'Background': {'no. coeffs': 6, 'refine': True}, 'Sample Parameters': ['Scale']}},
    {'set': {'Cell': True}},
    {'set': {'Size': {'type': 'uniaxial', 'refine': True},
             'Mustrain': {'type': 'generalized', 'refine': True}}},
    {'set': {'Instrument Parameters': ['SH/L']}},
    {},
])
cov = gpx['Covariance']['data']
esd = dict(zip(cov['varyList'], [float(s) for s in cov['sig']]))
hap = hap_of(ph)
ip0 = {k.split(':')[0]: float(k.split(':')[1]) for k in open(inst).read().split()
       if ':' in k and k.split(':')[1].replace('.', '').replace('-', '').isdigit()}
result = {
    'source': 'GSAS-II (github.com/AdvancedPhotonSource/GSAS-II) commit ' + os.environ.get('GSAS2_COMMIT', 'unknown'),
    'cif': '1577381.cif',
    'wavelengths': {'kAlpha1': ip0['Lam1'], 'kAlpha2': ip0['Lam2'], 'ratio': ip0['I(L2)/I(L1)']},
    'instrument': {k: ip0[k] for k in ('Zero', 'U', 'V', 'W', 'X', 'Y', 'Polariz.')},
    'fcj': fcj,
    'hkls': HKLS,
    'coefficients': coefficients,
    'widths': widths,
    'truth': {**TRUTH, 'cell': cell_true, 'uiso': 0.0, 'anomalousDispersion': False},
    'start': START,
    'reflections': reflections,
    'ymax': float(ycalc.max()),
    'gsas2': {
        'Rwp': h.get_wR(),
        'cell': ph.get_cell(),
        'SH/L': h.data['Instrument Parameters'][0]['SH/L'][1],
        'Size;i': hap['Size'][1][0],
        'Size;a': hap['Size'][1][1],
        'Shkl': list(hap['Mustrain'][4]),
        'esd': esd,
    },
    'python': sys.version.split()[0],
    'numpy': np.__version__,
}
json.dump(result, open(os.path.join(out, 'zno-anisotropic.json'), 'w'), indent=1)
print(json.dumps(result['gsas2']))
