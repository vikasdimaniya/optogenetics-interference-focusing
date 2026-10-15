/**
 * Emitter weight solvers.
 *
 * All solvers return `weights`: an interleaved complex Float64Array of length
 * 2N, where element j is weights[2j] + i*weights[2j+1]. Amplitude is the drive
 * amplitude of emitter j and argument is its phase.
 *
 * Three solvers, in increasing order of ambition:
 *
 *  1. phaseConjugation   - provably intensity-maximising at ONE point for a
 *                          fixed total emitted power. The matched filter.
 *  2. weightedGerchbergSaxton - several foci of equal brightness.
 *  3. constrainedBeamformer   - foci at the targets AND active suppression of
 *                          the field over a sampled "keep dark" region. This
 *                          is the LCMV / Capon beamformer, and it is the only
 *                          one of the three that actually tries to do what the
 *                          project premise asks for: cancel everywhere else.
 */

import { PropagationModel } from './propagation.js';
import {
  cmat, cvec, hermitianRank1, addDiagonal, trace, hermitianSolve, smallSolve,
} from './linalg.js';

/** Normalise so that sum |w_j|^2 = 1 (unit total emitted power). */
export function normalisePower(w, n) {
  let s = 0;
  for (let j = 0; j < n; j++) s += w[2 * j] ** 2 + w[2 * j + 1] ** 2;
  if (s <= 0) return w;
  const f = 1 / Math.sqrt(s);
  for (let i = 0; i < 2 * n; i++) w[i] *= f;
  return w;
}

/** Discard amplitude information, keeping only phase. |w_j| = 1/sqrt(N). */
export function phaseOnly(w, n) {
  const a = 1 / Math.sqrt(n);
  for (let j = 0; j < n; j++) {
    const re = w[2 * j], im = w[2 * j + 1];
    const m = Math.hypot(re, im);
    if (m === 0) { w[2 * j] = a; w[2 * j + 1] = 0; }
    else { w[2 * j] = (a * re) / m; w[2 * j + 1] = (a * im) / m; }
  }
  return w;
}

/**
 * Matched filter / optical phase conjugation.
 *
 * For a single target, w = conj(g)/||g|| maximises |g^T w|^2 subject to
 * ||w||^2 = 1 (Cauchy-Schwarz, with equality iff w is parallel to conj(g)).
 * No solver can beat this at the focus; everything else trades peak intensity
 * for better suppression elsewhere.
 *
 * For several targets the conjugate fields are simply superposed, which is
 * fast but gives unequal focus brightness - use weightedGerchbergSaxton for that.
 *
 * @param {PropagationModel} model
 * @param {Array} emitters
 * @param {Array<{x,y,z,weight?:number}>} targets
 * @param {object} [opts]
 * @param {boolean} [opts.amplitudeControl=true] false -> phase-only drive
 */
export function phaseConjugation(model, emitters, targets, opts = {}) {
  const { amplitudeControl = true } = opts;
  const N = emitters.length;
  const w = cvec(N);
  const scratch = PropagationModel.scratch();

  for (const t of targets) {
    const tw = t.weight ?? 1;
    for (let j = 0; j < N; j++) {
      const g = model.green(emitters[j], t, scratch);
      // conj(g), scaled by the target's requested weight
      w[2 * j] += tw * g.re;
      w[2 * j + 1] -= tw * g.im;
    }
  }
  return amplitudeControl ? normalisePower(w, N) : phaseOnly(w, N);
}

/**
 * Weighted Gerchberg-Saxton for multiple equal-intensity foci.
 * Di Leonardo, Ianni & Ruocco, Opt. Express 15:1913 (2007).
 *
 * Iteratively adjusts the per-target phase and a per-target gain so that all
 * foci come out equally bright despite their differing depths and path losses.
 */
export function weightedGerchbergSaxton(model, emitters, targets, opts = {}) {
  const { iterations = 40, amplitudeControl = false, seed = 1 } = opts;
  const N = emitters.length, M = targets.length;
  if (M === 0) return cvec(N);
  if (M === 1) return phaseConjugation(model, emitters, targets, { amplitudeControl });

  const { A } = model.transferMatrix(emitters, targets);

  // Deterministic pseudo-random initial phases: reproducible runs matter when
  // you are going to put the output on a bench.
  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const theta = new Float64Array(M);
  for (let t = 0; t < M; t++) theta[t] = 2 * Math.PI * rand();

  const gain = new Float64Array(M).fill(1);
  const desired = targets.map((t) => t.weight ?? 1);
  const w = cvec(N);

  for (let iter = 0; iter < iterations; iter++) {
    // Backward: superpose conjugate fields with current phase and gain.
    w.fill(0);
    for (let t = 0; t < M; t++) {
      const ct = Math.cos(theta[t]) * gain[t], st = Math.sin(theta[t]) * gain[t];
      for (let j = 0; j < N; j++) {
        const gr = A[2 * (t * N + j)], gi = A[2 * (t * N + j) + 1];
        // conj(g) * (ct + i*st)
        w[2 * j] += gr * ct + gi * st;
        w[2 * j + 1] += gr * st - gi * ct;
      }
    }
    if (amplitudeControl) normalisePower(w, N); else phaseOnly(w, N);

    // Forward: field actually produced at each target.
    const mag = new Float64Array(M);
    for (let t = 0; t < M; t++) {
      let re = 0, im = 0;
      for (let j = 0; j < N; j++) {
        const gr = A[2 * (t * N + j)], gi = A[2 * (t * N + j) + 1];
        const wr = w[2 * j], wi = w[2 * j + 1];
        re += gr * wr - gi * wi;
        im += gr * wi + gi * wr;
      }
      theta[t] = Math.atan2(im, re);
      mag[t] = Math.hypot(re, im);
    }

    // Reweight toward equal (or requested) relative amplitude.
    let meanRatio = 0;
    for (let t = 0; t < M; t++) meanRatio += mag[t] / desired[t];
    meanRatio /= M;
    if (meanRatio > 0) {
      for (let t = 0; t < M; t++) {
        const ratio = mag[t] / desired[t];
        if (ratio > 0) gain[t] *= meanRatio / ratio;
      }
    }
  }
  return w;
}

/**
 * Linearly Constrained Minimum Variance beamformer.
 *
 * Minimise   w^H R w          (total intensity over the "keep dark" samples)
 * subject to A_b w = b        (prescribed complex field at the targets)
 *
 * with R = (1/|D|) * sum_{d in D} g_d g_d^H  +  lambda * I.
 *
 * Closed-form solution:
 *   Z = R^-1 A_b^H
 *   w = Z (A_b Z)^-1 b
 *
 * The diagonal loading lambda is essential, not cosmetic: without it the
 * solution happily returns enormous opposing emitter amplitudes that cancel to
 * nothing in the model and to noise on a real bench. lambda trades suppression
 * depth against robustness, exactly as in array signal processing.
 *
 * @param {PropagationModel} model
 * @param {Array} emitters
 * @param {Array} targets                bright constraints
 * @param {Array} darkPoints             sampled suppression region
 * @param {object} [opts]
 * @param {number} [opts.loading=1e-3]   lambda, relative to tr(R)/N
 */
export function constrainedBeamformer(model, emitters, targets, darkPoints, opts = {}) {
  const { loading = 1e-3 } = opts;
  const N = emitters.length, K = targets.length;
  if (K === 0) return cvec(N);
  if (!darkPoints || darkPoints.length === 0) {
    return phaseConjugation(model, emitters, targets, { amplitudeControl: true });
  }

  // Build R from the dark samples.
  //
  // Careful with conjugates. The field at dark point d is E_d = g_d^T w (plain
  // transpose, because the Green's function already carries the phase). We want
  // R with w^H R w = sum_d |E_d|^2, and
  //     |g_d^T w|^2 = |conj(g_d)^H w|^2
  // so R must be built from h_d = conj(g_d), NOT from g_d. Building it from g_d
  // minimises the wrong quadratic form and the result is worse than plain phase
  // conjugation - which is exactly how this bug announced itself.
  const R = cmat(N, N); // lower triangle only
  const { A: Ad } = model.transferMatrix(emitters, darkPoints);
  const h = cvec(N);
  const invD = 1 / darkPoints.length;
  for (let d = 0; d < darkPoints.length; d++) {
    for (let j = 0; j < N; j++) {
      h[2 * j] = Ad[2 * (d * N + j)];
      h[2 * j + 1] = -Ad[2 * (d * N + j) + 1];
    }
    hermitianRank1(R, N, h, invD);
  }

  // Mirror the lower triangle into the upper so the solver sees a full matrix.
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < i; j++) {
      const lo = 2 * (i * N + j), up = 2 * (j * N + i);
      R[up] = R[lo];
      R[up + 1] = -R[lo + 1];
    }
  }

  const lambda = (trace(R, N) / Math.max(1, N)) * loading;
  addDiagonal(R, N, lambda);

  // Z = R^-1 A_b^H, column by column.
  const { A: Ab } = model.transferMatrix(emitters, targets);
  const Z = cmat(N, K);
  const Rsaved = R.slice();
  for (let t = 0; t < K; t++) {
    const rhs = cvec(N);
    for (let j = 0; j < N; j++) {
      // (A_b^H) column t = conj of row t of A_b
      rhs[2 * j] = Ab[2 * (t * N + j)];
      rhs[2 * j + 1] = -Ab[2 * (t * N + j) + 1];
    }
    const { x } = hermitianSolve(Rsaved.slice(), N, rhs);
    for (let j = 0; j < N; j++) {
      Z[2 * (j * K + t)] = x[2 * j];
      Z[2 * (j * K + t) + 1] = x[2 * j + 1];
    }
  }

  // M = A_b Z  (K x K)
  const Mk = cmat(K, K);
  for (let t = 0; t < K; t++) {
    for (let u = 0; u < K; u++) {
      let re = 0, im = 0;
      for (let j = 0; j < N; j++) {
        const ar = Ab[2 * (t * N + j)], ai = Ab[2 * (t * N + j) + 1];
        const zr = Z[2 * (j * K + u)], zi = Z[2 * (j * K + u) + 1];
        re += ar * zr - ai * zi;
        im += ar * zi + ai * zr;
      }
      Mk[2 * (t * K + u)] = re;
      Mk[2 * (t * K + u) + 1] = im;
    }
  }

  // b: requested complex field at each target (relative amplitude, zero phase).
  const b = cvec(K);
  for (let t = 0; t < K; t++) b[2 * t] = targets[t].weight ?? 1;

  let y;
  try {
    y = smallSolve(Mk, K, b);
  } catch {
    return phaseConjugation(model, emitters, targets, { amplitudeControl: true });
  }

  const w = cvec(N);
  for (let j = 0; j < N; j++) {
    let re = 0, im = 0;
    for (let t = 0; t < K; t++) {
      const zr = Z[2 * (j * K + t)], zi = Z[2 * (j * K + t) + 1];
      const yr = y[2 * t], yi = y[2 * t + 1];
      re += zr * yr - zi * yi;
      im += zr * yi + zi * yr;
    }
    w[2 * j] = re;
    w[2 * j + 1] = im;
  }
  return normalisePower(w, N);
}

/**
 * Stratified sample of points to keep dark: inside the brain, outside an
 * exclusion radius around every target.
 *
 * Uses a deterministic low-discrepancy sequence so repeat runs are identical.
 */
export function sampleDarkPoints(head, targets, opts = {}) {
  const {
    count = 1500,
    exclusionMm = 3,
    maxRadius = null,
    seed = 12345,
  } = opts;
  const rMax = maxRadius ?? (head.shells.find((s) => s.layer === 'greyMatter')?.outerRadius
    ?? head.outerRadius * 0.85);

  let s = seed >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  const pts = [];
  let guard = 0;
  while (pts.length < count && guard++ < count * 80) {
    // Uniform in the ball: r = rMax * u^(1/3)
    const u = rand();
    const r = rMax * Math.cbrt(u);
    const cz = 2 * rand() - 1;
    const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
    const phi = 2 * Math.PI * rand();
    const p = { x: r * sz * Math.cos(phi), y: r * sz * Math.sin(phi), z: r * cz };
    let tooClose = false;
    for (const t of targets) {
      if (Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z) < exclusionMm) { tooClose = true; break; }
    }
    if (!tooClose) pts.push(p);
  }
  return pts;
}

export const SOLVERS = {
  phaseConjugation: {
    name: 'Phase conjugation (matched filter)',
    fn: (model, emitters, targets, opts) => phaseConjugation(model, emitters, targets, opts),
    note: 'Maximises peak intensity at the target. Optimal for one point; no control over the rest of the field.',
  },
  weightedGS: {
    name: 'Weighted Gerchberg-Saxton',
    fn: (model, emitters, targets, opts) => weightedGerchbergSaxton(model, emitters, targets, opts),
    note: 'Equalises brightness across several foci. Phase-only drive by default.',
  },
  lcmv: {
    name: 'Constrained beamformer (LCMV)',
    fn: (model, emitters, targets, opts) => constrainedBeamformer(
      model, emitters, targets, opts.darkPoints, opts,
    ),
    note: 'Holds the targets lit while actively minimising intensity over a sampled dark region.',
  },
};
