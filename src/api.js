/**
 * Top-level planner API.
 *
 * One call in, a complete answer out: emitter coordinates, drive phases, the
 * resulting field, the focus metrics, and an honest feasibility assessment.
 *
 *   import { plan } from './src/api.js';
 *   const result = plan({
 *     mode: 'acoustic',
 *     drive: 650e3,
 *     head: 'humanAdult',
 *     array: { layout: 'sphericalCap', count: 256, standoffMm: 12, halfAngleDeg: 75 },
 *     targets: [{ x: 0, y: 0, z: 25 }],
 *     solver: 'phaseConjugation',
 *   });
 */

import { HeadModel } from './head-model.js';
import { PropagationModel } from './propagation.js';
import { buildArray } from './array-geometry.js';
import {
  phaseConjugation, weightedGerchbergSaxton, constrainedBeamformer, sampleDarkPoints,
} from './solvers.js';
import {
  focusShape, sliceStatistics, findHotspots, targetingError,
  maskByRadius, extracranialPeak,
} from './metrics.js';
import { assess } from './feasibility.js';

export const PLANES = {
  /** Horizontal cut (constant z). u = +x, v = +y */
  axial: { axisU: { x: 1, y: 0, z: 0 }, axisV: { x: 0, y: 1, z: 0 }, normal: 'z' },
  /** Front-facing cut (constant y). u = +x, v = +z */
  coronal: { axisU: { x: 1, y: 0, z: 0 }, axisV: { x: 0, y: 0, z: 1 }, normal: 'y' },
  /** Side cut (constant x). u = +y, v = +z */
  sagittal: { axisU: { x: 0, y: 1, z: 0 }, axisV: { x: 0, y: 0, z: 1 }, normal: 'x' },
};

/**
 * Build a slice specification that passes through `through`.
 * @param {HeadModel} head
 * @param {'axial'|'coronal'|'sagittal'} plane
 * @param {{x,y,z}} through
 * @param {object} [opts]  {resolution, marginMm}
 */
export function makeSlice(head, plane, through, opts = {}) {
  const { resolution = 200, marginMm = 8 } = opts;
  const p = PLANES[plane];
  if (!p) throw new Error(`unknown plane: ${plane}`);
  const extent = 2 * (head.outerRadius + marginMm);
  return {
    plane,
    origin: { ...through },
    axisU: p.axisU,
    axisV: p.axisV,
    nu: resolution,
    nv: resolution,
    extentU: extent,
    extentV: extent,
    // Everything outside the head is masked out. Without this, pixels that
    // stray near the emitter shell hit the 1/d singularity of the point-source
    // Green's function and dominate every metric.
    maskRadiusMm: opts.maskRadiusMm ?? head.outerRadius,
  };
}

/** Convert a slice pixel index to a 3-D point. */
export function slicePointAt(slice, iu, iv) {
  const du = slice.extentU / (slice.nu - 1 || 1);
  const dv = slice.extentV / (slice.nv - 1 || 1);
  const su = -slice.extentU / 2 + iu * du;
  const sv = -slice.extentV / 2 + iv * dv;
  return {
    x: slice.origin.x + su * slice.axisU.x + sv * slice.axisV.x,
    y: slice.origin.y + su * slice.axisU.y + sv * slice.axisV.y,
    z: slice.origin.z + su * slice.axisU.z + sv * slice.axisV.z,
  };
}

const SOLVER_FNS = {
  phaseConjugation,
  weightedGS: weightedGerchbergSaxton,
  lcmv: constrainedBeamformer,
};

/**
 * Run a solver and return weights.
 * Exposed separately so the UI can re-solve without recomputing the field.
 */
export function solve(model, emitters, targets, solverName, opts = {}) {
  const fn = SOLVER_FNS[solverName];
  if (!fn) throw new Error(`unknown solver: ${solverName}`);
  if (solverName === 'lcmv') {
    const darkPoints = opts.darkPoints ?? sampleDarkPoints(model.head, targets, {
      count: opts.darkCount ?? 1200,
      exclusionMm: opts.exclusionMm ?? Math.max(2, (opts.spotSizeMm ?? 2) * 1.5),
    });
    return constrainedBeamformer(model, emitters, targets, darkPoints, opts);
  }
  return fn(model, emitters, targets, opts);
}

/**
 * The emitter placement table: what you would hand to whoever builds the rig.
 *
 * Phase is reported both as an angle and as a physical delay, because an
 * acoustic array is driven with delays and an optical one with phase.
 */
export function emitterTable(model, emitters, weights, head) {
  const N = emitters.length;
  let maxAmp = 0;
  for (let j = 0; j < N; j++) {
    const a = Math.hypot(weights[2 * j], weights[2 * j + 1]);
    if (a > maxAmp) maxAmp = a;
  }
  const totalPower = (() => {
    let s = 0;
    for (let j = 0; j < N; j++) s += weights[2 * j] ** 2 + weights[2 * j + 1] ** 2;
    return s || 1;
  })();

  const period = model.mode === 'acoustic'
    ? 1 / model.drive                                  // seconds
    : (model.drive * 1e-6) / 2.998e11;                 // seconds, lambda/c

  return emitters.map((e, j) => {
    const re = weights[2 * j], im = weights[2 * j + 1];
    const amp = Math.hypot(re, im);
    let phase = Math.atan2(im, re);
    if (phase < 0) phase += 2 * Math.PI;
    const r = Math.hypot(e.x, e.y, e.z);
    return {
      index: j,
      x: +e.x.toFixed(3),
      y: +e.y.toFixed(3),
      z: +e.z.toFixed(3),
      radiusMm: +r.toFixed(3),
      // Polar angle from +z (vertex), azimuth from +x toward +y.
      thetaDeg: +((Math.acos(Math.min(1, Math.max(-1, e.z / r))) * 180) / Math.PI).toFixed(2),
      phiDeg: +(((Math.atan2(e.y, e.x) * 180) / Math.PI + 360) % 360).toFixed(2),
      standoffMm: +(r - head.outerRadius).toFixed(3),
      relativeAmplitude: +(maxAmp > 0 ? amp / maxAmp : 0).toFixed(5),
      powerSharePercent: +((100 * (re * re + im * im)) / totalPower).toFixed(4),
      phaseDeg: +((phase * 180) / Math.PI).toFixed(2),
      // Delay that realises this phase: t = phase/(2*pi) * period
      delaySeconds: (phase / (2 * Math.PI)) * period,
      delayNs: +(((phase / (2 * Math.PI)) * period) * 1e9).toFixed(4),
    };
  });
}

/** CSV export of the emitter table. */
export function emitterTableCsv(rows, meta = {}) {
  const header = [
    'index', 'x_mm', 'y_mm', 'z_mm', 'radius_mm', 'theta_deg', 'phi_deg',
    'standoff_mm', 'relative_amplitude', 'power_share_percent', 'phase_deg', 'delay_ns',
  ];
  const lines = [];
  for (const [k, v] of Object.entries(meta)) lines.push(`# ${k}: ${v}`);
  lines.push(header.join(','));
  for (const r of rows) {
    lines.push([
      r.index, r.x, r.y, r.z, r.radiusMm, r.thetaDeg, r.phiDeg,
      r.standoffMm, r.relativeAmplitude, r.powerSharePercent, r.phaseDeg, r.delayNs,
    ].join(','));
  }
  return lines.join('\n');
}

/**
 * Full planning run.
 *
 * @param {object} cfg
 * @param {'optical'|'acoustic'} cfg.mode
 * @param {number} cfg.drive                 nm (optical) | Hz (acoustic)
 * @param {string|object} [cfg.head]         preset name or HeadModel spec
 * @param {object} cfg.array                 see buildArray
 * @param {Array<{x,y,z,weight?}>} cfg.targets
 * @param {string} [cfg.solver]
 * @param {string} [cfg.opsin]
 * @param {object} [cfg.slice]               {plane, resolution, marginMm}
 * @param {boolean} [cfg.computeField=true]
 * @param {number} [cfg.targetIrradiance]    W/mm^2 wanted at the focus
 */
export function plan(cfg) {
  const {
    mode = 'optical',
    drive = mode === 'acoustic' ? 650e3 : 630,
    targets = [{ x: 0, y: 0, z: 0 }],
    solver = 'phaseConjugation',
    opsin = 'ChRmine',
    computeField = true,
    coherent = true,
  } = cfg;

  const head = typeof cfg.head === 'string' || cfg.head === undefined
    ? HeadModel.preset(cfg.head ?? 'humanAdult', {
      couplingLayer: mode === 'acoustic' ? 'water' : null,
    })
    : new HeadModel(cfg.head, { couplingLayer: mode === 'acoustic' ? 'water' : null });

  const model = new PropagationModel({ mode, drive, head, coherent });
  const emitters = buildArray(cfg.array ?? {
    layout: 'sphericalCap', count: 128, standoffMm: 10, halfAngleDeg: 70,
  }, head);

  const solverOpts = { ...(cfg.solverOptions ?? {}) };
  if (solver === 'lcmv' && !solverOpts.darkPoints) {
    solverOpts.darkPoints = sampleDarkPoints(head, targets, {
      count: solverOpts.darkCount ?? 1200,
      exclusionMm: solverOpts.exclusionMm ?? 3,
    });
  }
  const weights = solve(model, emitters, targets, solver, solverOpts);

  const primary = targets[0];
  const shape = focusShape(model, emitters, weights, primary, {
    stepMm: cfg.fwhmStepMm ?? (mode === 'acoustic' ? 0.05 : 0.02),
    maxMm: 50,
  });

  const brainRadius = head.shells.find((s) => s.layer === 'greyMatter')?.outerRadius
    ?? head.outerRadius * 0.85;

  let field = null, stats = null, hotspots = null, error = null, slice = null;
  let brainMask = null, outside = null;
  if (computeField) {
    slice = makeSlice(head, cfg.slice?.plane ?? 'coronal', primary, cfg.slice);
    field = model.computeSlice(emitters, weights, slice);
    // Metrics are evaluated over BRAIN tissue only. Energy in the skull and
    // scalp is reported separately by extracranialPeak - it is a real and
    // important quantity, but it is not a targeting error.
    brainMask = maskByRadius(field.radius, brainRadius);
    outside = extracranialPeak(field.intensity, field.radius, brainRadius, head.outerRadius);
    stats = sliceStatistics(field.intensity, slice.nu, slice.nv, { mask: brainMask });
    hotspots = findHotspots(field.intensity, slice.nu, slice.nv, {
      relThreshold: cfg.hotspotThreshold ?? 0.5,
      mask: brainMask,
    });
    error = targetingError(
      model, emitters, weights, primary, slice, field.intensity, brainMask,
    );
  }

  const assessment = assess({
    model, emitters, weights, target: primary, shape,
    sliceStats: stats, hotspots, opsin,
    extracranialPeak: outside, brainRadiusMm: brainRadius,
    sourceType: cfg.sourceType,
    layout: (cfg.array ?? {}).layout ?? 'sphericalCap',
    targetIrradiance: cfg.targetIrradiance,
    emitterApertureMm2: cfg.emitterApertureMm2 ?? 25,
  });

  return {
    config: { mode, drive, solver, opsin, targets },
    head, model, emitters, weights,
    slice, field, stats, hotspots, targetingError: error,
    brainMask, extracranialPeak: outside, brainRadiusMm: brainRadius,
    shape, assessment,
    table: emitterTable(model, emitters, weights, head),
  };
}

/** Compact text summary, for CLI use and for the README examples. */
export function summarise(result) {
  const a = result.assessment;
  const lines = [];
  const pad = (s, n) => String(s).padEnd(n);
  lines.push(`VERDICT: ${a.verdict.toUpperCase()}`);
  lines.push('');
  lines.push(`  mode            ${result.config.mode}`);
  lines.push(`  drive           ${result.config.mode === 'acoustic'
    ? `${(result.config.drive / 1e3).toFixed(0)} kHz` : `${result.config.drive} nm`}`);
  lines.push(`  emitters        ${result.emitters.length}`);
  lines.push(`  solver          ${result.config.solver}`);
  lines.push(`  target depth    ${a.coherence.depthMm.toFixed(1)} mm below scalp`);
  lines.push(`  array pitch     ${a.pitchMm.toFixed(2)} mm`);
  const hasField = result.shape.peakModelIntensity > 0;
  if (!hasField) {
    lines.push('  focus           none - coherent field underflows to zero at the target');
  } else {
    if (Number.isFinite(result.shape.lateralFwhmMm)) {
      lines.push(`  focus (FWHM)    ${result.shape.lateralFwhmMm.toFixed(2)} mm lateral, `
        + `${result.shape.axialFwhmMm.toFixed(2)} mm axial`);
    }
    if (result.stats) {
      lines.push(`  peak/background ${Number.isFinite(result.stats.peakToBackground)
        ? result.stats.peakToBackground.toFixed(1) : 'inf'}`);
      lines.push(`  hotspots >50%   ${result.hotspots.spots.length}`);
    }
    if (result.targetingError) {
      lines.push(`  targeting error ${result.targetingError.errorMm.toFixed(3)} mm`);
    }
  }
  lines.push('');
  for (const f of a.findings) {
    lines.push(`  [${pad(f.severity.toUpperCase(), 7)}] ${f.title}`);
  }
  return lines.join('\n');
}
