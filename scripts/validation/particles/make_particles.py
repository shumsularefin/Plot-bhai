"""Independent references for the Particles tool, read by tests/validation-particles.test.ts.

Writes to the directory given as the first argument (tests/fixtures/validation):

  particles.pgm          a 192 x 160, 8-bit test image: 14 bright ellipses of known size and
                         angle on a dark, noisy background (numpy, seeded; 4 x 4 supersampled
                         edges, Gaussian noise). ImageJ (ImageJCheck.java) reads the same file.
  particles-skimage.json scikit-image and SciPy/NumPy results:
      thresholds   skimage.filters threshold_otsu, _li, _isodata, _mean, _minimum, _triangle on
                   the image
      regions      skimage.measure.label (8-connected) and regionprops of image > 127: area,
                   centroid, equivalent diameter, the eigenvalues of the inertia tensor
      sizes        a seeded lognormal sample of 300 diameters with numpy.percentile (linear),
                   numpy.histogram_bin_edges ('sturges', 'fd') and numpy.histogram,
                   scipy.stats.norm.fit and scipy.stats.lognorm.fit(floc=0) with their
                   log-likelihoods

Definitions that differ between programs are recorded in docs/validation.md (section
"Particles"); the test compares only like with like.

Run (numpy, scipy, scikit-image installed):
    python3 -I scripts/validation/particles/make_particles.py tests/fixtures/validation
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
import scipy
import skimage
from scipy import stats
from skimage import filters, measure

out = Path(sys.argv[1])
rng = np.random.default_rng(20261114)

WIDTH, HEIGHT = 192, 160
SUPER = 4
BACKGROUND, FOREGROUND, NOISE = 52.0, 188.0, 11.0

# Ellipses: centre x, y (px), full axes a >= b (px), angle (degrees, counter-clockwise from +x,
# y up). Spaced so that none touches another or the edge.
ELLIPSES = [
    (22, 20, 22, 14, 0),
    (62, 22, 18, 18, 0),
    (104, 20, 26, 10, 30),
    (150, 24, 20, 12, 90),
    (176, 60, 12, 8, 45),
    (24, 62, 30, 16, 120),
    (70, 64, 14, 14, 0),
    (118, 64, 34, 18, 160),
    (28, 108, 16, 9, 75),
    (72, 106, 24, 20, 10),
    (120, 112, 20, 7, 135),
    (164, 108, 22, 22, 0),
    (40, 142, 26, 12, 15),
    (110, 144, 18, 11, 100),
]

ys, xs = np.mgrid[0 : HEIGHT * SUPER, 0 : WIDTH * SUPER]
px = (xs + 0.5) / SUPER
py = (ys + 0.5) / SUPER
inside = np.zeros(px.shape, dtype=bool)
for cx, cy, a, b, angle in ELLIPSES:
    t = math.radians(angle)
    dx, dy = px - cx, -(py - cy)  # y up for the angle
    u = dx * math.cos(t) + dy * math.sin(t)
    v = -dx * math.sin(t) + dy * math.cos(t)
    inside |= (u / (a / 2)) ** 2 + (v / (b / 2)) ** 2 <= 1
cover = inside.reshape(HEIGHT, SUPER, WIDTH, SUPER).mean(axis=(1, 3))
image = BACKGROUND + (FOREGROUND - BACKGROUND) * cover + rng.normal(0, NOISE, cover.shape)
image = np.clip(np.rint(image), 1, 254).astype(np.uint8)

with open(out / 'particles.pgm', 'wb') as f:
    f.write(f'P5\n{WIDTH} {HEIGHT}\n255\n'.encode('ascii'))
    f.write(image.tobytes())

thresholds = {
    'otsu': int(filters.threshold_otsu(image)),
    'li': float(filters.threshold_li(image)),
    'isodata': int(filters.threshold_isodata(image)),
    'mean': float(filters.threshold_mean(image)),
    'minimum': int(filters.threshold_minimum(image)),
    'triangle': int(filters.threshold_triangle(image)),
}

LEVEL = 127
labels = measure.label(image > LEVEL, connectivity=2)
regions = []
for r in measure.regionprops(labels):
    cy, cx = r.centroid
    l1, l2 = r.inertia_tensor_eigvals
    regions.append(
        {
            'area': int(r.area),
            # Pixel centres are at integer coordinates in scikit-image; +0.5 moves them to this
            # site's convention (pixel corners at integers).
            'cx': float(cx + 0.5),
            'cy': float(cy + 0.5),
            'eqDiameter': float(r.equivalent_diameter_area),
            'inertiaEigenvalues': [float(l1), float(l2)],
        }
    )

sizes = np.round(rng.lognormal(mean=math.log(42.0), sigma=0.28, size=300), 3)
s = np.sort(sizes)
mu_n, sd_n = stats.norm.fit(s)
shape, loc, scale = stats.lognorm.fit(s, floc=0)
edges = {}
for rule in ('sturges', 'fd'):
    e = np.histogram_bin_edges(s, bins=rule)
    counts, _ = np.histogram(s, bins=e)
    edges[rule] = {'bins': len(e) - 1, 'counts': counts.tolist(), 'binWidth': float(e[1] - e[0])}

result = {
    'source': (
        f'numpy {np.__version__}, scipy {scipy.__version__}, scikit-image {skimage.__version__}; '
        'scripts/validation/particles/make_particles.py'
    ),
    'image': {'file': 'particles.pgm', 'width': WIDTH, 'height': HEIGHT, 'ellipses': ELLIPSES},
    'thresholds': thresholds,
    'regionsLevel': LEVEL,
    'regions': regions,
    'sizes': {
        'values': s.tolist(),
        'percentiles': {str(p): float(np.percentile(s, p)) for p in (10, 25, 50, 75, 90)},
        'mean': float(np.mean(s)),
        'sd': float(np.std(s, ddof=1)),
        'histogram': edges,
        'normal': {
            'mean': float(mu_n),
            'sigma': float(sd_n),
            'logLikelihood': float(np.sum(stats.norm.logpdf(s, mu_n, sd_n))),
        },
        'lognormal': {
            'mu': float(math.log(scale)),
            'sigma': float(shape),
            'logLikelihood': float(np.sum(stats.lognorm.logpdf(s, shape, 0, scale))),
        },
    },
}
(out / 'particles-skimage.json').write_text(json.dumps(result, indent=1) + '\n')
print('thresholds', thresholds, 'regions', len(regions))
