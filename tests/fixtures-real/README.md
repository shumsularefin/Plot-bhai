# Real instrument files

Real XRD files exported from instruments. `tests/realFiles.test.ts` checks that every file here
loads without an error, and `tests/xrd-packed-formats.test.ts` compares every point with two
independent extractions kept in `tests/real-references/`. Only add files that may be shared
publicly, with their source and licence below, because this repository is public.

| File                         | Points | Source                                                                                                                                                                       | Licence    |
| ---------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `rigaku_powder.rasx`         | 2,726  | FAIRmat readers-xrd, `tests/data/TwoTheta_scan_powder.rasx`, copied via the geddes test corpus (`tests/data/formats/real/`, commit f5660e8611b8333336f696d2d5a46eb22a6e2cae) | Apache-2.0 |
| `rigaku_zno_counts.rasx`     | 7,001  | FAIRmat readers-xrd, `tests/data/ZnO-ALD-training_001_1_0-000_0-000.rasx`, via geddes as above                                                                               | Apache-2.0 |
| `bruker_absorber.brml`       | 2,001  | FAIRmat readers-xrd, `tests/data/23-012-AG_2thomegascan_long.brml`, via geddes as above                                                                                      | Apache-2.0 |
| `bruker_locked_coupled.brml` | 2,443  | cheminfo/xrd-analysis, `src/from/__tests__/data/test.brml` (commit ccab9401e0e5da09e25111c159aeeb874e337113)                                                                 | MIT        |
| `bruker4_v5converter.raw`    | 4,059  | geddes, `tests/data/bruker_raw/bruker4_v5converter.raw` (commit above)                                                                                                       | MIT        |
| `bruker4_diffrac_eva.raw`    | 7,134  | geddes, `tests/data/bruker_raw/bruker4_diffrac_eva.raw`; its intensities were scrambled upstream, so it checks byte decoding (8-byte records), not physics                   | MIT        |

SHA-256 hashes of the first five files match geddes's `tests/data/formats/manifest.json`. The
licence texts are in `tests/real-references/`. geddes: https://github.com/jcwang587/geddes;
FAIRmat readers-xrd: https://github.com/FAIRmat-NFDI/readers-xrd; cheminfo:
https://github.com/cheminfo/xrd-analysis.

## UV-Vis (`uvvis/`)

Checked by `tests/validation-uvvis-real.test.ts` against `scripts/validation/spectra/uvvis_real.py`.

| File                              | Points | Source                                                                                                                                                                          | Licence   |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `DRS_TiO2_annealed_at_200_oC.csv` | 325    | Zenodo 10.5281/zenodo.14608640, P. Kuzhir, H. Maltanava and N. Belko (2025), "Diffuse reflectance spectra for titanium dioxide, graphitic carbon nitride, and their composites" | CC BY 4.0 |
| `DRS_TiO2_annealed_at_300_oC.csv` | 325    | as above                                                                                                                                                                        | CC BY 4.0 |

Wavelength in nm and diffuse reflectance in %, unchanged from the record (MD5 2ad94a2d3ba46de4a9c9335caaaffde8
and 639fb40f71c45147d8b73b7f28fa374f, as Zenodo lists them). Licence:
https://creativecommons.org/licenses/by/4.0/. The record gives no band gap.

## FTIR and UV-Vis instrument files (`spectra/`)

Binary files read by `src/core/spectrumFiles` (stage 19g), checked by `tests/spectrum-files.test.ts`
and, once the Validation workflow has run `scripts/validation/spectra/instrument_files.py`, by
`tests/spectrum-files-independent.test.ts`.

| File                           | Points   | Source                                                                                                                   | Licence      |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `omnic_sample1.spa`            | 1,738    | Orange-spectroscopy, `orangecontrib/spectroscopy/datasets/sample1.spa` (commit ee2257fac791af459cd57dcbfb77d611a938a310) | GPL-3.0      |
| `opus_peach_juice.0`           | 1,816    | Orange-spectroscopy, `datasets/peach_juice.0` (commit above)                                                             | GPL-3.0      |
| `opus_peach_juice.dpt`         | 1,816    | Orange-spectroscopy, `datasets/peach_juice.dpt`, the OPUS text export of the same measurement (commit above)             | GPL-3.0      |
| `perkinelmer_transmittance.sp` | 1,626    | Orange-spectroscopy, `datasets/perkinelmer/single_PE_spectrum.sp` (commit above)                                         | GPL-3.0      |
| `perkinelmer_absorbance.sp`    | 3,301    | specio 0.1.0 (PyPI sdist), `specio/datasets/data/spectra.sp`                                                             | BSD-3-Clause |
| `galactic_Ft-ir.spc`           | 1,776    | rohanisaac/spc, `test_data/Ft-ir.spc` (commit f35b90fedb995778ad11b276582d89e233774e5e)                                  | GPL-3.0      |
| `galactic_s_evenx.spc`         | 1,844    | rohanisaac/spc, `test_data/s_evenx.spc` (commit above)                                                                   | GPL-3.0      |
| `galactic_nir.spc`             | 20 × 700 | rohanisaac/spc, `test_data/nir.spc` (commit above)                                                                       | GPL-3.0      |

`tests/real-references/spectra/galactic_*.spc.txt` are the text files rohanisaac/spc wrote for the
same three files (`test_data/txt/`, commit above). SHA-256:

```
68afc2580f2c3fde240d02c58f1535999bb5e81c7d0dee0fc6bcd4adefe90e25  omnic_sample1.spa
7c1c901767cd00312f04d09d558ac5d049cdcaea3543d71c1d4bdfad5ae2034b  opus_peach_juice.0
a2b80596d20bc76788f912e23a3b981a334059189084667b505d4149600b93a2  opus_peach_juice.dpt
b5afea5f95667b1ae7df9e2033a4a3455f381433e39b4224fa887475058e7d97  perkinelmer_transmittance.sp
6a244e8d5aab752eb5a436348ddb51ed605665c0dd3345bb3e7833c92f02c745  perkinelmer_absorbance.sp
2e3b5e5be93b017c03a560313b61a9c2db040d11da040a81d387c09ef56501b7  galactic_Ft-ir.spc
0e29e0640a740cf056c1fce9358845d568baf43bdf303246214947609bc6464f  galactic_s_evenx.spc
f3e064402789b076568861e84888367b220227787312acd947cfba987106f173  galactic_nir.spc
```

The licence texts are in `tests/real-references/spectra/`. The SpectroChemPy test data
(spectrochempy_data) were looked at while writing the readers but are not copied here, because
that repository states no licence. Orange-spectroscopy: https://github.com/Quasars/orange-spectroscopy;
rohanisaac/spc: https://github.com/rohanisaac/spc; specio: https://pypi.org/project/specio/.
These are not files from the owner's instruments.
