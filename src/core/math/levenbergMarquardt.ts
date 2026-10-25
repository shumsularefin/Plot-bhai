import { invert, solve } from './linear';

export interface LeastSquaresProblem {
  /** Observed values. */
  y: Float64Array;
  /** Starting parameters; parameters outside their bounds are moved inside. */
  initial: Float64Array;
  lower: Float64Array;
  upper: Float64Array;
  /** false keeps a parameter fixed at its starting value. */
  free: readonly boolean[];
  /**
   * Fills `model` with the model values for parameters p and, when given, `jacobian`
   * (row-major, y.length × p.length) with ∂model_i/∂p_j.
   */
  evaluate(p: Float64Array, model: Float64Array, jacobian: Float64Array | null): void;
  maxIterations?: number;
}

export interface LeastSquaresResult {
  parameters: Float64Array;
  /** Covariance matrix (p.length × p.length, row-major); rows and columns of fixed parameters are 0. */
  covariance: Float64Array;
  /**
   * Standard uncertainty of each parameter: √(covariance diagonal); 0 for fixed parameters, NaN
   * for every free parameter when the covariance could not be calculated (see covarianceOk).
   */
  standardErrors: Float64Array;
  /**
   * False when JᵀJ could not be inverted (parameters not independent, for example two peaks on
   * top of each other or a peak of zero height) or there are no degrees of freedom left.
   */
  covarianceOk: boolean;
  /** Sum of squared residuals Σ (y − model)². */
  ssr: number;
  model: Float64Array;
  iterations: number;
  converged: boolean;
  /** Free parameters that ended on a bound (their uncertainty is NaN: not defined). */
  atBound: boolean[];
}

/**
 * Unweighted least squares by the Levenberg–Marquardt method with box bounds.
 *
 * Each iteration solves (JᵀJ + λ·diag(JᵀJ)) δ = Jᵀr for the free parameters, where J is the
 * Jacobian and r = y − model, and clips the new parameters to their bounds. A step that lowers
 * the sum of squares is accepted and λ is reduced; otherwise λ is increased and the step is
 * retried. It stops when the relative decrease of the sum of squares falls below 1e−10, the
 * relative step size below 1e−9, or after maxIterations.
 *
 * Uncertainties come from the covariance matrix C = s² (JᵀJ)⁻¹ at the solution, with
 * s² = SSR / (n − m) for n points and m free parameters that are not on a bound. They assume
 * the model is correct and the noise is independent with equal variance at every point.
 * Parameters on a bound are left out of C (as if fixed) and their own uncertainty is NaN.
 */
export function levenbergMarquardt(problem: LeastSquaresProblem): LeastSquaresResult {
  const { y, lower, upper, free, evaluate } = problem;
  const n = y.length;
  const m = problem.initial.length;
  const maxIterations = problem.maxIterations ?? 200;
  const freeIndex = free.flatMap((f, j) => (f ? [j] : []));
  const k = freeIndex.length;

  const clamp = (p: Float64Array) => {
    for (let j = 0; j < m; j++)
      p[j] = Math.min(upper[j] as number, Math.max(lower[j] as number, p[j] as number));
    return p;
  };
  let p = clamp(problem.initial.slice());
  const model = new Float64Array(n);
  const jacobian = new Float64Array(n * m);
  const trialModel = new Float64Array(n);
  const sumSquares = (values: Float64Array) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += ((y[i] as number) - (values[i] as number)) ** 2;
    return s;
  };

  /** JᵀJ and Jᵀr restricted to the free parameters. */
  const normalEquations = () => {
    const a = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const g = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const r = (y[i] as number) - (model[i] as number);
      const row = i * m;
      for (let s = 0; s < k; s++) {
        const js = jacobian[row + (freeIndex[s] as number)] as number;
        if (js === 0) continue;
        g[s] = (g[s] as number) + js * r;
        const as = a[s] as number[];
        for (let t = s; t < k; t++)
          as[t] = (as[t] as number) + js * (jacobian[row + (freeIndex[t] as number)] as number);
      }
    }
    for (let s = 0; s < k; s++)
      for (let t = 0; t < s; t++) (a[s] as number[])[t] = (a[t] as number[])[s] as number;
    return { a, g };
  };

  evaluate(p, model, jacobian);
  let ssr = sumSquares(model);
  let lambda = 1e-3;
  let iterations = 0;
  let converged = k === 0;
  let system = normalEquations();

  while (!converged && iterations < maxIterations) {
    iterations++;
    const damped = system.a.map((row, s) =>
      row.map((v, t) => (s === t ? v + lambda * Math.max(v, 1e-12) : v)),
    );
    const delta = solve(damped, system.g);
    if (!delta) {
      lambda *= 10;
      if (lambda > 1e12) break;
      continue;
    }
    const trial = p.slice();
    let relativeStep = 0;
    delta.forEach((d, s) => {
      const j = freeIndex[s] as number;
      trial[j] = (trial[j] as number) + d;
      relativeStep = Math.max(relativeStep, Math.abs(d) / (Math.abs(p[j] as number) + 1e-12));
    });
    clamp(trial);
    evaluate(trial, trialModel, null);
    const trialSsr = sumSquares(trialModel);
    if (trialSsr < ssr) {
      const decrease = (ssr - trialSsr) / Math.max(ssr, 1e-300);
      p = trial;
      ssr = trialSsr;
      lambda = Math.max(lambda / 10, 1e-12);
      evaluate(p, model, jacobian);
      system = normalEquations();
      if (decrease < 1e-10 || relativeStep < 1e-9) converged = true;
    } else {
      lambda *= 10;
      // No downhill step exists even with a tiny step: we are at the minimum.
      if (lambda > 1e12 || relativeStep < 1e-12) converged = true;
    }
  }

  // An infinite bound can never be reached (Infinity − v ≤ Infinity would say it was).
  const atBound = Array.from({ length: m }, (_, j) => {
    if (!free[j]) return false;
    const v = p[j] as number;
    const lo = lower[j] as number;
    const hi = upper[j] as number;
    const finite = [lo, hi].filter(Number.isFinite).map(Math.abs);
    const span = Math.max(...finite, 1) * 1e-9;
    return (Number.isFinite(lo) && v - lo <= span) || (Number.isFinite(hi) && hi - v <= span);
  });

  // Parameters on a bound, or with no effect on the model, are treated as fixed for the
  // covariance (their rows and columns are 0, so they do not spoil propagated uncertainties)
  // and get NaN as their own uncertainty: it is not defined.
  const covariance = new Float64Array(m * m);
  const standardErrors = new Float64Array(m);
  const diagonal = system.a.map((row, s) => row[s] as number);
  const active: number[] = [];
  freeIndex.forEach((j, s) => {
    if (!atBound[j] && (diagonal[s] as number) > 0) active.push(s);
    else standardErrors[j] = NaN;
  });
  const dof = n - active.length;
  // Inverted in correlation form (unit diagonal), so the singularity test is independent of the
  // parameters' units and sizes.
  const scale = active.map((s) => Math.sqrt(diagonal[s] as number));
  const scaled = active.map((s, u) =>
    active.map(
      (t, v) =>
        ((system.a[s] as number[])[t] as number) / ((scale[u] as number) * (scale[v] as number)),
    ),
  );
  const inverse = active.length > 0 ? invert(scaled) : [];
  const covarianceOk = inverse !== null && dof > 0;
  if (!covarianceOk) {
    for (const j of freeIndex) {
      standardErrors[j] = NaN;
      for (const t of freeIndex) covariance[j * m + t] = NaN;
    }
  } else {
    const s2 = ssr / dof;
    active.forEach((s, u) => {
      const j = freeIndex[s] as number;
      active.forEach((t, v) => {
        covariance[j * m + (freeIndex[t] as number)] =
          (s2 * ((inverse[u] as number[])[v] as number)) /
          ((scale[u] as number) * (scale[v] as number));
      });
      standardErrors[j] = Math.sqrt(Math.max(0, covariance[j * m + j] as number));
    });
  }
  return {
    parameters: p,
    covariance,
    standardErrors,
    covarianceOk,
    ssr,
    model,
    iterations,
    converged,
    atBound,
  };
}
