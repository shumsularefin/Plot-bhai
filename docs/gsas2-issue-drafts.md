# Draft reports for GSAS-II

Drafts for the owner to send to GSAS-II (issues at https://github.com/AdvancedPhotonSource/GSAS-II/issues),
written from the comparisons in docs/validation.md (sections 17g, 17h and 20). Nothing here has been
sent. Line numbers are those of GSAS-II commit f0241ba33e2b1f14f210f3db4b41e23d4f17be3b (pip
install used in the session); the CI comparisons ran on commit 2c62562. Please check each against
the current GSAS-II before sending, since the code may have changed.

---

## 1. RetDistAngle: bond angles use the transposed orthogonalisation matrix

**Where:** `GSASIIstrMain.py`, `RetDistAngle`, line 1393:

```python
angSigij = G2mth.getAngSig(VectA[i],VectA[j],Amat.T,SGData,covData)
```

The distances in the same function use `Amat` (`getDistDerv(..., Amat, ...)`, line 1373), and the
rigid-body branch of the angle a few lines above also passes `Amat`. Only the ordinary angle
passes `Amat.T`.

**Effect:** in a cell that is not orthogonal, the angles printed by the distance/angle calculation do
not match the bond vectors whose lengths it prints. For refined baddeleyite (ZrO₂, COD 9007448,
P2₁/c) the difference reaches 1.14° (for example 86.50° reported against 87.27° from the same
vectors with `Amat`). For orthogonal cells `Amat` is diagonal and the two agree, which may be why it
has not been noticed.

**To reproduce:** refine or load any monoclinic phase, call `RetDistAngle` for one atom with its
neighbours, then recompute one angle with `G2mth.getAngSig(vA, vB, Amat, SGData, covData)` and with
`Amat.T`: the reported value equals the `Amat.T` one. Recompute the same angle by hand from the
Cartesian vectors `Amat @ (x_B − x_A)`; it equals the `Amat` one.

**Suggested fix:** pass `Amat` (as for the distances and for rigid bodies), if `getAngSig` expects
the same matrix as `getDistDerv`.

---

## 2. RetDistAngle: distance s.u. leave out the cell parameters

**Where:** `GSASIIstrMain.py`, `RetDistAngle`, lines 1373–1374:

```python
pdpx = G2mth.getDistDerv(Oatom[3:6],Tatom[3:6],Amat,unit,Top,SGData)
sig = np.sqrt(np.inner(pdpx,np.inner(pdpx,Xvcov)))
```

`Xvcov` is the covariance of the atom coordinates only, so the uncertainty of the cell (and its
correlation with the coordinates) does not enter the distance s.u.

**Effect:** small for most lab refinements (in our baddeleyite comparison it changed the s.u. by less
than 1e-5 Å), but it can matter for long distances or a poorly determined cell. The program
documentation could also say which covariance is used.

**Question for the developers:** is leaving out the cell block intended? If so, a note in the
output ("s.u. from the atom coordinates only") would help users comparing with other programs.

---

## 3. get_cell_and_esd: s.u. of a hexagonal a twice the propagated value

**Where:** `GSASIIscriptable.py`, `G2Project.get_cell_and_esd` (line 6040) and the phase method of the
same name (line 4834).

**What we saw:** for ZnO (wurtzite, COD 1577381, P6₃mc) refined one by one on five patterns simulated in GSAS-II
(20–130° 2θ, counting noise), `get_cell_and_esd` reports σ(a) = 1.05e-5 Å for every pattern. Propagating GSAS-II's own
s.u. of the reciprocal-metric term A0 (a = 1/√A0 · 2/√3 for hexagonal) gives 6.28e-6 Å, an
independent least-squares program gives 4.97e-6 Å, and the scatter of a over 200 noisy copies of the
pattern (Monte Carlo) is 4.60e-6 Å. For c all three agree (1.34e-5, 1.34e-5 and 1.32e-5 Å).

**Question:** does `get_cell_and_esd` combine the A terms in a way that double counts the constraint
A0 = A1 for hexagonal symmetry (for example treating A0 and A1 as independent)? We could not find
the cause, so this is a report of the numbers, not of a confirmed bug.

---

## 4. (Note) Crystallite size limited to 10 µm when results are stored

**Where:** `GSASIIstrIO.py`, lines 3521 and 3527:

```python
hapData[item][1][0] = min(10.,max(0.001,hapData[item][1][0]))
```

A script that sets the size to a very large value to mean "no size broadening" (for example 1e5 µm)
finds it reset to 10 µm after the first refinement step, which adds about 0.0009° of Lorentzian
width (Cu Kα, near 2θ = 40°). This is probably intended for stability, but it is silent. A note in the
documentation, or a printed message when the value is clamped, would help.

---

## 5. (Note) Kα2 placed by a first-order step

**Where:** `GSASIIstrMath.py`, the Kα2 position from `lamRatio`:
2θ₂ = 2θ₁ + (360/π)(Δλ/λ₁) tan θ₁.

The exact position is 2θ₂ = 2 asin((λ₂/λ₁) sin θ₁). For Cu the two differ by 3e-5° at 2θ = 30°, 4e-4°
at 90° and 3.4e-3° at 130°. This is below a typical step width, but at high angle on fine-step data
it moves the refined displacement and cell by several s.u. (in our capillary test, Dy by 6 s.u. and a
by 9 s.u.). Mentioned in case the exact form is wanted; it costs one asin per reflection.
