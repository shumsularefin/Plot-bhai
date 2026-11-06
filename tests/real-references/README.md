# Independent reference values for tests/fixtures-real

- `<stem>.csv`: written by `make_references.py` here (Python standard library only: zipfile,
  xml.etree, struct), separately from the site's TypeScript readers. Re-run with
  `python3 -I tests/real-references/make_references.py` from the repository root.
- `<stem>.geddes.csv`: copied unchanged from geddes, `tests/data/formats/references/` (commit
  f5660e8611b8333336f696d2d5a46eb22a6e2cae), made by its own Python script
  (`tests/build_fixture_corpus.py`), which does not call any reader.

The two agree exactly (difference 0) on all five files they share. The site's readers must match
both to 1e-9 in 2θ and 1e-9 relative in intensity.

Licences of the copied files: `LICENSE-Apache-2.0.txt` (FAIRmat files), `LICENSE-geddes-MIT.txt`
(geddes files and reference CSVs), `LICENSE-cheminfo-MIT.txt` (cheminfo file).
