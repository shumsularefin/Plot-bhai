"""Anomalous dispersion and capillary absorption from GSAS-II (run by .github/workflows/validation.yml).

Usage: python -I dispersion.py <work dir> <repo dir>
Writes
  data/reference/anomalous-dispersion.json: the table the site uses. f' and f'' (electrons) of every
      element of data/reference/scattering-factors.json at the K-alpha1 wavelength of every anode of
      src/core/xrd/radiation.ts, from GSAS-II's Cromer-Liberman routine (GSASIIElem.FPcalc with the
      orbital cross sections of GSASIIElem.GetXsectionCoeff, Xsect.dat), at E = 12.397639 / lambda keV
      (GSASIImath.wavekE). GSAS-II evaluates f' and f'' at the K-alpha1 energy for both lines
      (GSASIIstrIO.GetFprime with keV from Lam1), so the table has one energy per anode.
  tests/fixtures/validation/dispersion.json:
    henke:      f1 - Z and f2 of a few elements from the Henke tables (B. L. Henke, E. M. Gullikson and
                J. C. Davis, At. Data Nucl. Data Tables 54 (1993) 181-342; files served by CXRO at
                henke.lbl.gov/optical_constants/sf/<el>.nff), interpolated linearly in log E to the
                Cu and Mo K-alpha1 energies: an independent calculation of the same quantities.
    structure:  GSAS-II's |F|^2 (reflection list column 9, powder average of F(h) and F(-h)) with f'
                and f'' on, for ZnS wurtzite (COD 1100044, non-centrosymmetric P6_3mc) and CoFe2O4
                (COD 1533163, Fe and Co close to their K edges for Cu radiation), U_iso = 0.
    absorb:     GSASIIpwd.Absorb('Cylinder', muR, 2theta) on a grid of muR and 2theta.
    capillary:  a CoFe2O4 pattern simulated in GSAS-II (Cu K-alpha1 only) in Debye-Scherrer geometry with muR = 1.5,
                DisplaceX = 30 um and DisplaceY = -20 um, f' and f'' on, Poisson noise (seed 23),
                refined in GSAS-II (scale, background, cell, absorption, DisplaceX, DisplaceY). The
                pattern goes to cofe2o4-capillary.xy; the reflection positions of the simulation are
                kept so the displacement terms can be compared directly.
"""
import json, math, os, re, sys, urllib.request
import numpy as np
import GSASII.GSASIIElem as G2el
import GSASII.GSASIIpwd as G2pwd
import GSASII.GSASIIscriptable as G

KEV_ANGSTROM = 12.397639  # GSASIImath.wavekE

work, repo = sys.argv[1], sys.argv[2]
out = os.path.join(repo, 'tests', 'fixtures', 'validation')
run = os.path.join(work, 'dispersion')
os.makedirs(out, exist_ok=True)
os.makedirs(run, exist_ok=True)
commit = os.environ.get('GSAS2_COMMIT', 'unknown')
inst = os.path.join(repo, 'scripts', 'validation', 'rietveld', 'cu.instprm')


def cif(code):
    """A copy of the cached CIF with neutral atom types (Zn2+ -> Zn, Fe+3 -> Fe): both CIFs give
    oxidation states, and GSAS-II would then use ionic form factors where the site uses neutral ones."""
    text = open(os.path.join(repo, 'scripts', 'cif-cache', f'{code}.cif')).read()
    neutral = re.sub(r'(?<=\s)([A-Z][a-z]?)(?:\d?[+-]\d?)(?=\s)', r'\1', text)
    path = os.path.join(run, f'{code}-neutral.cif')
    open(path, 'w').write(neutral)
    return path


# 1. The table.
radiation = open(os.path.join(repo, 'src', 'core', 'xrd', 'radiation.ts')).read()
anodes = {m[0]: float(m[1]) for m in re.findall(r"^\s*(\w\w?): \{ kAlpha1: ([0-9.]+),", radiation, re.M)}
elements = list(json.load(open(os.path.join(repo, 'data', 'reference', 'scattering-factors.json')))['factors'])
table = {}
missing = []
for anode, lam in anodes.items():
    kev = KEV_ANGSTROM / lam
    values = {}
    for el in elements:
        orbs = G2el.GetXsectionCoeff(el)
        if not orbs:
            missing.append(el)
            continue
        fp, fpp, _mu = G2el.FPcalc(orbs, kev)
        values[el] = [round(float(fp), 4), round(float(fpp), 4)]
    table[anode] = {'wavelength': lam, 'keV': round(kev, 6), 'values': values}
json.dump({
    'source': 'Cromer-Liberman f\' and f\'\' (D. T. Cromer and D. A. Liberman, J. Chem. Phys. 53 (1970) '
              '1891-1898; Acta Cryst. A37 (1981) 267-268) as computed by GSAS-II '
              '(github.com/AdvancedPhotonSource/GSAS-II, GSASIIElem.FPcalc with GetXsectionCoeff) '
              f'at commit {commit}, by scripts/validation/gsas2/dispersion.py in the Validation workflow.',
    'energy': 'E (keV) = 12.397639 / lambda (angstrom), lambda the K-alpha1 wavelength of src/core/xrd/radiation.ts',
    'units': 'electrons; each value is [f\', f\'\']',
    'missing': sorted(set(missing)),
    'anodes': table,
}, open(os.path.join(repo, 'data', 'reference', 'anomalous-dispersion.json'), 'w'), indent=1)

# 2. Henke cross-check.
henke = []
for el in ('O', 'Fe', 'Co', 'Cu', 'Zn', 'Ce'):
    url = f'https://henke.lbl.gov/optical_constants/sf/{el.lower()}.nff'
    rows = [line.split() for line in urllib.request.urlopen(url, timeout=60).read().decode().splitlines()[1:]]
    rows = [[float(v) for v in r] for r in rows if len(r) == 3]
    for anode in ('Cu', 'Mo'):
        ev = 1000 * KEV_ANGSTROM / anodes[anode]
        j = next(i for i, r in enumerate(rows) if r[0] > ev)
        (e0, a0, b0), (e1, a1, b1) = rows[j - 1], rows[j]
        t = (math.log(ev) - math.log(e0)) / (math.log(e1) - math.log(e0))
        z = elements.index(el) + 1
        henke.append({'element': el, 'anode': anode, 'eV': ev, 'url': url,
                      'neighbours': [rows[j - 1], rows[j]],
                      'fp': a0 + t * (a1 - a0) - z, 'fpp': b0 + t * (b1 - b0)})


def isotropic_zero(ph):
    cx, ct, cs, cia = ph.data['General']['AtomPtrs']
    for a in ph.data['Atoms']:
        a[cia] = 'I'
        a[cia + 1] = 0.0


def no_sample_broadening(ph):
    for hap in ph.data['Histograms'].values():
        hap['Size'][1][0] = 1.0e5
        hap['Mustrain'][1][0] = 0.0


# 3. |F|^2 with f' and f'' on.
structure = []
for name, code in (('zns', 1100044), ('cofe2o4', 1533163)):
    gpx = G.G2Project(newgpx=os.path.join(run, f'{name}-f2.gpx'))
    ph = gpx.add_phase(cif(code), phasename=name, fmthint='CIF')
    h = gpx.add_simulated_powder_histogram('sim', inst, 15.0, 140.0, Tstep=0.05, phases=[ph], scale=1.0)
    isotropic_zero(ph)
    gpx.data['Controls']['data']['max cyc'] = 0
    gpx.do_refinements([{}])
    refl = h.reflections()[name]['RefList']
    structure.append({'name': name, 'cif': f'{code}.cif', 'cell': ph.get_cell(),
                      'reflections': [[int(r[0]), int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[9])]
                                      for r in refl]})

# 4. Absorb('Cylinder') on a grid.
MUR = [0.0, 0.25, 0.5, 1.0, 2.0, 2.9, 3.0, 3.1, 4.0, 6.0, 10.0]
TTH = [5.0, 20.0, 45.0, 90.0, 120.0, 150.0, 175.0]
absorb = {'muR': MUR, 'twoTheta': TTH,
          'values': [[float(G2pwd.Absorb('Cylinder', m, t)) for t in TTH] for m in MUR]}

# 5. Capillary simulation and refinement, with Cu K-alpha1 only: GSAS-II places K-alpha2 by a first-
# order step from the shifted K-alpha1 position, 2theta2 = 2theta1 + (360/pi)(dlambda/lambda1) tan theta1
# (GSASIIstrMath, lamRatio), where the site uses the exact Bragg angle of K-alpha2; with one line the
# comparison tests the capillary terms alone.
ka1 = os.path.join(run, 'cu-ka1.instprm')
lines = [l for l in open(inst).read().splitlines() if not l.startswith(('Lam2:', 'I(L2)/I(L1):'))]
open(ka1, 'w').write('\n'.join(l.replace('Lam1:', 'Lam:') for l in lines) + '\n')
TRUTH = {'Absorption': 1.5, 'DisplaceX': 30.0, 'DisplaceY': -20.0}


def debye(h, mur, dx, dy, refine):
    s = h.data['Sample Parameters']
    s['Type'] = 'Debye-Scherrer'
    s['Absorption'] = [mur, refine]
    s['DisplaceX'] = [dx, refine]
    s['DisplaceY'] = [dy, refine]
    return s


gpx = G.G2Project(newgpx=os.path.join(run, 'cap-sim.gpx'))
ph = gpx.add_phase(cif(1533163), phasename='cofe2o4', fmthint='CIF')
h = gpx.add_simulated_powder_histogram('sim', ka1, 15.0, 130.0, Tstep=0.02, phases=[ph], scale=2000.0)
isotropic_zero(ph)
no_sample_broadening(ph)
sample = debye(h, TRUTH['Absorption'], TRUTH['DisplaceX'], TRUTH['DisplaceY'], False)
h.data['Background'][0] = ['chebyschev-1', True, 3, 200.0, -40.0, 10.0]
gpx.data['Controls']['data']['max cyc'] = 0
gpx.do_refinements([{}])
x = np.array(h.getdata('x'))
ycalc = np.array(h.getdata('ycalc'))
y = np.random.default_rng(23).poisson(ycalc).astype(float)
np.savetxt(os.path.join(out, 'cofe2o4-capillary.xy'), np.c_[x, y], fmt='%.4f %.0f')
np.savetxt(os.path.join(run, 'cofe2o4-capillary.xy'), np.c_[x, y], fmt='%.4f %.0f')
cell_true = ph.get_cell()
radius = float(sample['Gonio. radius'])
sim_reflections = [[int(r[0]), int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[5]), float(r[9])]
                   for r in h.reflections()['cofe2o4']['RefList']]

START = {'Absorption': 0.5, 'DisplaceX': 0.0, 'DisplaceY': 0.0}
gpx = G.G2Project(newgpx=os.path.join(run, 'cap-ref.gpx'))
h = gpx.add_powder_histogram(os.path.join(run, 'cofe2o4-capillary.xy'), ka1, fmthint='xye')
ph = gpx.add_phase(cif(1533163), phasename='cofe2o4', fmthint='CIF', histograms=[h])
isotropic_zero(ph)
no_sample_broadening(ph)
debye(h, START['Absorption'], START['DisplaceX'], START['DisplaceY'], False)
h.data['Sample Parameters']['Gonio. radius'] = radius
h.data['Background'][0] = ['chebyschev-1', True, 6, 100.0, 0, 0, 0, 0, 0]
gpx.data['Controls']['data']['max cyc'] = 30
gpx.do_refinements([
    {'set': {'Background': {'no. coeffs': 6, 'refine': True}, 'Sample Parameters': ['Scale']}},
    {'set': {'Cell': True, 'Sample Parameters': ['DisplaceX', 'DisplaceY']}},
    {'set': {'Sample Parameters': ['Absorption']}},
    {},
])
cov = gpx['Covariance']['data']
esd = dict(zip(cov['varyList'], [float(s) for s in cov['sig']]))
s = h.data['Sample Parameters']

json.dump({
    'source': f'GSAS-II (github.com/AdvancedPhotonSource/GSAS-II) commit {commit}',
    'henke': henke,
    'structure': structure,
    'absorb': absorb,
    'capillary': {
        'cif': '1533163.cif',
        'goniometerRadius': radius,
        'truth': {**TRUTH, 'cell': cell_true, 'uiso': 0.0, 'anomalousDispersion': True},
        'start': START,
        'reflections': sim_reflections,
        'ymax': float(ycalc.max()),
        'gsas2': {'Rwp': h.get_wR(), 'cell': ph.get_cell(), 'Absorption': s['Absorption'][0],
                  'DisplaceX': s['DisplaceX'][0], 'DisplaceY': s['DisplaceY'][0], 'esd': esd},
    },
    'python': sys.version.split()[0],
    'numpy': np.__version__,
}, open(os.path.join(out, 'dispersion.json'), 'w'), indent=1)
print(json.dumps({'missing': sorted(set(missing)), 'capillary': {'Rwp': h.get_wR(), 'Absorption': s['Absorption'][0]}}))
