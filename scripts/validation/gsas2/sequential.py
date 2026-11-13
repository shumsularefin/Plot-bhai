"""Sequential refinement check against GSAS-II (run by .github/workflows/validation.yml).

Usage: python -I sequential.py <work dir> <repo dir>
Writes tests/fixtures/validation/sequential.json and zno-series-<k>.xy (k = 0..4) with
  series:     five ZnO (COD 1577381) patterns simulated in GSAS-II, each with a cell expanded from
              the CIF cell by a made-up linear law (a by 6e-6 and c by 4e-6 per step of the series
              value, value = 25, 125, 225, 325, 425), Poisson noise (seed 61 + k);
  one_by_one: each pattern refined on its own in GSAS-II (scale and background, then the cell);
  sequential: the same five patterns refined by GSAS-II's sequential refinement (Controls
              'Seq Data', results copied to the next pattern), with the cell changes refined as
              hydrostatic strain (GSAS-II's way in a sequential fit); its cell and s.u. from
              G2SeqRefRes.get_cell_and_esd, or the error text if it failed;
  lineFits:   numpy.polyfit straight lines (weights 1/s.u.) through the one-by-one a and c.
No anomalous dispersion and U_iso = 0 for every atom (the test computes |F|^2 with the same).
GSAS-II's default size (1 um) and microstrain (1000) broadening stay in the simulation, unrefined.
"""
import json, os, sys
import numpy as np
import GSASII.GSASIIElem as G2el
import GSASII.GSASIIscriptable as G

G2el.FPcalc = lambda orbs, kev: (0.0, 0.0, 0.0)  # no anomalous dispersion, as on the site

work, repo = sys.argv[1], sys.argv[2]
out = os.path.join(repo, 'tests', 'fixtures', 'validation')
run = os.path.join(work, 'sequential')
os.makedirs(out, exist_ok=True)
os.makedirs(run, exist_ok=True)
inst = os.path.join(repo, 'scripts', 'validation', 'rietveld', 'cu.instprm')
cif = os.path.join(repo, 'scripts', 'cif-cache', '1577381.cif')

VALUES = [25.0, 125.0, 225.0, 325.0, 425.0]
EXPANSION = {'a': 6e-6, 'c': 4e-6}  # made-up relative change per unit of the series value


def isotropic_zero(ph):
    cx, ct, cs, cia = ph.data['General']['AtomPtrs']
    for a in ph.data['Atoms']:
        a[cia] = 'I'
        a[cia + 1] = 0.0


def set_cell(ph, a, c):
    cell = ph.data['General']['Cell']
    cell[1], cell[2], cell[3] = a, a, c
    cell[7] = float(np.sqrt(3) / 2 * a * a * c)


# 1. Simulated series.
series = []
for k, value in enumerate(VALUES):
    gpx = G.G2Project(newgpx=os.path.join(run, f'sim{k}.gpx'))
    ph = gpx.add_phase(cif, phasename='zno', fmthint='CIF')
    if k == 0:
        a0, c0 = ph.get_cell()['length_a'], ph.get_cell()['length_c']
    a = a0 * (1 + EXPANSION['a'] * (value - VALUES[0]))
    c = c0 * (1 + EXPANSION['c'] * (value - VALUES[0]))
    set_cell(ph, a, c)
    h = gpx.add_simulated_powder_histogram('sim', inst, 20.0, 130.0, Tstep=0.02, phases=[ph], scale=400.0)
    isotropic_zero(ph)
    h.data['Background'][0] = ['chebyschev-1', True, 3, 200.0, -40.0, 10.0]
    gpx.data['Controls']['data']['max cyc'] = 0
    gpx.do_refinements([{}])
    x = np.array(h.getdata('x'))
    y = np.random.default_rng(61 + k).poisson(np.array(h.getdata('ycalc'))).astype(float)
    name = f'zno-series-{k}.xy'
    np.savetxt(os.path.join(out, name), np.c_[x, y], fmt='%.4f %.0f')
    np.savetxt(os.path.join(run, name), np.c_[x, y], fmt='%.4f %.0f')
    series.append({'file': name, 'value': value, 'cell': ph.get_cell()})

STAGES = [
    {'set': {'Background': {'no. coeffs': 6, 'refine': True}, 'Sample Parameters': ['Scale']}},
]


def new_histogram(gpx, k):
    h = gpx.add_powder_histogram(os.path.join(run, series[k]['file']), inst, fmthint='xye')
    h.data['Background'][0] = ['chebyschev-1', True, 6, 100.0, 0, 0, 0, 0, 0]
    return h


# 2. Each pattern on its own.
one_by_one = []
for k in range(len(VALUES)):
    gpx = G.G2Project(newgpx=os.path.join(run, f'one{k}.gpx'))
    h = new_histogram(gpx, k)
    ph = gpx.add_phase(cif, phasename='zno', fmthint='CIF', histograms=[h])
    isotropic_zero(ph)
    gpx.data['Controls']['data']['max cyc'] = 30
    gpx.do_refinements(STAGES + [{'set': {'Cell': True}}, {}])
    cov = gpx['Covariance']['data']
    esd = dict(zip(cov['varyList'], [float(s) for s in cov['sig']]))
    cell, cell_esd = ph.get_cell_and_esd()
    one_by_one.append({'Rwp': h.get_wR(), 'cell': cell, 'cellEsd': cell_esd, 'esd': esd})

# Weighted straight line through GSAS-II's one-by-one a and c against the series value, by numpy:
# weights 1/s.u., covariance scaled by chi^2/(n-2) (cov=True) and unscaled (cov='unscaled').
line_fits = {}
for key in ('length_a', 'length_c'):
    y = np.array([r['cell'][key] for r in one_by_one])
    s = np.array([r['cellEsd'][key] for r in one_by_one])
    p, cov = np.polyfit(VALUES, y, 1, w=1 / s, cov=True)
    _, cov_u = np.polyfit(VALUES, y, 1, w=1 / s, cov='unscaled')
    line_fits[key] = {'x': VALUES, 'y': y.tolist(), 'sigma': s.tolist(),
                      'slope': float(p[0]), 'intercept': float(p[1]),
                      'slopeSigma': float(np.sqrt(cov[0, 0])), 'interceptSigma': float(np.sqrt(cov[1, 1])),
                      'slopeSigmaUnscaled': float(np.sqrt(cov_u[0, 0])),
                      'interceptSigmaUnscaled': float(np.sqrt(cov_u[1, 1]))}

# 3. GSAS-II's sequential refinement of the same patterns.
try:
    gpx = G.G2Project(newgpx=os.path.join(run, 'seq.gpx'))
    hists = [new_histogram(gpx, k) for k in range(len(VALUES))]
    ph = gpx.add_phase(cif, phasename='zno', fmthint='CIF', histograms=hists)
    isotropic_zero(ph)
    gpx.set_Controls('cycles', 30)
    gpx.set_Controls('sequential', [h.name for h in hists])
    gpx.set_Controls('seqCopy', True)
    # SeqRefine reads Controls['parmFrozen'] before creating it (the GUI creates it beforehand).
    gpx.data['Controls']['data'].setdefault('parmFrozen', {})
    gpx.do_refinements(STAGES)
    ph = gpx.phase('zno')
    ph.set_HAP_refinements({'HStrain': True})
    gpx.set_Controls('seqCopy', True)
    gpx.do_refinements([{}])
    seq = gpx.seqref()
    sequential = []
    for name in seq.histograms():
        cell, cell_esd, unique = seq.get_cell_and_esd('zno', name)
        rvals = seq.RefData(name)[0].get('Rvals', {})
        sequential.append({'histogram': name, 'cell': [float(v) for v in cell],
                           'cellEsd': [float(v) for v in cell_esd], 'unique': list(unique),
                           'Rwp': rvals.get('Rwp')})
except Exception as e:  # recorded so the test can report it; the one-by-one results still stand
    sequential = {'error': repr(e)}

ip0 = {k.split(':')[0]: float(k.split(':')[1]) for k in open(inst).read().split()
       if ':' in k and k.split(':')[1].replace('.', '').replace('-', '').isdigit()}
result = {
    'source': 'GSAS-II (github.com/AdvancedPhotonSource/GSAS-II) commit ' + os.environ.get('GSAS2_COMMIT', 'unknown'),
    'cif': '1577381.cif',
    'wavelengths': {'kAlpha1': ip0['Lam1'], 'kAlpha2': ip0['Lam2'], 'ratio': ip0['I(L2)/I(L1)']},
    'instrument': {k: ip0[k] for k in ('Zero', 'U', 'V', 'W', 'X', 'Y', 'SH/L', 'Polariz.')},
    'expansion': EXPANSION,
    'series': series,
    'oneByOne': one_by_one,
    'sequential': sequential,
    'lineFits': line_fits,
    'python': sys.version.split()[0],
    'numpy': np.__version__,
}
json.dump(result, open(os.path.join(out, 'sequential.json'), 'w'), indent=1)
print(json.dumps({'oneByOne': [r['cell'] for r in one_by_one], 'sequential': sequential}))
