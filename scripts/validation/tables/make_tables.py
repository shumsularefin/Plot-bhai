"""Independent copies of two tabulated data sets, for tests/validation-tables.test.ts.

Covalent radii: the `periodictable` package (Cordero et al. 2008, its own transcription) and the
`mendeleev` package (covalent_radius_cordero, in pm). Wavelengths: K-L3 and K-L2 line energies
from `xraylib`, converted with hc = 12.398419843 keV Å.

Run by hand (the packages are on PyPI):
    pip install periodictable mendeleev xraylib
    python3 -I scripts/validation/tables/make_tables.py > tests/fixtures/validation/tables.json
"""

import json
from importlib.metadata import version

import periodictable
import xraylib
from mendeleev import element

HC_KEV_ANGSTROM = 12.398419843320026
ANODES = {"Cu": 29, "Co": 27, "Cr": 24, "Fe": 26, "Mo": 42, "Ag": 47}

radii = {}
for el in periodictable.elements:
    if el.number == 0 or getattr(el, "covalent_radius", None) is None:
        continue
    cordero = element(el.symbol).covalent_radius_cordero
    radii[el.symbol] = {
        "periodictable": el.covalent_radius,
        "mendeleev": None if cordero is None else round(cordero / 100, 4),
    }

wavelengths = {
    symbol: {
        "kAlpha1": HC_KEV_ANGSTROM / xraylib.LineEnergy(z, xraylib.KL3_LINE),
        "kAlpha2": HC_KEV_ANGSTROM / xraylib.LineEnergy(z, xraylib.KL2_LINE),
    }
    for symbol, z in ANODES.items()
}

print(
    json.dumps(
        {
            "versions": {p: version(p) for p in ("periodictable", "mendeleev", "xraylib")},
            "radii": radii,
            "wavelengths": wavelengths,
        },
        indent=1,
    )
)
