/**
 * ln Γ(z) for z > 0 by the Lanczos approximation with g = 7 and the widely used nine-term
 * coefficient set (relative error about 1e-15; checked in the tests against Γ(n) = (n − 1)! and
 * Γ(½) = √π). Γ(z) for z < ½ uses the reflection formula Γ(z) Γ(1 − z) = π / sin(π z).
 */
export function lnGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lnGamma(1 - z);
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  const x = z - 1;
  let sum = c[0] as number;
  for (let i = 1; i < 9; i++) sum += (c[i] as number) / (x + i);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(sum);
}
