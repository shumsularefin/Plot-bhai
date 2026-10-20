# Writes synthetic parser fixtures. Every file holds the same made-up curve:
# 2θ = 20.00 to 25.00 step 0.02 (251 points), I = round(100 + 1000·exp(-4 ln2 (2θ-22.5)²/0.1²)).
# So the maximum is 1100 at 22.50 and both ends are 100.
import math, os, sys
out = sys.argv[1]
xs = [round(20 + 0.02 * i, 2) for i in range(251)]
ys = [round(100 + 1000 * math.exp(-4 * math.log(2) * (x - 22.5) ** 2 / 0.01)) for x in xs]
def w(name, text, enc='utf-8', newline='\n'):
    with open(os.path.join(out, name), 'w', encoding=enc, newline=newline) as f: f.write(text)
NOTE = 'Synthetic test fixture, not a measurement'
rows = lambda fmt: ''.join(fmt(x, y) + '\n' for x, y in zip(xs, ys))
w('basic.xy', f'# {NOTE}\n# 2theta intensity\n' + rows(lambda x, y: f'{x:.2f} {y}'))
w('with-sigma.xye', f'# {NOTE}\n' + rows(lambda x, y: f'{x:.4f}  {y:.1f}  {math.sqrt(y):.3f}'))
w('header-row.csv', '2Theta,Intensity\n' + rows(lambda x, y: f'{x:.2f},{y}'), newline='\r\n')
w('decimal-comma.csv', f'{NOTE}\n2Theta;Intensity (cps)\n' + rows(lambda x, y: f'{x:.2f};{y / 2:.1f}'.replace('.', ',')))
w('tab-separated.txt', f'{NOTE}\nSample: test\nScan: 20-25\n\n2Theta\tCounts\n' + rows(lambda x, y: f'{x:.2f}\t{y}'))
w('four-columns.dat', f'; {NOTE}\n; angle counts background fit\n' + rows(lambda x, y: f'{x:.2f} {y} 100 {y}'))
w('decreasing.xy', ''.join(f'{x:.2f} {y}\n' for x, y in reversed(list(zip(xs, ys)))))
bad = list(zip(xs, ys)); bad.insert(150, (21.0, 100))
w('goes-backwards.xy', ''.join(f'{x:.2f} {y}\n' for x, y in bad))
w('radians.xy', rows(lambda x, y: f'{math.radians(x):.6f} {y}'))
w('one-column.txt', ''.join(f'{y}\n' for y in ys))
w('point-number.csv', ''.join(f'{i},{y}\n' for i, y in enumerate(ys)))
w('too-few.xy', '20.0 100\n20.1 120\n20.2 110\n')
w('constant.xy', ''.join(f'{x:.2f} 50\n' for x in xs))
w('cps-decimals.xy', rows(lambda x, y: f'{x:.2f} {y / 3:.3f}'))

ints = ' '.join(str(y) for y in ys)
w('start-end.xrdml', f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- {NOTE}. Layout follows the XRDML elements read by xrayutilities and GSAS-II. -->
<xrdMeasurements xmlns="http://www.xrdml.com/XRDMeasurement/1.5" status="Completed">
  <xrdMeasurement measurementType="Scan" status="Completed">
    <usedWavelength intended="K-Alpha 1">
      <kAlpha1 unit="Angstrom">1.5406</kAlpha1>
    </usedWavelength>
    <scan appendNumber="0" mode="Continuous" scanAxis="Gonio" status="Completed">
      <dataPoints>
        <positions axis="2Theta" unit="deg">
          <startPosition>20.00</startPosition>
          <endPosition>25.00</endPosition>
        </positions>
        <positions axis="Omega" unit="deg">
          <startPosition>10.00</startPosition>
          <endPosition>12.50</endPosition>
        </positions>
        <commonCountingTime unit="seconds">0.5</commonCountingTime>
        <intensities unit="counts">{ints}</intensities>
      </dataPoints>
    </scan>
  </xrdMeasurement>
</xrdMeasurements>
''')
halves = ' '.join(str(y / 2 if y % 2 == 0 else y) for y in ys)
factors = ' '.join('2' if y % 2 == 0 else '1' for y in ys)
w('list-counts.xrdml', f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- {NOTE}. Older layout: listPositions and counts with attenuation factors. -->
<xrdMeasurements xmlns="http://www.xrdml.com/XRDMeasurement/1.0">
  <xrdMeasurement measurementType="Scan" status="Completed">
    <scan scanAxis="Gonio" status="Completed">
      <dataPoints>
        <positions axis="2Theta" unit="deg"><listPositions>{' '.join(f'{x:.2f}' for x in xs)}</listPositions></positions>
        <commonCountingTime unit="seconds">1</commonCountingTime>
        <beamAttenuationFactors>{factors}</beamAttenuationFactors>
        <counts unit="counts">{halves}</counts>
      </dataPoints>
    </scan>
    <scan scanAxis="Gonio" status="Completed">
      <dataPoints>
        <positions axis="2Theta" unit="deg"><startPosition>30</startPosition><endPosition>31</endPosition></positions>
        <counts unit="counts">1 2 3 4 5 6 7 8 9 10 11</counts>
      </dataPoints>
    </scan>
  </xrdMeasurement>
</xrdMeasurements>
''')
w('rocking-curve.xrdml', f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- {NOTE}. -->
<xrdMeasurements xmlns="http://www.xrdml.com/XRDMeasurement/1.5">
  <xrdMeasurement measurementType="Scan" status="Completed">
    <scan scanAxis="Omega" status="Completed">
      <dataPoints>
        <positions axis="2Theta" unit="deg"><commonPosition>34.4</commonPosition></positions>
        <positions axis="Omega" unit="deg"><startPosition>16</startPosition><endPosition>18</endPosition></positions>
        <intensities unit="counts">{ints}</intensities>
      </dataPoints>
    </scan>
  </xrdMeasurement>
</xrdMeasurements>
''')
def ras_block(pairs, att='1.0000'):
    head = ['*RAS_HEADER_START', f'*FILE_COMMENT "{NOTE}"', '*MEAS_SCAN_AXIS_X_INTERNAL "TwoThetaTheta"',
            f'*MEAS_DATA_COUNT "{len(pairs)}"', '*MEAS_SCAN_START "20.0000"', '*MEAS_SCAN_STEP "0.0200"', '*RAS_HEADER_END',
            '*RAS_INT_START']
    data = [f'{x:.4f} {y:.4f} {att}' for x, y in pairs]
    return head + data + ['*RAS_INT_END']
pairs = list(zip(xs, ys))
w('single.ras', '\r\n'.join(['*RAS_DATA_START'] + ras_block(pairs) + ['*RAS_DATA_END']) + '\r\n', enc='latin-1')
w('two-scans.ras', '\r\n'.join(['*RAS_DATA_START'] + ras_block(pairs, att='2.0000') + ras_block(pairs[:20]) + ['*RAS_DATA_END']) + '\r\n', enc='latin-1')
open(os.path.join(out, 'README.md'), 'w').write('''# Parser fixtures

Synthetic files written by `make_fixtures.py` (run `python3 make_fixtures.py .` here), not measurements. Unless noted, each holds the same
made-up curve: 2θ = 20.00° to 25.00° in 0.02° steps (251 points) and
I = round(100 + 1000 · exp(−4 ln 2 · (2θ − 22.5)² / 0.1²)), so the maximum is 1100 at 22.50° and
both ends are 100. The XRDML and RAS files follow the element and keyword layout read by the
open-source readers in xrayutilities and GSAS-II; they are not copies of instrument files.
''')
