"""Independent reference values for the real instrument files in tests/fixtures-real.

Written separately from the TypeScript readers, with the Python standard library only
(zipfile, xml.etree, struct), so a mistake in one is unlikely to be repeated in the other.
Run from the repository root:  python3 -I tests/real-references/make_references.py
Writes tests/real-references/<file stem>.csv with columns x,y (2θ in degrees, intensity as
stored in the file), using repr() so every digit of the stored number is kept.
"""

import csv
import struct
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent / "fixtures-real"
XSI = "{http://www.w3.org/2001/XMLSchema-instance}type"


def rasx(path):
    with zipfile.ZipFile(path) as z:
        text = z.read("Data0/Profile0.txt").decode("utf-8-sig")
    rows = [line.split() for line in text.splitlines() if line.strip()]
    return [(float(r[0]), float(r[1])) for r in rows]


def brml(path):
    with zipfile.ZipFile(path) as z:
        container = ET.fromstring(z.read("Experiment0/DataContainer.xml"))
        name = container.find("RawDataReferenceList/string").text.strip()
        raw = ET.fromstring(z.read(name))
    route = [r for r in raw.iter("DataRoute") if r.get("RouteFlag") == "Measured"][0]
    x_col = y_col = None
    for view in route.find("DataViews"):
        kind = view.get(XSI)
        start = int(view.get("Start"))
        if kind == "VaryingRawDataView":
            for offset, field in enumerate(view.iter("FieldDefinitions")):
                if field.get("AxisId") == "TwoTheta" and x_col is None:
                    x_col = start + offset
        elif kind == "RecordedRawDataView" and y_col is None:
            y_col = start
    points = []
    for datum in route.iter("Datum"):
        values = datum.text.split(",")
        points.append((float(values[x_col]), float(values[y_col])))
    return points


def bruker_raw4(path):
    b = path.read_bytes()
    assert b[:7] == b"RAW4.00"
    at = 61
    while True:
        kind, length = struct.unpack_from("<II", b, at)
        if kind in (0, 160):
            break
        at += length
    start, step = struct.unpack_from("<dd", b, at + 72)
    (n,) = struct.unpack_from("<I", b, at + 88)
    stride, extra = struct.unpack_from("<II", b, at + 136)
    data = at + 160 + extra
    return [
        (start + i * step, struct.unpack_from("<f", b, data + i * stride)[0]) for i in range(n)
    ]


READERS = {".rasx": rasx, ".brml": brml, ".raw": bruker_raw4}

for path in sorted(FIXTURES.iterdir()):
    reader = READERS.get(path.suffix.lower())
    if reader is None:
        continue
    points = reader(path)
    with open(HERE / f"{path.stem}.csv", "w", newline="") as f:
        out = csv.writer(f, lineterminator="\n")
        out.writerow(["x", "y"])
        out.writerows((repr(x), repr(y)) for x, y in points)
    print(path.name, len(points), file=sys.stderr)
