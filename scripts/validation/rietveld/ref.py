import sys, json
import GSASII.GSASIIscriptable as G
S, repo = sys.argv[1], sys.argv[2]
gpx = G.G2Project(newgpx=f'{S}/run/ref.gpx')
h = gpx.add_powder_histogram(f'{S}/run/mix.xy', f'{S}/cu.instprm', fmthint='xye')
ana = gpx.add_phase(f'{repo}/scripts/cif-cache/9015929.cif', phasename='anatase', fmthint='CIF', histograms=[h])
rut = gpx.add_phase(f'{repo}/scripts/cif-cache/9007531.cif', phasename='rutile', fmthint='CIF', histograms=[h])
h.data['Background'][0] = ['chebyschev-1', True, 6, 100.0, 0, 0, 0, 0, 0]
gpx.data['Controls']['data']['max cyc'] = 20
rut.set_HAP_refinements({'Scale': True}, [h])
gpx.do_refinements([
  {'set': {'Background': {'no. coeffs': 6, 'refine': True}}},
  {'set': {'Instrument Parameters': ['Zero']}},
  {'set': {'Cell': True}},
  {'set': {'Instrument Parameters': ['U', 'V', 'W', 'X', 'Y', 'SH/L']}},
  {},
])
out = {'Rwp': h.get_wR()}
for ph in (ana, rut):
    out[ph.name] = {'cell': ph.get_cell()}
lst = open(f'{S}/run/ref.lst').read()
out['wt_lines'] = [l.strip() for l in lst.splitlines() if 'Weight fraction' in l][-2:]
out['zero'] = h.data['Instrument Parameters'][0]['Zero'][1]
print(json.dumps(out, indent=1))
