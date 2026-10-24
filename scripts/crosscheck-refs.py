"""Independent check of data/reference/*.json against pymatgen.

For every phase in the library this recomputes the powder pattern with pymatgen's
XRDCalculator from the same cached CIF (Cu Ka1, the wavelength used by the library) and
compares the 10 strongest lines of the library with pymatgen's:
  - 2theta must agree within 0.01 degrees,
  - relative intensity (strongest line = 100) must agree within 5 points.

Lines closer than 0.005 degrees 2theta are summed in both patterns before comparing, because
the two programs may or may not list such near-coincident reflections separately.
Displacement parameters are passed to pymatgen as one mean B per element
(B = 8 pi^2 U, U = Uiso or the mean of U11, U22, U33), the only form XRDCalculator accepts.

The same lines are also compared with a second, independent calculation written here (kinematic
model, same Lorentz-polarisation factor) that uses the Waasmaier-Kirfel scattering factors from
the xraydb package (Waasmaier and Kirfel, Acta Cryst. A51 (1995) 416). The library uses the
International Tables Vol. C (1992) factors and pymatgen uses a third parametrisation, so the
two columns show how much the choice of scattering-factor table matters. The exit status is
decided by the Waasmaier-Kirfel comparison; the pymatgen columns are reported for information.

Usage:  python scripts/crosscheck-refs.py        (pip install pymatgen xraydb)
Prints a Markdown table and exits with status 1 if any phase fails the Waasmaier-Kirfel check.
"""

import json
import math
import sys
import warnings
from pathlib import Path

import numpy as np
import xraydb

from pymatgen.analysis.diffraction.xrd import XRDCalculator
from pymatgen.io.cif import CifParser

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "data" / "reference"
CACHE = ROOT / "scripts" / "cif-cache"
TOP = 10
TOL_2THETA = 0.01
TOL_INTENSITY = 5.0
MERGE = 0.005
D_MIN = 0.8
warnings.filterwarnings("ignore")


def number(text):
    """CIF number without its standard uncertainty."""
    return float(str(text).split("(")[0])


def element(symbol):
    letters = "".join(c for c in symbol if c.isalpha())
    return letters[:2].capitalize() if len(letters) > 1 and letters[1].islower() else letters[:1].upper()


def mean_b_per_element(cif_path):
    """One B (square angstrom) per element from the CIF's displacement parameters, or None."""
    data = CifParser(str(cif_path)).as_dict()
    block = next(iter(data.values()))
    labels = block.get("_atom_site_label") or []
    types = block.get("_atom_site_type_symbol") or labels
    u_iso = block.get("_atom_site_U_iso_or_equiv")
    b_iso = block.get("_atom_site_B_iso_or_equiv")
    aniso_labels = block.get("_atom_site_aniso_label") or []
    aniso = {}
    for i, label in enumerate(aniso_labels):
        try:
            u = [number(block[f"_atom_site_aniso_U_{k}"][i]) for k in ("11", "22", "33")]
            aniso[label] = sum(u) / 3
        except (KeyError, ValueError):
            try:
                b = [number(block[f"_atom_site_aniso_B_{k}"][i]) for k in ("11", "22", "33")]
                aniso[label] = sum(b) / 3 / (8 * math.pi**2)
            except (KeyError, ValueError):
                pass
    values = {}
    for i, label in enumerate(labels):
        if label in aniso:
            u = aniso[label]
        elif u_iso and u_iso[i] not in ("?", "."):
            u = number(u_iso[i])
        elif b_iso and b_iso[i] not in ("?", "."):
            u = number(b_iso[i]) / (8 * math.pi**2)
        else:
            continue
        values.setdefault(element(types[i]), []).append(u)
    return {el: 8 * math.pi**2 * sum(v) / len(v) for el, v in values.items()}


def merged(pairs):
    """Sum intensities of lines closer than MERGE degrees; rescale to a maximum of 100."""
    out = []
    for two_theta, intensity in sorted(pairs):
        if out and two_theta - out[-1][0] < MERGE:
            total = out[-1][1] + intensity
            out[-1] = ((out[-1][0] * out[-1][1] + two_theta * intensity) / total, total)
        else:
            out.append((two_theta, intensity))
    top = max(i for _, i in out)
    return [(t, 100 * i / top) for t, i in out]


def waasmaier_kirfel_pattern(structure, wavelength, b_per_element):
    """Kinematic powder lines (2theta, intensity) with Waasmaier-Kirfel scattering factors.

    I ~ |F|^2 * (1 + cos^2 2theta) / (sin^2 theta cos theta), summed over every (h, k, l) of the
    sphere, so no multiplicity is needed. B = 8 pi^2 U per element, as in the pymatgen check.
    """
    lattice = structure.lattice
    reciprocal = lattice.reciprocal_lattice_crystallographic.matrix
    limit = 1 / D_MIN  # |g| = 1/d
    reach = [int(math.ceil(limit * length)) for length in lattice.abc]
    h, k, l = np.meshgrid(*[np.arange(-r, r + 1) for r in reach], indexing="ij")
    hkl = np.stack([h.ravel(), k.ravel(), l.ravel()], axis=1)
    hkl = hkl[np.any(hkl != 0, axis=1)]
    g = np.linalg.norm(hkl @ reciprocal, axis=1)
    keep = (g <= limit) & (wavelength * g / 2 < 1)
    hkl, g = hkl[keep], g[keep]
    q = g / 2  # sin(theta) / lambda
    theta = np.arcsin(wavelength * q)
    structure_factor = np.zeros(len(q), dtype=complex)
    for site in structure:
        phase = np.exp(2j * np.pi * (hkl @ site.frac_coords))
        for species, occupancy in site.species.items():
            symbol = species.symbol
            f = xraydb.f0(symbol, q) * np.exp(-b_per_element.get(symbol, 0.0) * q**2)
            structure_factor += occupancy * f * phase
    lorentz_polarisation = (1 + np.cos(2 * theta) ** 2) / (np.sin(theta) ** 2 * np.cos(theta))
    intensity = np.abs(structure_factor) ** 2 * lorentz_polarisation
    keep = intensity > 1e-9 * intensity.max()
    return merged(list(zip(2 * np.degrees(theta[keep]), intensity[keep])))


def compare(mine, theirs):
    """Largest 2theta and intensity difference over the TOP strongest lines of `mine`."""
    worst_angle = worst_intensity = 0.0
    for angle, intensity in sorted(mine, key=lambda p: -p[1])[:TOP]:
        other = min(theirs, key=lambda q: abs(q[0] - angle))
        worst_angle = max(worst_angle, abs(other[0] - angle))
        worst_intensity = max(worst_intensity, abs(other[1] - intensity))
    return worst_angle, worst_intensity, worst_angle <= TOL_2THETA and worst_intensity <= TOL_INTENSITY


def main():
    index = json.loads((LIB / "index.json").read_text())
    wavelength = index["intensityWavelength"]
    rows = []
    failed = False
    for family in index["families"]:
        for phase in json.loads((LIB / family["file"]).read_text())["phases"]:
            cif = CACHE / f"{phase['codId']}.cif"
            structure = CifParser(str(cif)).parse_structures(primitive=False)[0]
            calculator = XRDCalculator(wavelength=wavelength, debye_waller_factors=mean_b_per_element(cif))
            # Same d-range as the library (d >= 0.8 angstrom), so both patterns are scaled to the same line.
            limit = 2 * math.degrees(math.asin(wavelength / (2 * D_MIN))) + 1e-6
            expected = calculator.get_pattern(structure, scaled=True, two_theta_range=(0, limit))
            theirs = merged(list(zip(expected.x, expected.y)))
            mine = merged(
                [
                    (2 * math.degrees(math.asin(wavelength / (2 * p["d"]))), p["i"])
                    for p in phase["peaks"]
                    if wavelength / (2 * p["d"]) < 1
                ]
            )
            angle, intensity, ok_pm = compare(mine, theirs)
            b_values = mean_b_per_element(cif)
            wk = merged(list(waasmaier_kirfel_pattern(structure, wavelength, b_values)))
            angle_wk, intensity_wk, ok = compare(mine, wk)
            failed |= not ok
            rows.append((phase["id"], phase["codId"], angle, intensity, ok_pm, angle_wk, intensity_wk, ok))
    print("| Phase | COD ID | pymatgen: largest 2θ diff (°) | pymatgen: largest intensity diff (points) | pymatgen | Waasmaier-Kirfel: 2θ diff (°) | Waasmaier-Kirfel: intensity diff (points) | Waasmaier-Kirfel |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for name, cod, angle, intensity, ok_pm, angle_wk, intensity_wk, ok in rows:
        print(
            f"| {name} | {cod} | {angle:.4f} | {intensity:.2f} | {'pass' if ok_pm else 'differs'} "
            f"| {angle_wk:.4f} | {intensity_wk:.2f} | {'pass' if ok else '**FAIL**'} |"
        )
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
