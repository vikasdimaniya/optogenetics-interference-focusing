/**
 * Field computation worker.
 *
 * Runs the whole planning pipeline off the main thread so dragging a slider
 * never freezes the page, and posts back a plain-data payload.
 */

import { plan } from '../src/api.js';
import { HeadModel } from '../src/head-model.js';
import { PropagationModel } from '../src/propagation.js';

/** 1-D intensity profile through a point along a direction. */
function profileAlong(model, emitters, weights, centre, dir, halfWidthMm, samples = 240) {
  const m = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const u = { x: dir.x / m, y: dir.y / m, z: dir.z / m };
  const values = new Float32Array(samples);
  const positions = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const s = -halfWidthMm + (2 * halfWidthMm * i) / (samples - 1);
    positions[i] = s;
    values[i] = model.fieldAt(emitters, weights, {
      x: centre.x + s * u.x, y: centre.y + s * u.y, z: centre.z + s * u.z,
    }).intensity;
  }
  return { values, positions, halfWidthMm };
}

function serialiseFindings(findings) {
  return findings.map((f) => ({
    severity: f.severity, code: f.code, title: f.title, detail: f.detail,
    numbers: f.numbers ?? {},
  }));
}

self.onmessage = (ev) => {
  const { id, cfg } = ev.data;
  try {
    const r = plan(cfg);

    const target = cfg.targets[0];
    const rad = Math.hypot(target.x, target.y, target.z);
    const radial = rad > 1e-9
      ? { x: target.x / rad, y: target.y / rad, z: target.z / rad }
      : { x: 0, y: 0, z: 1 };
    // Transverse direction inside the slice plane.
    const transverse = r.slice.axisU;

    const halfWidth = cfg.mode === 'acoustic' ? 25 : 10;
    const profiles = r.shape.peakModelIntensity > 0 ? {
      radial: profileAlong(r.model, r.emitters, r.weights, target, radial, halfWidth),
      transverse: profileAlong(r.model, r.emitters, r.weights, target, transverse, halfWidth),
    } : null;

    const payload = {
      id,
      ok: true,
      config: cfg,
      shells: r.head.describe(),
      headOuterRadius: r.head.outerRadius,
      brainRadiusMm: r.brainRadiusMm,
      emitters: r.emitters.map((e) => ({ x: e.x, y: e.y, z: e.z })),
      targets: cfg.targets,
      table: r.table,
      slice: {
        plane: r.slice.plane,
        origin: r.slice.origin,
        axisU: r.slice.axisU,
        axisV: r.slice.axisV,
        nu: r.slice.nu, nv: r.slice.nv,
        extentU: r.slice.extentU, extentV: r.slice.extentV,
        maskRadiusMm: r.slice.maskRadiusMm,
      },
      field: {
        intensity: r.field.intensity,
        mask: r.field.mask,
        nu: r.field.nu, nv: r.field.nv,
        max: r.field.max,
      },
      brainMask: r.brainMask,
      shape: r.shape,
      stats: r.stats,
      hotspots: r.hotspots ? {
        max: r.hotspots.max,
        spots: r.hotspots.spots.map((s) => ({ u: s.u, v: s.v, value: s.value })),
      } : null,
      targetingError: r.targetingError,
      extracranialPeak: r.extracranialPeak,
      profiles,
      assessment: {
        verdict: r.assessment.verdict,
        worstSeverity: r.assessment.worstSeverity,
        counts: r.assessment.counts,
        findings: serialiseFindings(r.assessment.findings),
        coherence: r.assessment.coherence,
        budget: r.assessment.budget,
        thermal: r.assessment.thermal,
        diffraction: r.assessment.diffraction,
        gratingLobes: r.assessment.gratingLobes,
        pitchMm: r.assessment.pitchMm,
        opsin: r.assessment.opsin,
        targetIrradiance: r.assessment.targetIrradiance,
      },
      // Layer properties at the chosen drive, for the readout panel.
      layers: r.model.props.map((p, i) => ({
        layer: p.layer, name: p.name,
        wavelengthInMediumMm: p.wavelengthInMediumMm,
        mua: p.mua ?? null, mus: p.mus ?? null, musp: p.musp ?? null,
        muEff: p.muEff ?? null,
        muAmp: p.muAmp,
        speed: p.speed ?? null,
        penetrationDepthMm: p.penetrationDepthMm,
        transportMeanFreePathMm: p.transportMeanFreePathMm,
        thickness: r.head.describe()[i].thickness,
      })),
    };

    const transfer = [
      payload.field.intensity.buffer,
      payload.field.mask.buffer,
      payload.brainMask.buffer,
    ];
    if (profiles) {
      transfer.push(profiles.radial.values.buffer, profiles.radial.positions.buffer);
      transfer.push(profiles.transverse.values.buffer, profiles.transverse.positions.buffer);
    }
    self.postMessage(payload, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.stack ? err.stack : err) });
  }
};
