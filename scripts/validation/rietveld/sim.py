import sys, json, numpy as np
import GSASII.GSASIIscriptable as G
S, repo = sys.argv[1], sys.argv[2]
gpx = G.G2Project(newgpx=f'{S}/run/sim.gpx')
ana = gpx.add_phase(f'{repo}/scripts/cif-cache/9015929.cif', phasename='anatase', fmthint='CIF')
rut = gpx.add_phase(f'{repo}/scripts/cif-cache/9007531.cif', phasename='rutile', fmthint='CIF')
h = gpx.add_simulated_powder_histogram('sim', f'{S}/cu.instprm', 20., 90., Tstep=0.02, phases=[ana, rut], scale=100.)
# Known truth: shift the anatase cell by +0.3 % (a) and -0.2 % (c), zero 0.04 deg, scales 1.0 and 0.6.
ana.data['General']['Cell'][1] *= 1.003; ana.data['General']['Cell'][2] *= 1.003; ana.data['General']['Cell'][3] *= 0.998
ana.data['General']['Cell'][7] = G.G2lat.calc_V(G.G2lat.cell2A(ana.data['General']['Cell'][1:7]))
h.data['Instrument Parameters'][0]['Zero'][1] = 0.04
ana.setHAPvalues({'Scale': [1.0, False]}, targethistlist=[h]) if hasattr(ana,'setHAPvalues') else None
for ph, sc in ((ana, 1.0), (rut, 0.6)):
    ph.data['Histograms'][h.name]['Scale'][0] = sc
h.data['Background'][0] = ['chebyschev-1', True, 3, 300.0, -50.0, 10.0]
gpx.data['Controls']['data']['max cyc'] = 0
gpx.do_refinements([{}])
x = np.array(h.getdata('x')); ycalc = np.array(h.getdata('ycalc'))
rng = np.random.default_rng(7)
y = rng.poisson(ycalc).astype(float)
np.savetxt(f'{S}/run/mix.xy', np.c_[x, y], fmt='%.4f %.0f')
truth = {}
tot = 0
for ph in (ana, rut):
    g = ph.data['General']; sc = ph.data['Histograms'][h.name]['Scale'][0]
    truth[ph.name] = {'scale': sc, 'mass': g['Mass'], 'cell': g['Cell'][1:8]}
    tot += sc * g['Mass']
for v in truth.values(): v['wt'] = v['scale'] * v['mass'] / tot
truth['zero'] = 0.04
truth['max'] = float(ycalc.max())
json.dump(truth, open(f'{S}/run/truth.json', 'w'), indent=1)
print(json.dumps(truth, indent=1))
