"""Sample-broadening and intensity-correction check against GSAS-II (run by .github/workflows/validation.yml).

Usage: python -I sample.py <work dir> <repo dir>
Simulates a CeO2 pattern (COD 9009008) in GSAS-II, Cu Ka1/Ka2, the TCH widths of cu.instprm with
almost no asymmetry (SH/L = 0.0001), no anomalous dispersion and U_iso = 0 (as this site's stored
reference intensities), and with known
  isotropic crystallite size 0.04 um (40 nm) and microstrain 1200, both all Lorentzian (LGmix 1),
  polarisation coefficient Polariz. = 0.6 (a monochromator),
  Suortti surface roughness SurfRoughA = 0, SurfRoughB = 0.12,
  transparency 2.0 (GSAS-II units; Delta 2theta = -9 * Transparency * sin 2theta / (pi R), degrees).
Then refines the same data in GSAS-II twice with the instrument fixed: a Rietveld refinement of
scale, background, cell, size, microstrain, SurfRoughB and transparency, and a Le Bail fit of
background, cell, size and microstrain. Writes tests/fixtures/validation/ceria-sample.xy
(2theta, counts with Poisson noise, seed 23) and ceria-sample.json (truth, both GSAS-II results).
"""
import json, os, sys
import numpy as np
import GSASII.GSASIIElem as G2el
import GSASII.GSASIIscriptable as G

G2el.FPcalc = lambda orbs, kev: (0.0, 0.0, 0.0)  # no anomalous dispersion, as on the site

work, repo = sys.argv[1], sys.argv[2]
out = os.path.join(repo, 'tests', 'fixtures', 'validation')
run = os.path.join(work, 'sample')
os.makedirs(out, exist_ok=True)
os.makedirs(run, exist_ok=True)
inst = os.path.join(run, 'ceria.instprm')
text = open(os.path.join(repo, 'scripts', 'validation', 'rietveld', 'cu.instprm')).read()
open(inst, 'w').write(text.replace('SH/L:0.002', 'SH/L:0.0001').replace('Polariz.:0.5', 'Polariz.:0.6'))
CIF = os.path.join(repo, 'scripts', 'cif-cache', '9009008.cif')
TRUTH = {'sizeMicrons': 0.04, 'mustrain': 1200.0, 'LGmix': 1.0, 'Polariz.': 0.6,
         'SurfRoughA': 0.0, 'SurfRoughB': 0.12, 'Transparency': 2.0}


def isotropic_zero(ph):
    cx, ct, cs, cia = ph.data['General']['AtomPtrs']
    for a in ph.data['Atoms']:
        a[cia] = 'I'
        a[cia + 1] = 0.0


def set_sample(ph, size, mustrain):
    for hap in ph.data['Histograms'].values():
        hap['Size'][0] = 'isotropic'
        hap['Size'][1][0] = size
        hap['Size'][1][2] = TRUTH['LGmix']
        hap['Mustrain'][0] = 'isotropic'
        hap['Mustrain'][1][0] = mustrain
        hap['Mustrain'][1][2] = TRUTH['LGmix']


# Simulation with the true values.
gpx = G.G2Project(newgpx=os.path.join(run, 'sim.gpx'))
ph = gpx.add_phase(CIF, phasename='ceria', fmthint='CIF')
h = gpx.add_simulated_powder_histogram('sim', inst, 20.0, 130.0, Tstep=0.02, phases=[ph], scale=400.0)
isotropic_zero(ph)
set_sample(ph, TRUTH['sizeMicrons'], TRUTH['mustrain'])
sample = h.data['Sample Parameters']
sample['SurfRoughA'][0] = TRUTH['SurfRoughA']
sample['SurfRoughB'][0] = TRUTH['SurfRoughB']
sample['Transparency'][0] = TRUTH['Transparency']
radius = float(sample['Gonio. radius'])
h.data['Background'][0] = ['chebyschev-1', True, 3, 200.0, -40.0, 10.0]
gpx.data['Controls']['data']['max cyc'] = 0
gpx.do_refinements([{}])
x = np.array(h.getdata('x'))
ycalc = np.array(h.getdata('ycalc'))
y = np.random.default_rng(23).poisson(ycalc).astype(float)
np.savetxt(os.path.join(out, 'ceria-sample.xy'), np.c_[x, y], fmt='%.4f %.0f')
np.savetxt(os.path.join(run, 'ceria-sample.xy'), np.c_[x, y], fmt='%.4f %.0f')
cell_true = ph.get_cell()


def refine(name, le_bail):
    gpx = G.G2Project(newgpx=os.path.join(run, f'{name}.gpx'))
    h = gpx.add_powder_histogram(os.path.join(run, 'ceria-sample.xy'), inst, fmthint='xye')
    ph = gpx.add_phase(CIF, phasename='ceria', fmthint='CIF', histograms=[h])
    isotropic_zero(ph)
    set_sample(ph, 0.1, 500.0)
    h.data['Background'][0] = ['chebyschev-1', True, 6, 100.0, 0, 0, 0, 0, 0]
    if le_bail:
        # GSAS-II builds the reflection list in a zero-cycle calculation; Le Bail needs it first.
        gpx.data['Controls']['data']['max cyc'] = 0
        gpx.do_refinements([{}])
        ph.set_refinements({'LeBail': True})
    gpx.data['Controls']['data']['max cyc'] = 30
    steps = [{'set': {'Background': {'no. coeffs': 6, 'refine': True}}}]
    if not le_bail:
        steps[0]['set']['Sample Parameters'] = ['Scale']
    steps.append({'set': {'Cell': True}})
    steps.append({'set': {'Size': {'type': 'isotropic', 'refine': True},
                          'Mustrain': {'type': 'isotropic', 'refine': True}}})
    if not le_bail:
        steps.append({'set': {'Sample Parameters': ['Transparency', 'SurfRoughB']}})
    steps.append({})
    gpx.do_refinements(steps)
    cov = gpx['Covariance']['data']
    esd = dict(zip(cov['varyList'], [float(s) for s in cov['sig']]))
    hap = list(ph.data['Histograms'].values())[0]
    s = h.data['Sample Parameters']
    return {
        'Rwp': h.get_wR(),
        'cell': ph.get_cell(),
        'sizeMicrons': hap['Size'][1][0],
        'mustrain': hap['Mustrain'][1][0],
        'Transparency': s['Transparency'][0],
        'SurfRoughB': s['SurfRoughB'][0],
        'esd': esd,
    }


ip0 = {k.split(':')[0]: float(k.split(':')[1]) for k in open(inst).read().split()
       if ':' in k and k.split(':')[1].replace('.', '').replace('-', '').isdigit()}
result = {
    'source': 'GSAS-II (github.com/AdvancedPhotonSource/GSAS-II) commit ' + os.environ.get('GSAS2_COMMIT', 'unknown'),
    'cif': '9009008.cif',
    'wavelengths': {'kAlpha1': ip0['Lam1'], 'kAlpha2': ip0['Lam2'], 'ratio': ip0['I(L2)/I(L1)']},
    'instrument': {k: ip0[k] for k in ('Zero', 'U', 'V', 'W', 'X', 'Y', 'SH/L', 'Polariz.')},
    'goniometerRadius': radius,
    'truth': {**TRUTH, 'cell': cell_true, 'uiso': 0.0, 'anomalousDispersion': False},
    'ymax': float(ycalc.max()),
    'gsas2': refine('rietveld', False),
    'gsas2LeBail': refine('lebail', True),
    'python': sys.version.split()[0],
    'numpy': np.__version__,
}
json.dump(result, open(os.path.join(out, 'ceria-sample.json'), 'w'), indent=1)
print(json.dumps(result['gsas2']), json.dumps(result['gsas2LeBail']))
