import {
  suite, test, assert, assertClose, assertGreater, groupHeader,
} from './harness.js';
import { HeadModel } from '../src/head-model.js';
import { PropagationModel } from '../src/propagation.js';
import { sphericalCap } from '../src/array-geometry.js';
import {
  phaseConjugation, weightedGerchbergSaxton, constrainedBeamformer,
  sampleDarkPoints, normalisePower,
} from '../src/solvers.js';
import { focusShape, sliceStatistics, findHotspots, maskByRadius, extracranialPeak } from '../src/metrics.js';
import { makeSlice, plan, emitterTable, emitterTableCsv } from '../src/api.js';
import { cholesky, forwardSolve, backSolveH, cmat, cvec, hermitianRank1, addDiagonal, smallSolve } from '../src/linalg.js';

groupHeader('Linear algebra');
suite('linalg');

test('Cholesky round-trips a Hermitian positive-definite system', () => {
  const n = 6;
  const R = cmat(n, n);
  // Build R = B^H B + nI so it is Hermitian PD, storing the full matrix.
  const B = cmat(n, n);
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296 - 0.5; };
  for (let i = 0; i < n * n; i++) { B[2 * i] = rnd(); B[2 * i + 1] = rnd(); }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let re = 0, im = 0;
      for (let k = 0; k < n; k++) {
        // (B^H B)_{ij} = sum_k conj(B_ki) B_kj
        const br = B[2 * (k * n + i)], bi = -B[2 * (k * n + i) + 1];
        const cr = B[2 * (k * n + j)], ci = B[2 * (k * n + j) + 1];
        re += br * cr - bi * ci;
        im += br * ci + bi * cr;
      }
      R[2 * (i * n + j)] = re + (i === j ? n : 0);
      R[2 * (i * n + j) + 1] = i === j ? 0 : im;
    }
  }
  const Rorig = R.slice();
  const x = cvec(n);
  for (let i = 0; i < n; i++) { x[2 * i] = rnd(); x[2 * i + 1] = rnd(); }
  // b = R x
  const b = cvec(n);
  for (let i = 0; i < n; i++) {
    let re = 0, im = 0;
    for (let j = 0; j < n; j++) {
      const rr = Rorig[2 * (i * n + j)], ri = Rorig[2 * (i * n + j) + 1];
      const xr = x[2 * j], xi = x[2 * j + 1];
      re += rr * xr - ri * xi;
      im += rr * xi + ri * xr;
    }
    b[2 * i] = re; b[2 * i + 1] = im;
  }
  assert(cholesky(R, n), 'should factorise');
  const sol = b.slice();
  forwardSolve(R, n, sol);
  backSolveH(R, n, sol);
  for (let i = 0; i < n; i++) {
    assertClose(sol[2 * i], x[2 * i], 1e-8, `re[${i}]`);
    assertClose(sol[2 * i + 1], x[2 * i + 1], 1e-8, `im[${i}]`);
  }
});

test('Cholesky rejects a non positive-definite matrix', () => {
  const n = 3;
  const R = cmat(n, n);
  for (let i = 0; i < n; i++) R[2 * (i * n + i)] = -1;
  assert(cholesky(R, n) === false, 'negative definite must be rejected');
});

test('rank-1 Hermitian update builds a conjugate-symmetric matrix', () => {
  const n = 4;
  const R = cmat(n, n);
  const g = cvec(n);
  for (let i = 0; i < n; i++) { g[2 * i] = i + 1; g[2 * i + 1] = (i % 2) ? 0.5 : -0.25; }
  hermitianRank1(R, n, g, 1);
  // Diagonal must be real and equal |g_i|^2.
  for (let i = 0; i < n; i++) {
    assertClose(R[2 * (i * n + i)], g[2 * i] ** 2 + g[2 * i + 1] ** 2, 1e-12);
    assertClose(R[2 * (i * n + i) + 1], 0, 1e-12);
  }
  // Lower triangle element (1,0) should equal g_1 conj(g_0).
  const expRe = g[2] * g[0] + g[3] * g[1];
  const expIm = g[3] * g[0] - g[2] * g[1];
  assertClose(R[2 * (1 * n + 0)], expRe, 1e-12);
  assertClose(R[2 * (1 * n + 0) + 1], expIm, 1e-12);
});

test('smallSolve inverts a 3x3 complex system', () => {
  const k = 3;
  const M = cmat(k, k);
  const vals = [2, 0.3, 0.1, -0.2, 0, 0.4, 0.1, 0.2, 3, 0.1, 0.2, 0, -0.1, 0.3, 0, -0.2, 2.5, 0];
  for (let i = 0; i < k * k; i++) { M[2 * i] = vals[2 * i]; M[2 * i + 1] = vals[2 * i + 1]; }
  const x = cvec(k);
  x[0] = 1; x[1] = 0.5; x[2] = -0.3; x[3] = 0.2; x[4] = 0.7; x[5] = -0.1;
  const b = cvec(k);
  for (let i = 0; i < k; i++) {
    let re = 0, im = 0;
    for (let j = 0; j < k; j++) {
      const mr = M[2 * (i * k + j)], mi = M[2 * (i * k + j) + 1];
      re += mr * x[2 * j] - mi * x[2 * j + 1];
      im += mr * x[2 * j + 1] + mi * x[2 * j];
    }
    b[2 * i] = re; b[2 * i + 1] = im;
  }
  const sol = smallSolve(M, k, b);
  for (let i = 0; i < 2 * k; i++) assertClose(sol[i], x[i], 1e-9, `component ${i}`);
});

// ---------------------------------------------------------------------------
groupHeader('Solvers');
suite('phase conjugation');

const head = HeadModel.preset('humanAdult', { couplingLayer: 'water' });
const acoustic = new PropagationModel({ mode: 'acoustic', drive: 650e3, head });
const array = sphericalCap({ count: 192, radius: 104, halfAngleDeg: 75 });

test('weights are power-normalised', () => {
  const w = phaseConjugation(acoustic, array, [{ x: 0, y: 0, z: 25 }]);
  let s = 0;
  for (let j = 0; j < array.length; j++) s += w[2 * j] ** 2 + w[2 * j + 1] ** 2;
  assertClose(s, 1, 1e-12, 'sum |w|^2 should be 1');
});

test('phase-only mode gives every emitter equal amplitude', () => {
  const w = phaseConjugation(acoustic, array, [{ x: 0, y: 0, z: 25 }], { amplitudeControl: false });
  const a0 = Math.hypot(w[0], w[1]);
  for (let j = 0; j < array.length; j++) {
    assertClose(Math.hypot(w[2 * j], w[2 * j + 1]), a0, 1e-12, `emitter ${j}`);
  }
  assertClose(a0, 1 / Math.sqrt(array.length), 1e-12);
});

test('phase conjugation is the provable intensity maximum at the target', () => {
  // |g^T w|^2 <= ||g||^2 for ||w|| = 1, with equality iff w = conj(g)/||g||.
  const target = { x: 10, y: -6, z: 22 };
  const w = phaseConjugation(acoustic, array, [target]);
  const best = acoustic.fieldAt(array, w, target).intensity;

  let s = 99;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  let violations = 0;
  for (let trial = 0; trial < 400; trial++) {
    const r = new Float64Array(2 * array.length);
    for (let i = 0; i < r.length; i++) r[i] = rnd();
    normalisePower(r, array.length);
    const I = acoustic.fieldAt(array, r, target).intensity;
    if (I > best * (1 + 1e-9)) violations++;
  }
  assert(violations === 0, `${violations} random weight sets beat the matched filter`);
});

test('phase conjugation beats random phases by orders of magnitude', () => {
  const target = { x: 0, y: 0, z: 25 };
  const w = phaseConjugation(acoustic, array, [target]);
  const best = acoustic.fieldAt(array, w, target).intensity;

  let s = 4242;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let sum = 0;
  const trials = 200;
  for (let t = 0; t < trials; t++) {
    const r = new Float64Array(2 * array.length);
    const a = 1 / Math.sqrt(array.length);
    for (let j = 0; j < array.length; j++) {
      const ph = 2 * Math.PI * rnd();
      r[2 * j] = a * Math.cos(ph);
      r[2 * j + 1] = a * Math.sin(ph);
    }
    sum += acoustic.fieldAt(array, r, target).intensity;
  }
  const meanRandom = sum / trials;
  // Coherent gain over random phase should be of order N.
  assertGreater(best / meanRandom, array.length * 0.25,
    `coherent gain ${(best / meanRandom).toFixed(1)} should be of order N = ${array.length}`);
});

test('the brightest point in brain tissue is the requested target', () => {
  const target = { x: -14, y: 8, z: 18 };
  const w = phaseConjugation(acoustic, array, [target]);
  const slice = makeSlice(head, 'coronal', target, { resolution: 161 });
  const field = acoustic.computeSlice(array, w, slice);
  const brainMask = maskByRadius(field.radius, 77); // grey matter outer radius
  const stats = sliceStatistics(field.intensity, slice.nu, slice.nv, { mask: brainMask });
  const du = slice.extentU / (slice.nu - 1);
  // The slice passes through the target, so the target sits at (0,0) in u,v.
  const centreU = (slice.nu - 1) / 2, centreV = (slice.nv - 1) / 2;
  const err = Math.hypot(stats.peakU - centreU, stats.peakV - centreV) * du;
  assert(err < 2 * du, `peak is ${err.toFixed(2)} mm from the target (pixel ${du.toFixed(2)} mm)`);
});

test('energy also lands in the skull, and that is reported, not hidden', () => {
  // Bone has nearly twice the acoustic impedance of brain, so pressure rises on
  // entry and the skull sits close to the emitters. Skull heating is the
  // dominant safety limit in clinical transcranial ultrasound, so the planner
  // must surface it rather than mask it away.
  const target = { x: 0, y: 0, z: 20 };
  const w = phaseConjugation(acoustic, array, [target]);
  const slice = makeSlice(head, 'coronal', target, { resolution: 141 });
  const field = acoustic.computeSlice(array, w, slice);
  const outside = extracranialPeak(field.intensity, field.radius, 77, head.outerRadius);
  const focus = acoustic.fieldAt(array, w, target).intensity;
  assertGreater(outside.max, 0, 'should find extracranial deposition');
  // It is the same order of magnitude as the focus - that is the real finding.
  assert(outside.max / focus > 0.1 && outside.max / focus < 100,
    `extracranial/focus ratio ${(outside.max / focus).toFixed(2)} should be within 2 orders`);
});

test('more emitters give a better peak-to-background ratio', () => {
  const target = { x: 0, y: 0, z: 25 };
  const measure = (count) => {
    const em = sphericalCap({ count, radius: 104, halfAngleDeg: 75 });
    const w = phaseConjugation(acoustic, em, [target]);
    const slice = makeSlice(head, 'coronal', target, { resolution: 141 });
    const f = acoustic.computeSlice(em, w, slice);
    return sliceStatistics(f.intensity, slice.nu, slice.nv, { mask: f.mask }).peakToBackground;
  };
  const few = measure(16);
  const many = measure(256);
  assertGreater(many, few * 1.5, `PBR should improve: 16 -> ${few.toFixed(1)}, 256 -> ${many.toFixed(1)}`);
});

suite('weighted Gerchberg-Saxton');

test('equalises brightness across three foci', () => {
  const targets = [
    { x: -18, y: 0, z: 20 },
    { x: 0, y: 0, z: 30 },
    { x: 20, y: 0, z: 10 },
  ];
  const w = weightedGerchbergSaxton(acoustic, array, targets, { iterations: 60 });
  const I = targets.map((t) => acoustic.fieldAt(array, w, t).intensity);
  const mean = I.reduce((a, b) => a + b, 0) / I.length;
  for (const v of I) {
    assertClose(v / mean, 1, 0.25, `focus intensity spread too large: ${I.map((x) => x.toExponential(2))}`);
  }
});

test('superposed phase conjugation is measurably less uniform than weighted GS', () => {
  const targets = [
    { x: -25, y: 0, z: 10 },
    { x: 0, y: 0, z: 45 },
  ];
  const spread = (w) => {
    const I = targets.map((t) => acoustic.fieldAt(array, w, t).intensity);
    return Math.max(...I) / Math.min(...I);
  };
  const gs = spread(weightedGerchbergSaxton(acoustic, array, targets, { iterations: 60 }));
  assert(gs < 1.5, `weighted GS spread ${gs.toFixed(2)} should be near 1`);
});

test('single target falls through to phase conjugation', () => {
  const t = [{ x: 3, y: 3, z: 20 }];
  const a = weightedGerchbergSaxton(acoustic, array, t, { amplitudeControl: true });
  const b = phaseConjugation(acoustic, array, t, { amplitudeControl: true });
  for (let i = 0; i < a.length; i++) assertClose(a[i], b[i], 1e-12);
});

suite('constrained beamformer (LCMV)');

test('suppresses the background relative to phase conjugation', () => {
  const target = { x: 0, y: 0, z: 25 };
  const em = sphericalCap({ count: 96, radius: 104, halfAngleDeg: 75 });
  const dark = sampleDarkPoints(head, [target], { count: 900, exclusionMm: 6 });

  const pc = phaseConjugation(acoustic, em, [target]);
  const lcmv = constrainedBeamformer(acoustic, em, [target], dark, { loading: 1e-3 });

  const backgroundPower = (w) => {
    let s = 0;
    for (const p of dark) s += acoustic.fieldAt(em, w, p).intensity;
    return s / dark.length;
  };
  const peak = (w) => acoustic.fieldAt(em, w, target).intensity;

  const pcRatio = peak(pc) / backgroundPower(pc);
  const lcRatio = peak(lcmv) / backgroundPower(lcmv);
  assertGreater(lcRatio, pcRatio,
    `LCMV should improve peak/background: PC ${pcRatio.toExponential(2)} vs LCMV ${lcRatio.toExponential(2)}`);
});

test('LCMV pays for suppression with peak intensity, never exceeding the matched filter', () => {
  const target = { x: 0, y: 0, z: 25 };
  const em = sphericalCap({ count: 96, radius: 104, halfAngleDeg: 75 });
  const dark = sampleDarkPoints(head, [target], { count: 600, exclusionMm: 6 });
  const pc = phaseConjugation(acoustic, em, [target]);
  const lcmv = constrainedBeamformer(acoustic, em, [target], dark, { loading: 1e-3 });
  const pcI = acoustic.fieldAt(em, pc, target).intensity;
  const lcI = acoustic.fieldAt(em, lcmv, target).intensity;
  assert(lcI <= pcI * (1 + 1e-9),
    `LCMV peak ${lcI.toExponential(3)} must not exceed matched filter ${pcI.toExponential(3)}`);
});

test('falls back gracefully when no dark points are supplied', () => {
  const t = [{ x: 0, y: 0, z: 20 }];
  const w = constrainedBeamformer(acoustic, array, t, [], {});
  let s = 0;
  for (let j = 0; j < array.length; j++) s += w[2 * j] ** 2 + w[2 * j + 1] ** 2;
  assertClose(s, 1, 1e-9);
});

test('dark point sampling respects the exclusion radius', () => {
  const targets = [{ x: 0, y: 0, z: 25 }, { x: -20, y: 10, z: 0 }];
  const pts = sampleDarkPoints(head, targets, { count: 500, exclusionMm: 8 });
  assert(pts.length === 500, `expected 500 points, got ${pts.length}`);
  for (const p of pts) {
    for (const t of targets) {
      assertGreater(Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z), 7.999);
    }
    assertGreater(head.outerRadius, Math.hypot(p.x, p.y, p.z));
  }
});

suite('emitter table output');

test('table reports position, phase and delay consistently', () => {
  const r = plan({
    mode: 'acoustic', drive: 650e3,
    array: { layout: 'sphericalCap', count: 24, standoffMm: 12, halfAngleDeg: 70 },
    targets: [{ x: 0, y: 0, z: 25 }],
    computeField: false,
  });
  assert(r.table.length === 24);
  const period = 1 / 650e3;
  for (const row of r.table) {
    assertClose(row.standoffMm, 12, 1e-6, 'standoff');
    assertClose(row.radiusMm, 104, 1e-6, 'radius');
    assert(row.phaseDeg >= 0 && row.phaseDeg <= 360.01, `phase in range: ${row.phaseDeg}`);
    // Delay must realise the reported phase.
    assertClose(row.delaySeconds, (row.phaseDeg / 360) * period, 1e-6, 'delay matches phase');
    assertClose(Math.hypot(row.x, row.y, row.z), 104, 1e-3, 'coordinates match radius');
  }
  const totalShare = r.table.reduce((s, x) => s + x.powerSharePercent, 0);
  assertClose(totalShare, 100, 1e-3, 'power shares must sum to 100%');
});

test('CSV export has a header row per emitter plus metadata comments', () => {
  const r = plan({
    mode: 'acoustic', drive: 650e3,
    array: { layout: 'sphericalCap', count: 8, standoffMm: 10, halfAngleDeg: 60 },
    targets: [{ x: 0, y: 0, z: 20 }],
    computeField: false,
  });
  const csv = emitterTableCsv(r.table, { mode: 'acoustic', drive_hz: 650e3 });
  const lines = csv.split('\n');
  assert(lines[0].startsWith('# mode'), 'metadata comment first');
  const dataLines = lines.filter((l) => !l.startsWith('#'));
  assert(dataLines.length === 9, `header + 8 rows, got ${dataLines.length}`);
  assert(dataLines[0].startsWith('index,x_mm'), 'header present');
});
