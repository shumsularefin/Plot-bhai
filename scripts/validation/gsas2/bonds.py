"""Bond lengths, angles, their s.u. and bond-valence sums checked against GSAS-II (run by
.github/workflows/validation.yml).

Usage: python -I bonds.py <work dir> <repo dir>
Writes tests/fixtures/validation/zro2-bonds.xy and zro2-bonds.json with
  truth:     the baddeleyite (monoclinic ZrO2, COD 9007448, P2_1/c, every atom on a general
             position) structure GSAS-II simulated, U_iso(Zr) = 0.006, U_iso(O) = 0.010 A^2, O1 x
             raised by 0.004 (Poisson noise, seed 23);
  gsas2:     GSAS-II's refinement of that pattern (scale, background, cell, zero, U V W X Y, then
             x, y, z and U_iso of every atom): cell, atoms, the covariance of the nine coordinates
             (varyList names 0::dAx:i, dAy, dAz) and of the cell terms A0..A5;
  distances: GSAS-II RetDistAngle (GSASIIstrMain) with the refinement's covariance, bond radii
             Zr 1.4 and O 1.0 A, factor 1 (Zr-O up to 2.4 A, no Zr-Zr or O-O): each distance and
             s.u., and each angle and s.u. (GSAS-II's s.u. use only the coordinate covariance and
             round angle s.u. below 0.01 deg to 0);
  bvsGsas2:  the bond-valence sums GSAS-II prints in PrintDistAngle (R0 from atmdata.BVScoeff,
             b = 0.37), two decimals;
  bvparm:    an independent Python reading of data/reference/source/bvparm2020.cif (first entry of
             each ion pair not marked "unchecked") and the bond-valence sums of every site over
             GSAS-II's distances, with s.u. from GSAS-II's own distance derivatives
             (GSASIImath.getDistDerv) and the coordinate covariance.
No anomalous dispersion (f', f'' set to zero) and negligible sample broadening, as structure.py.
"""
import io, json, os, sys
import numpy as np
import GSASII.GSASIIElem as G2el
import GSASII.GSASIIscriptable as G
import GSASII.GSASIIstrMain as G2strMain
import GSASII.GSASIImath as G2mth
import GSASII.GSASIIlattice as G2lat

G2el.FPcalc = lambda orbs, kev: (0.0, 0.0, 0.0)
SIZE_UM, MUSTRAIN = 1.0e5, 0.0

work, repo = sys.argv[1], sys.argv[2]
out = os.path.join(repo, 'tests', 'fixtures', 'validation')
run = os.path.join(work, 'bonds')
os.makedirs(out, exist_ok=True)
os.makedirs(run, exist_ok=True)
inst = os.path.join(repo, 'scripts', 'validation', 'rietveld', 'cu.instprm')
cif = os.path.join(repo, 'scripts', 'cif-cache', '9007448.cif')


def atoms_of(ph):
    cx, ct, cs, cia = ph.data['General']['AtomPtrs']
    return ph.data['Atoms'], cx, ct, cia


def no_sample_broadening(ph):
    for hap in ph.data['Histograms'].values():
        hap['Size'][1][0] = SIZE_UM
        hap['Mustrain'][1][0] = MUSTRAIN


def describe(ph):
    atoms, cx, ct, cia = atoms_of(ph)
    return [{'label': a[ct - 1], 'element': a[ct], 'x': [float(v) for v in a[cx:cx + 3]],
             'occupancy': float(a[cx + 3]), 'uiso': float(a[cia + 1])} for a in atoms]


# 1. Simulated pattern.
gpx = G.G2Project(newgpx=os.path.join(run, 'sim.gpx'))
ph = gpx.add_phase(cif, phasename='zro2', fmthint='CIF')
h = gpx.add_simulated_powder_histogram('sim', inst, 15.0, 130.0, Tstep=0.02, phases=[ph], scale=400.0)
atoms, cx, ct, cia = atoms_of(ph)
for a in atoms:
    a[cia] = 'I'
    a[cia + 1] = 0.006 if a[ct].startswith('Zr') else 0.010
    if a[ct - 1] == 'O1':
        a[cx] += 0.004
no_sample_broadening(ph)
h.data['Background'][0] = ['chebyschev-1', True, 3, 200.0, -40.0, 10.0]
gpx.data['Controls']['data']['max cyc'] = 0
gpx.do_refinements([{}])
truth = describe(ph)
x = np.array(h.getdata('x'))
y = np.random.default_rng(23).poisson(np.array(h.getdata('ycalc'))).astype(float)
for d in (out, run):
    np.savetxt(os.path.join(d, 'zro2-bonds.xy'), np.c_[x, y], fmt='%.4f %.0f')

# 2. GSAS-II refinement of the simulated data from the unchanged CIF.
gpx = G.G2Project(newgpx=os.path.join(run, 'ref.gpx'))
h = gpx.add_powder_histogram(os.path.join(run, 'zro2-bonds.xy'), inst, fmthint='xye')
ph = gpx.add_phase(cif, phasename='zro2', fmthint='CIF', histograms=[h])
atoms, cx, ct, cia = atoms_of(ph)
for a in atoms:
    a[cia] = 'I'
    a[cia + 1] = 0.01
no_sample_broadening(ph)
h.data['Background'][0] = ['chebyschev-1', True, 6, 100.0, 0, 0, 0, 0, 0]
gpx.data['Controls']['data']['max cyc'] = 30
gpx.do_refinements([
    {'set': {'Background': {'no. coeffs': 6, 'refine': True}, 'Sample Parameters': ['Scale']}},
    {'set': {'Cell': True, 'Instrument Parameters': ['Zero']}},
    {'set': {'Instrument Parameters': ['U', 'V', 'W', 'X', 'Y']}},
    {'set': {'Atoms': {'all': 'XU'}}},
    {},
])
ph = gpx.phase('zro2')
cov = gpx['Covariance']['data']
varyList, covMatrix = cov['varyList'], np.array(cov['covMatrix'])
pId = ph.data['pId']
pfx = f'{pId}::'
n_atoms = len(ph.data['Atoms'])
xyz_names = [f'{pfx}dA{c}:{i}' for i in range(n_atoms) for c in 'xyz']
cell_names = [f'{pfx}A{i}' for i in range(6)]
xyz_cov = G2mth.getVCov(xyz_names, varyList, covMatrix)
cell_cov = G2mth.getVCov(cell_names, varyList, covMatrix)
cell = ph.data['General']['Cell'][1:8]
cell_sig = G2lat.getCellEsd(pfx, ph.data['General']['SGData'], G2lat.cell2A(cell[:6]), cov)

# 3. GSAS-II distances and angles with s.u.
ctls, data = ph.InitDisAgl(useAll=True)
ctls.update({'Name': 'zro2', 'Factors': [1.0, 1.0], 'AtomTypes': ['Zr', 'O'],
             'BondRadii': [1.4, 1.0], 'AngleRadii': [1.4, 1.0]})
data['Cell'] = cell
data['covData'] = cov
data['pId'] = pId
labels, dist_array, ang_array = G2strMain.RetDistAngle(ctls, data)
distances = []
for origin, entries in dist_array.items():
    for k, (target, unit, top, d, sig) in enumerate(entries):
        distances.append({'from': labels[origin], 'to': labels[target], 'unit': [int(v) for v in unit],
                          'op': int(top), 'distance': float(d), 'su': float(sig), 'index': k})
angles = []
for origin, entries in ang_array.items():
    dist = dist_array[origin]
    for i, j, (value, sig) in entries:
        angles.append({'at': labels[origin],
                       'first': {'to': labels[dist[i][0]], 'distance': float(dist[i][3])},
                       'second': {'to': labels[dist[j][0]], 'distance': float(dist[j][3])},
                       'angle': float(value), 'su': float(sig)})

# GSAS-II's own bond-valence sums, as PrintDistAngle prints them.
text = io.StringIO()
G2strMain.PrintDistAngle(ctls, data, text)
bvs_gsas2 = {}
current = None
for line in text.getvalue().splitlines():
    if 'Distances & angles for' in line:
        current = line.split('for')[1].split()[0]
    if 'Bond Valence sums for:' in line and current:
        tokens = line.replace('Bond Valence sums for:', '').split()
        bvs_gsas2[current] = {tokens[k].rstrip(':'): float(tokens[k + 1]) for k in range(0, len(tokens) - 1, 2)}

# 4. Independent reading of bvparm2020.cif and bond-valence sums with s.u.
table = {}
in_params = False
for line in open(os.path.join(repo, 'data', 'reference', 'source', 'bvparm2020.cif'), encoding='utf-8'):
    if line.strip() == '_valence_param_details':
        in_params = True
        continue
    if not in_params or line.startswith('#'):
        continue
    t = line.split()
    if len(t) < 8 or ' '.join(t[7:]) == 'unchecked':
        continue
    table.setdefault((t[0], int(t[1]), t[2], int(t[3])), (float(t[4]), float(t[5]), t[6]))
states = {'Zr': 4, 'O': -2}
orig = {rec[0]: rec for rec in data['OrigAtoms']}
targ = {rec[0]: rec for rec in data['TargAtoms']}
bvparm = {}
for origin, entries in dist_array.items():
    el = orig[origin][2]
    total, grad = 0.0, np.zeros(3 * n_atoms)
    used = set()
    for target, unit, top, d, sig in entries:
        other = targ[target][2]
        if np.sign(states[el]) == np.sign(states[other]):
            continue
        cation, anion = (el, other) if states[el] > 0 else (other, el)
        r0, b, ref = table[(cation, states[cation], anion, states[anion])]
        s = np.exp((r0 - d) / b)
        total += s
        used.add(ref)
        # GSAS-II's numerical d(distance)/d(origin xyz, target xyz), as in RetDistAngle.
        amat = G2lat.cell2AB(cell[:6])[0]
        pdpx = G2mth.getDistDerv(list(orig[origin][3:6]), list(targ[target][3:6]), amat, unit, top,
                                 data['SGData'])
        # The derivative must belong to this distance: rebuild it the way getDistDerv does.
        M, T = data['SGData']['SGOps'][abs(top) % 100 - 1]
        C = data['SGData']['SGCen'][abs(top) // 100]
        image = np.sign(top) * (M @ np.array(targ[target][3:6]) + T) + C + np.array(unit)
        assert abs(np.linalg.norm(amat @ (image - np.array(orig[origin][3:6]))) - d) < 1e-6, (origin, target)
        grad[3 * origin:3 * origin + 3] += -s / b * pdpx[:3]
        grad[3 * target:3 * target + 3] += -s / b * pdpx[3:]
    bvparm[labels[origin]] = {'state': states[el], 'sum': float(total),
                              'su': float(np.sqrt(grad @ xyz_cov @ grad)), 'refs': sorted(used)}

result = {
    'source': 'GSAS-II (github.com/AdvancedPhotonSource/GSAS-II) commit ' + os.environ.get('GSAS2_COMMIT', 'unknown'),
    'cif': '9007448.cif',
    'truth': truth,
    'gsas2': {
        'Rwp': h.get_wR(),
        'cell': [float(v) for v in cell],
        'cellSu': [float(v) for v in cell_sig],
        'atoms': describe(ph),
        'xyzNames': xyz_names,
        'xyzCovariance': xyz_cov.tolist(),
        'cellNames': cell_names,
        'cellCovariance': cell_cov.tolist(),
    },
    'controls': {k: ctls[k] for k in ('Factors', 'AtomTypes', 'BondRadii', 'AngleRadii')},
    'distances': distances,
    'angles': angles,
    'bvsGsas2': bvs_gsas2,
    'bvparm': bvparm,
    'python': sys.version.split()[0],
    'numpy': np.__version__,
}
json.dump(result, open(os.path.join(out, 'zro2-bonds.json'), 'w'), indent=1)
print(json.dumps({'Rwp': result['gsas2']['Rwp'], 'bvsGsas2': bvs_gsas2, 'bvparm': bvparm,
                  'distances': len(distances), 'angles': len(angles)}))
