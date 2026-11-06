"""Structure-refinement and TCH-profile check against GSAS-II (run by .github/workflows/validation.yml).

Usage: python -I structure.py <work dir> <repo dir>
Simulates two Cu Ka1/Ka2 patterns in GSAS-II with known answers and refines each in GSAS-II too:
  anatase-tch:  COD 9015929, Thompson-Cox-Hastings widths U, V, W, X, Y of cu.instprm, almost no
                asymmetry (SH/L = 0.0001), O z raised by 0.003, U_iso(Ti) = 0.006, U_iso(O) = 0.012 A^2.
  rutile-aniso: COD 9007531, the same instrument, O x raised by 0.002, anisotropic U_ij allowed by
                the site symmetry (U11 = U22, U33, U12; U13 = U23 = 0).
Each writes tests/fixtures/validation/<case>.xy (2theta, counts with Poisson noise, seed 11) and
<case>.json (truth, GSAS-II refinement with esd, versions).
"""
import json, os, subprocess, sys
import numpy as np
import GSASII.GSASIIscriptable as G

work, repo = sys.argv[1], sys.argv[2]
out = os.path.join(repo, 'tests', 'fixtures', 'validation')
os.makedirs(out, exist_ok=True)
os.makedirs(os.path.join(work, 'run'), exist_ok=True)
inst = os.path.join(work, 'tch.instprm')
text = open(os.path.join(repo, 'scripts', 'validation', 'rietveld', 'cu.instprm')).read()
open(inst, 'w').write(text.replace('SH/L:0.002', 'SH/L:0.0001'))
gsas_commit = os.environ.get('GSAS2_COMMIT', 'unknown')


def atoms_of(ph):
    cx, ct, cs, cia = ph.data['General']['AtomPtrs']
    return ph.data['Atoms'], cx, ct, cia


def describe(ph):
    atoms, cx, ct, cia = atoms_of(ph)
    return [{'label': a[ct - 1], 'element': a[ct], 'x': a[cx:cx + 3], 'occupancy': a[cx + 3],
             'type': a[cia], 'uiso': a[cia + 1], 'uij': a[cia + 2:cia + 8]} for a in atoms]


def simulate(case, cif, change):
    gpx = G.G2Project(newgpx=os.path.join(work, 'run', f'{case}-sim.gpx'))
    ph = gpx.add_phase(os.path.join(repo, 'scripts', 'cif-cache', cif), phasename=case, fmthint='CIF')
    h = gpx.add_simulated_powder_histogram('sim', inst, 20.0, 130.0, Tstep=0.02, phases=[ph], scale=400.0)
    change(ph)
    h.data['Background'][0] = ['chebyschev-1', True, 3, 200.0, -40.0, 10.0]
    gpx.data['Controls']['data']['max cyc'] = 0
    gpx.do_refinements([{}])
    x = np.array(h.getdata('x'))
    ycalc = np.array(h.getdata('ycalc'))
    y = np.random.default_rng(11).poisson(ycalc).astype(float)
    np.savetxt(os.path.join(out, f'{case}.xy'), np.c_[x, y], fmt='%.4f %.0f')
    np.savetxt(os.path.join(work, 'run', f'{case}.xy'), np.c_[x, y], fmt='%.4f %.0f')
    return describe(ph), float(ycalc.max())


def refine(case, cif, aniso):
    gpx = G.G2Project(newgpx=os.path.join(work, 'run', f'{case}-ref.gpx'))
    h = gpx.add_powder_histogram(os.path.join(work, 'run', f'{case}.xy'), inst, fmthint='xye')
    ph = gpx.add_phase(os.path.join(repo, 'scripts', 'cif-cache', cif), phasename=case, fmthint='CIF', histograms=[h])
    atoms, cx, ct, cia = atoms_of(ph)
    for a in atoms:
        if aniso and a[cia] != 'A':
            u = a[cia + 1]
            a[cia] = 'A'
            a[cia + 2:cia + 8] = [u, u, u, 0.0, 0.0, 0.0]
    h.data['Background'][0] = ['chebyschev-1', True, 6, 100.0, 0, 0, 0, 0, 0]
    gpx.data['Controls']['data']['max cyc'] = 30
    gpx.do_refinements([
        {'set': {'Background': {'no. coeffs': 6, 'refine': True}, 'Sample Parameters': ['Scale']}},
        {'set': {'Cell': True, 'Instrument Parameters': ['Zero']}},
        {'set': {'Instrument Parameters': ['U', 'V', 'W', 'X', 'Y']}},
        {'set': {'Atoms': {'all': 'XU'}}},
        {},
    ])
    cov = gpx['Covariance']['data']
    esd = dict(zip(cov['varyList'], [float(s) for s in cov['sig']]))
    ip = h.data['Instrument Parameters'][0]
    return {
        'Rwp': h.get_wR(),
        'cell': ph.get_cell(),
        'instrument': {k: ip[k][1] for k in ('Zero', 'U', 'V', 'W', 'X', 'Y')},
        'atoms': describe(ph),
        'esd': esd,
    }


def anatase(ph):
    atoms, cx, ct, cia = atoms_of(ph)
    for a in atoms:
        a[cia] = 'I'
        a[cia + 1] = 0.006 if a[ct].startswith('Ti') else 0.012
        if a[ct].startswith('O'):
            a[cx + 2] += 0.003


def rutile(ph):
    atoms, cx, ct, cia = atoms_of(ph)
    for a in atoms:
        a[cia] = 'A'
        if a[ct].startswith('Ti'):
            a[cia + 2:cia + 8] = [0.0060, 0.0060, 0.0040, 0.0010, 0.0, 0.0]
        else:
            a[cia + 2:cia + 8] = [0.0080, 0.0080, 0.0055, -0.0025, 0.0, 0.0]
            a[cx] += 0.002
            a[cx + 1] += 0.002  # 4f (x, x, 0): x and y move together


ip0 = {k.split(':')[0]: float(k.split(':')[1]) for k in open(inst).read().split() if ':' in k and k.split(':')[1].replace('.', '').replace('-', '').isdigit()}
for case, cif, change, aniso in (('anatase-tch', '9015929.cif', anatase, False), ('rutile-aniso', '9007531.cif', rutile, True)):
    truth, ymax = simulate(case, cif, change)
    result = {
        'source': 'GSAS-II (github.com/AdvancedPhotonSource/GSAS-II) commit ' + gsas_commit,
        'cif': cif,
        'wavelengths': {'kAlpha1': ip0['Lam1'], 'kAlpha2': ip0['Lam2'], 'ratio': ip0['I(L2)/I(L1)']},
        'instrument': {k: ip0[k] for k in ('Zero', 'U', 'V', 'W', 'X', 'Y', 'SH/L', 'Polariz.')},
        'truth': truth,
        'ymax': ymax,
        'gsas2': refine(case, cif, aniso),
        'python': sys.version.split()[0],
        'numpy': np.__version__,
    }
    json.dump(result, open(os.path.join(out, f'{case}.json'), 'w'), indent=1)
    print(case, json.dumps(result['gsas2']['instrument']), result['gsas2']['Rwp'])
