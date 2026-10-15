/**
 * Minimal complex linear algebra on flat Float64Arrays.
 *
 * Complex values are stored interleaved: element k occupies [2k] = real,
 * [2k+1] = imaginary. Matrices are row-major. Only what the solvers need is
 * implemented - no general-purpose library, no dependencies.
 */

/** Allocate an n-vector of complex zeros. */
export function cvec(n) { return new Float64Array(2 * n); }

/** Allocate an m-by-n complex matrix of zeros. */
export function cmat(m, n) { return new Float64Array(2 * m * n); }

/** Conjugate dot product  a^H b. */
export function cdotH(a, b, n) {
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const ar = a[2 * i], ai = a[2 * i + 1];
    const br = b[2 * i], bi = b[2 * i + 1];
    re += ar * br + ai * bi;
    im += ar * bi - ai * br;
  }
  return [re, im];
}

export function cnorm2(a, n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[2 * i] ** 2 + a[2 * i + 1] ** 2;
  return s;
}

export function cscale(a, n, s) {
  for (let i = 0; i < 2 * n; i++) a[i] *= s;
  return a;
}

/**
 * Accumulate the Hermitian rank-1 update  R += w * g g^H  into the lower
 * triangle of an n-by-n matrix. Only the lower triangle is maintained, which
 * halves both the work and the memory traffic.
 */
export function hermitianRank1(R, n, g, weight = 1) {
  for (let i = 0; i < n; i++) {
    const gir = g[2 * i], gii = g[2 * i + 1];
    for (let j = 0; j <= i; j++) {
      const gjr = g[2 * j], gji = g[2 * j + 1];
      // g_i * conj(g_j)
      const re = gir * gjr + gii * gji;
      const im = gii * gjr - gir * gji;
      const idx = 2 * (i * n + j);
      R[idx] += weight * re;
      R[idx + 1] += weight * im;
    }
  }
  return R;
}

/** Add a real multiple of the identity (Tikhonov / diagonal loading). */
export function addDiagonal(R, n, lambda) {
  for (let i = 0; i < n; i++) {
    R[2 * (i * n + i)] += lambda;
    R[2 * (i * n + i) + 1] = 0; // diagonal of a Hermitian matrix is real
  }
  return R;
}

/** Trace of a Hermitian matrix (real). */
export function trace(R, n) {
  let t = 0;
  for (let i = 0; i < n; i++) t += R[2 * (i * n + i)];
  return t;
}

/**
 * In-place Cholesky factorisation of a Hermitian positive-definite matrix,
 * lower triangle only:  R = L L^H.
 *
 * Returns false if the matrix is not positive definite, in which case the
 * caller should increase the diagonal loading and retry.
 */
export function cholesky(R, n) {
  for (let j = 0; j < n; j++) {
    // Diagonal
    let d = R[2 * (j * n + j)];
    for (let k = 0; k < j; k++) {
      const lr = R[2 * (j * n + k)], li = R[2 * (j * n + k) + 1];
      d -= lr * lr + li * li;
    }
    if (!(d > 0)) return false;
    const sq = Math.sqrt(d);
    R[2 * (j * n + j)] = sq;
    R[2 * (j * n + j) + 1] = 0;
    const invSq = 1 / sq;

    // Below-diagonal column
    for (let i = j + 1; i < n; i++) {
      let re = R[2 * (i * n + j)], im = R[2 * (i * n + j) + 1];
      for (let k = 0; k < j; k++) {
        const air = R[2 * (i * n + k)], aii = R[2 * (i * n + k) + 1];
        const ajr = R[2 * (j * n + k)], aji = R[2 * (j * n + k) + 1];
        // subtract a_ik * conj(a_jk)
        re -= air * ajr + aii * aji;
        im -= aii * ajr - air * aji;
      }
      R[2 * (i * n + j)] = re * invSq;
      R[2 * (i * n + j) + 1] = im * invSq;
    }
  }
  return true;
}

/** Solve L y = b in place (forward substitution), L lower triangular. */
export function forwardSolve(L, n, b) {
  for (let i = 0; i < n; i++) {
    let re = b[2 * i], im = b[2 * i + 1];
    for (let k = 0; k < i; k++) {
      const lr = L[2 * (i * n + k)], li = L[2 * (i * n + k) + 1];
      const yr = b[2 * k], yi = b[2 * k + 1];
      re -= lr * yr - li * yi;
      im -= lr * yi + li * yr;
    }
    const dr = L[2 * (i * n + i)];
    b[2 * i] = re / dr;
    b[2 * i + 1] = im / dr;
  }
  return b;
}

/** Solve L^H x = y in place (back substitution). */
export function backSolveH(L, n, b) {
  for (let i = n - 1; i >= 0; i--) {
    let re = b[2 * i], im = b[2 * i + 1];
    for (let k = i + 1; k < n; k++) {
      // (L^H)_{ik} = conj(L_{ki})
      const lr = L[2 * (k * n + i)], li = -L[2 * (k * n + i) + 1];
      const xr = b[2 * k], xi = b[2 * k + 1];
      re -= lr * xr - li * xi;
      im -= lr * xi + li * xr;
    }
    const dr = L[2 * (i * n + i)];
    b[2 * i] = re / dr;
    b[2 * i + 1] = im / dr;
  }
  return b;
}

/**
 * Solve R x = b for Hermitian positive-definite R, with automatic diagonal
 * loading escalation if the factorisation fails.
 *
 * R is destroyed. Returns {x, lambda} where lambda is the loading actually used.
 */
export function hermitianSolve(R, n, b, lambda0 = 0) {
  const scale = trace(R, n) / Math.max(1, n);
  let lambda = lambda0;
  const backupR = R.slice();
  for (let attempt = 0; attempt < 24; attempt++) {
    const work = attempt === 0 ? R : backupR.slice();
    if (lambda > 0) addDiagonal(work, n, lambda);
    if (cholesky(work, n)) {
      const x = b.slice();
      forwardSolve(work, n, x);
      backSolveH(work, n, x);
      return { x, lambda };
    }
    lambda = lambda === 0 ? Math.max(1e-12, scale * 1e-10) : lambda * 10;
  }
  throw new Error('hermitianSolve: matrix could not be factorised');
}

/**
 * Solve the small k-by-k Hermitian system that appears in the LCMV
 * constraint step, using dense Gauss-Jordan with partial pivoting.
 * k is the number of bright constraints, typically < 32.
 */
export function smallSolve(M, k, b) {
  const A = M.slice();
  const x = b.slice();
  for (let col = 0; col < k; col++) {
    // pivot
    let best = col, bestMag = -1;
    for (let r = col; r < k; r++) {
      const m = A[2 * (r * k + col)] ** 2 + A[2 * (r * k + col) + 1] ** 2;
      if (m > bestMag) { bestMag = m; best = r; }
    }
    if (bestMag <= 0) throw new Error('smallSolve: singular constraint matrix');
    if (best !== col) {
      for (let c = 0; c < k; c++) {
        for (let p = 0; p < 2; p++) {
          const i1 = 2 * (col * k + c) + p, i2 = 2 * (best * k + c) + p;
          const t = A[i1]; A[i1] = A[i2]; A[i2] = t;
        }
      }
      for (let p = 0; p < 2; p++) {
        const i1 = 2 * col + p, i2 = 2 * best + p;
        const t = x[i1]; x[i1] = x[i2]; x[i2] = t;
      }
    }
    // normalise pivot row
    const pr = A[2 * (col * k + col)], pi = A[2 * (col * k + col) + 1];
    const pm = pr * pr + pi * pi;
    const invR = pr / pm, invI = -pi / pm;
    for (let c = 0; c < k; c++) {
      const ar = A[2 * (col * k + c)], ai = A[2 * (col * k + c) + 1];
      A[2 * (col * k + c)] = ar * invR - ai * invI;
      A[2 * (col * k + c) + 1] = ar * invI + ai * invR;
    }
    {
      const ar = x[2 * col], ai = x[2 * col + 1];
      x[2 * col] = ar * invR - ai * invI;
      x[2 * col + 1] = ar * invI + ai * invR;
    }
    // eliminate
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const fr = A[2 * (r * k + col)], fi = A[2 * (r * k + col) + 1];
      if (fr === 0 && fi === 0) continue;
      for (let c = 0; c < k; c++) {
        const ar = A[2 * (col * k + c)], ai = A[2 * (col * k + c) + 1];
        A[2 * (r * k + c)] -= fr * ar - fi * ai;
        A[2 * (r * k + c) + 1] -= fr * ai + fi * ar;
      }
      const ar = x[2 * col], ai = x[2 * col + 1];
      x[2 * r] -= fr * ar - fi * ai;
      x[2 * r + 1] -= fr * ai + fi * ar;
    }
  }
  return x;
}
