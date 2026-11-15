"""Independent readings of the real binary instrument files in tests/fixtures-real/spectra, read
by tests/spectrum-files-independent.test.ts.

Each file is read with every independent reader that handles its format, none of which shares code
with this site:

  SpectroChemPy (CeCILL-B)      read_omnic (.spa), read_opus (OPUS), read_spc (Galactic .spc)
  brukeropusreader (GPL-3.0)    read_file (OPUS)
  spc-io (MIT)                  SPC.from_bytes_io (Galactic .spc)
  specio (BSD-3-Clause)         specread (PerkinElmer .sp, Galactic .spc)

A reader that fails (an API change, a format it does not support) is recorded with its error
instead of stopping the run, so the JSON says which comparisons were made. x values are written
in the order the reader gives them; the test sorts both sides before comparing.

specio 0.1.0 imports collections.Iterable, which Python 3.10 removed, so the workflow runs it in a
Python 3.9 venv of its own, as a second run with --add (which adds its readings to the JSON the
first run wrote).

Run:  python -I scripts/validation/spectra/instrument_files.py tests/fixtures-real/spectra tests/fixtures/validation [--only specio] [--add]
"""

import hashlib
import json
import sys
import traceback
from importlib import metadata
from pathlib import Path

import numpy as np

folder, out = Path(sys.argv[1]), Path(sys.argv[2])
only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
add = '--add' in sys.argv


def rows(x, ys):
    x = np.asarray(x, dtype=float).ravel()
    ys = [np.asarray(y, dtype=float).ravel() for y in ys]
    return {'x': x.tolist(), 'y': [y.tolist() for y in ys]}


def spectrochempy(path, kind):
    import spectrochempy as scp

    if kind == 'opus':
        # The final spectrum (AB) named explicitly: SpectroChemPy returns None, with only a
        # logged warning, when it cannot choose the data type itself.
        d = scp.read_opus(str(path), type='AB')
    else:
        d = {'spa': scp.read_omnic, 'spc': scp.read_spc}[kind](str(path))
    if d is None:
        raise RuntimeError('the reader returned no dataset (its warning is in the workflow log)')
    data = np.atleast_2d(np.asarray(d.data, dtype=float))
    return rows(d.x.data, list(data)) | {'yTitle': str(d.title), 'yUnits': str(d.units)}


def brukeropus(path, _kind):
    from brukeropusreader import read_file

    opus = read_file(str(path))
    x = opus.get_range('AB')
    y = np.asarray(opus['AB'], dtype=float)[: len(x)]
    return rows(x, [y])


def spcio(path, _kind):
    from spc_io import SPC

    with open(path, 'rb') as f:
        spc = SPC.from_bytes_io(f)
    subfiles = list(spc)
    return rows(subfiles[0].xarray, [sub.yarray for sub in subfiles])


def specio(path, _kind):
    from specio import specread

    s = specread(str(path))
    amplitudes = np.atleast_2d(np.asarray(s.amplitudes, dtype=float))
    return rows(s.wavelength, list(amplitudes))


READERS = {
    'spa': [('spectrochempy', spectrochempy)],
    'opus': [('spectrochempy', spectrochempy), ('brukeropusreader', brukeropus)],
    'sp': [('specio', specio)],
    'spc': [('spectrochempy', spectrochempy), ('spc-io', spcio), ('specio', specio)],
}
FILES = {
    'omnic_sample1.spa': 'spa',
    'opus_peach_juice.0': 'opus',
    'perkinelmer_transmittance.sp': 'sp',
    'perkinelmer_absorbance.sp': 'sp',
    'galactic_Ft-ir.spc': 'spc',
    'galactic_s_evenx.spc': 'spc',
    'galactic_nir.spc': 'spc',
}
PACKAGES = {'spectrochempy': 'spectrochempy', 'brukeropusreader': 'brukeropusreader',
            'spc-io': 'spc-io', 'specio': 'specio'}


def version(package):
    try:
        return metadata.version(package)
    except metadata.PackageNotFoundError:
        return None


target = out / 'instrument-files-reference.json'
result = (json.loads(target.read_text()) if add else
          {'readers': {}, 'files': {}})
for name, p in PACKAGES.items():
    if only is None or name in only:
        result['readers'][name] = version(p)
for name, kind in FILES.items():
    path = folder / name
    entry = result['files'].get(name) if add else None
    entry = entry or {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'readings': {}}
    for reader, function in READERS[kind]:
        if only is not None and reader not in only:
            continue
        try:
            entry['readings'][reader] = function(path, kind)
        except Exception as error:  # recorded, not fatal: see the docstring
            entry['readings'][reader] = {'error': f'{type(error).__name__}: {error}',
                                         'trace': traceback.format_exc(limit=3)}
    result['files'][name] = entry
    print(name, {r: ('ok' if 'x' in v else v['error'][:80]) for r, v in entry['readings'].items()})

target.write_text(json.dumps(result) + '\n')
