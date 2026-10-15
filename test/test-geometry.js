import {
  suite, test, assert, assertClose, assertAbsClose, assertGreater, groupHeader,
} from './harness.js';
import { HeadModel } from '../src/head-model.js';
import { PropagationModel } from '../src/propagation.js';
import {
  sphericalCap, fullSphere, rings, meanPitch, apertureHalfAngle,
  gratingLobes, diffractionLimit, buildArray,
} from '../src/array-geometry.js';

groupHeader('Geometry and the fast path integral');
suite('head-model');

const head = HeadModel.preset('humanAdult');

test('shells are ordered and thicknesses sum to the outer radius', () => {
  const d = head.describe();
  assertClose(d[0].outerRadius, 92, 1e-12);
  let sum = 0;
  for (const s of d) sum += s.thickness;
  // Shells are contiguous from the innermost radius out to the scalp.
  assertClose(sum, 92, 1e-12, 'shell thicknesses should tile [0, 92]');
  assertClose(head.thicknessOf('scalp'), 6, 1e-12);
  assertClose(head.thicknessOf('skull'), 7, 1e-12);
});

test('layerAtRadius identifies every shell including the centre', () => {
  assert(head.layerAtRadius(95) === null, 'outside the head is null');
  assert(head.layerAtRadius(90) === 'scalp');
  assert(head.layerAtRadius(82) === 'skull');
  assert(head.layerAtRadius(78) === 'csf');
  assert(head.layerAtRadius(70) === 'greyMatter');
  assert(head.layerAtRadius(10) === 'whiteMatter');
  assert(head.layerAtRadius(0) === 'whiteMatter', 'centre must resolve');
});

test('segmentPath lengths sum to the euclidean distance', () => {
  const a = { x: 0, y: 0, z: 120 };
  const b = { x: 5, y: -8, z: 20 };
  const segs = head.segmentPath(a, b);
  const total = segs.reduce((s, x) => s + x.length, 0);
  assertClose(total, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), 1e-10);
});

test('a ray to the centre crosses each shell exactly once', () => {
  const segs = head.segmentPath({ x: 0, y: 0, z: 150 }, { x: 0, y: 0, z: 0 });
  const layers = segs.map((s) => s.layer);
  assert(layers[0] === null, 'starts outside');
  assert(JSON.stringify(layers.slice(1))
    === JSON.stringify(['scalp', 'skull', 'csf', 'greyMatter', 'whiteMatter']),
  `unexpected layer order: ${layers}`);
  // Thicknesses should equal the shell thicknesses for a radial ray.
  assertClose(segs[1].length, 6, 1e-9, 'scalp');
  assertClose(segs[2].length, 7, 1e-9, 'skull');
  assertClose(segs[3].length, 2, 1e-9, 'csf');
});

test('a chord that misses the brain never reports brain layers', () => {
  // Tangent-ish ray grazing the scalp only.
  const segs = head.segmentPath({ x: -200, y: 0, z: 90 }, { x: 200, y: 0, z: 90 });
  const layers = new Set(segs.map((s) => s.layer));
  assert(!layers.has('greyMatter'), 'should not reach grey matter');
  assert(!layers.has('whiteMatter'), 'should not reach white matter');
  assert(layers.has('scalp'), 'should graze scalp');
});

// ---------------------------------------------------------------------------
suite('path integral kernel');

/**
 * Brute-force reference: segment the path with HeadModel and accumulate using
 * the same per-layer weights the PropagationModel uses. If the closed-form
 * kernel disagrees with this, the kernel is wrong.
 */
function referencePathIntegral(model, emitter, point) {
  const segs = model.head.segmentPath(emitter, point);
  let phasePath = 0, atten = 0;
  for (const s of segs) {
    if (s.layer === null) {
      phasePath += model.couplingPhaseWeight * s.length;
      atten += model.couplingMuAmp * s.length;
      continue;
    }
    const idx = model.shells.findIndex((sh) => sh.layer === s.layer);
    phasePath += model.phaseWeights[idx] * s.length;
    atten += model.muAmp[idx] * s.length;
  }
  return { phasePath, atten };
}

test('closed-form kernel matches brute-force segmentation (optical)', () => {
  const model = new PropagationModel({ mode: 'optical', drive: 630, head });
  const emitters = sphericalCap({ count: 24, radius: 102, halfAngleDeg: 80 });
  const scratch = PropagationModel.scratch();
  let worstPhase = 0, worstAtten = 0;
  let checked = 0;

  const points = [];
  for (let i = 0; i < 40; i++) {
    const r = 76 * Math.cbrt((i + 0.5) / 40);
    const cz = 2 * (((i * 37) % 41) / 41) - 1;
    const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
    const phi = (i * 2.399963);
    points.push({ x: r * sz * Math.cos(phi), y: r * sz * Math.sin(phi), z: r * cz });
  }

  for (const e of emitters) {
    for (const p of points) {
      const ra2 = e.x ** 2 + e.y ** 2 + e.z ** 2;
      const rb2 = p.x ** 2 + p.y ** 2 + p.z ** 2;
      const abDot = e.x * p.x + e.y * p.y + e.z * p.z;
      model.pathIntegral(abDot, ra2, rb2, scratch);
      const ref = referencePathIntegral(model, e, p);
      worstPhase = Math.max(worstPhase, Math.abs(scratch[1] - ref.phasePath));
      worstAtten = Math.max(worstAtten, Math.abs(scratch[2] - ref.atten));
      checked++;
    }
  }
  assertGreater(checked, 900, 'should have checked ~960 pairs');
  // Phase path must agree to well under a wavelength: lambda_0 = 6.3e-4 mm.
  assert(worstPhase < 1e-9, `worst optical-path mismatch ${worstPhase} mm`);
  assert(worstAtten < 1e-9, `worst attenuation mismatch ${worstAtten}`);
});

test('closed-form kernel matches brute-force segmentation (acoustic)', () => {
  const model = new PropagationModel({ mode: 'acoustic', drive: 650e3, head });
  const emitters = rings({ count: 32, radius: 112, halfAngleDeg: 75, ringCount: 4 });
  const scratch = PropagationModel.scratch();
  let worst = 0;
  for (const e of emitters) {
    for (let i = 0; i < 25; i++) {
      const p = { x: -40 + 3.1 * i, y: 7 - 0.9 * i, z: 30 - 2.2 * i };
      const ra2 = e.x ** 2 + e.y ** 2 + e.z ** 2;
      const rb2 = p.x ** 2 + p.y ** 2 + p.z ** 2;
      const abDot = e.x * p.x + e.y * p.y + e.z * p.z;
      model.pathIntegral(abDot, ra2, rb2, scratch);
      const ref = referencePathIntegral(model, e, p);
      worst = Math.max(worst, Math.abs(scratch[1] - ref.phasePath));
    }
  }
  assert(worst < 1e-9, `worst acoustic path mismatch ${worst} mm`);
});

test('kernel reports the straight-line distance', () => {
  const model = new PropagationModel({ mode: 'optical', drive: 800, head });
  const scratch = PropagationModel.scratch();
  const e = { x: 0, y: 0, z: 102 };
  const p = { x: 12, y: -5, z: 30 };
  const ra2 = e.z ** 2;
  const rb2 = p.x ** 2 + p.y ** 2 + p.z ** 2;
  model.pathIntegral(e.x * p.x + e.y * p.y + e.z * p.z, ra2, rb2, scratch);
  assertClose(scratch[0], Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z), 1e-12);
});

test('trig lookup table agrees with Math.sin/cos', async () => {
  const { fastSin, fastCos } = await import('../src/propagation.js');
  let worst = 0;
  for (let i = 0; i < 20000; i++) {
    const phase = (i * 0.37194) - 1000;
    worst = Math.max(
      worst,
      Math.abs(fastSin(phase) - Math.sin(phase)),
      Math.abs(fastCos(phase) - Math.cos(phase)),
    );
  }
  assert(worst < 1e-4, `LUT error ${worst} too large`);
});

// ---------------------------------------------------------------------------
suite('array geometry');

test('spherical cap places all emitters on the shell inside the cap', () => {
  const em = sphericalCap({ count: 64, radius: 102, halfAngleDeg: 60 });
  assert(em.length === 64);
  for (const e of em) {
    assertClose(Math.hypot(e.x, e.y, e.z), 102, 1e-10, 'on shell');
    const cosTheta = e.z / 102;
    assert(cosTheta >= Math.cos((60 * Math.PI) / 180) - 1e-9, 'within cap');
    assertAbsClose(Math.hypot(e.nx, e.ny, e.nz), 1, 1e-10, 'unit normal');
    assert(e.nx * e.x + e.ny * e.y + e.nz * e.z < 0, 'normal points inward');
  }
});

test('ring layout yields exactly the requested element count', () => {
  for (const n of [16, 31, 64, 127, 256]) {
    const em = rings({ count: n, radius: 110, halfAngleDeg: 70, ringCount: 5 });
    assert(em.length === n, `asked ${n}, got ${em.length}`);
  }
});

test('full sphere covers both poles', () => {
  const em = fullSphere({ count: 200, radius: 100 });
  const zs = em.map((e) => e.z);
  assertGreater(Math.max(...zs), 95);
  assertGreater(-95, Math.min(...zs));
});

test('buildArray honours standoff', () => {
  const em = buildArray({ layout: 'sphericalCap', count: 8, standoffMm: 10, halfAngleDeg: 50 }, head);
  for (const e of em) assertClose(Math.hypot(e.x, e.y, e.z), 102, 1e-10);
});

test('mean pitch shrinks as the square root of element count', () => {
  const a = meanPitch(sphericalCap({ count: 64, radius: 100, halfAngleDeg: 70 }));
  const b = meanPitch(sphericalCap({ count: 256, radius: 100, halfAngleDeg: 70 }));
  // 4x the elements over the same area -> about half the pitch.
  assertClose(a / b, 2, 0.2, 'pitch should halve for 4x elements');
});

test('aperture half-angle grows as the target approaches the array', () => {
  const em = sphericalCap({ count: 128, radius: 102, halfAngleDeg: 70 });
  const deep = apertureHalfAngle(em, { x: 0, y: 0, z: 0 });
  const shallow = apertureHalfAngle(em, { x: 0, y: 0, z: 60 });
  assertGreater(shallow, deep, 'shallower target sees a wider aperture');
});

suite('diffraction and grating lobes');

test('grating lobe count follows pitch/wavelength', () => {
  // Nyquist-sampled array: one main lobe only.
  const fine = gratingLobes(0.4, 1.0);
  assert(fine.singleLobe, 'd = lambda/2.5 must be single-lobe');
  assert(fine.lobeCount === 0, 'no grating lobes below Nyquist');

  // Grossly undersampled: a forest of lobes.
  const coarse = gratingLobes(20, 0.00063); // 20 mm pitch, 630 nm light
  assertGreater(coarse.lobeCount, 1000, 'optical array on a head is wildly undersampled');

  const us = gratingLobes(4, 3.08); // 4 mm pitch, 500 kHz ultrasound
  assert(us.lobeCount === 1, `expected 1 grating lobe, got ${us.lobeCount}`);
});

test('diffraction-limited spot scales with wavelength over NA', () => {
  const a = diffractionLimit(0.00063, Math.PI / 4, 1.37);
  const b = diffractionLimit(0.00126, Math.PI / 4, 1.37);
  assertClose(b.lateralFwhmMm / a.lateralFwhmMm, 2, 1e-9, 'doubling lambda doubles the spot');
  // Axial extent is always worse than lateral for NA < 1.
  assertGreater(a.axialFwhmMm, a.lateralFwhmMm);
});

test('red light through a wide aperture is diffraction-limited far below a millimetre', () => {
  // This is the point that makes the premise initially so attractive:
  // DIFFRACTION is not the obstacle for optical targeting.
  const d = diffractionLimit(0.00063, (70 * Math.PI) / 180, 1.37);
  assert(d.lateralFwhmMm < 0.001, `expected sub-micron, got ${d.lateralFwhmMm} mm`);
});

test('500 kHz ultrasound is diffraction-limited at about a millimetre', () => {
  const d = diffractionLimit(3.08, (50 * Math.PI) / 180, 1.0);
  assert(d.lateralFwhmMm > 1 && d.lateralFwhmMm < 3,
    `expected ~2 mm, got ${d.lateralFwhmMm}`);
});
