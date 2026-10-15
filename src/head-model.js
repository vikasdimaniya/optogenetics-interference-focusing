/**
 * Layered spherical head model and straight-ray path segmentation.
 *
 * APPROXIMATION, stated up front: rays travel in straight lines. Refraction /
 * speed-of-sound bending at the shell interfaces is NOT traced. What IS modelled
 * is the per-layer optical path length (so the phase budget is right to first
 * order) and the per-layer attenuation.
 *
 * Why that is defensible:
 *  - For ULTRASOUND this is exactly the first-order aberration correction used
 *    in clinical transcranial focused ultrasound: per-element time-of-flight
 *    computed from a CT-derived speed-of-sound map along straight rays
 *    (Clement & Hynynen, Phys Med Biol 47:1219, 2002). Real systems then refine
 *    it, but straight-ray gets you most of the way.
 *  - For LIGHT the refraction error is irrelevant to the conclusion, because
 *    scattering destroys the coherent field by ~200 orders of magnitude before
 *    a few degrees of ray bending could matter.
 *
 * Coordinates: millimetres, origin at head centre, +z toward the vertex
 * (top of head), +y anterior, +x to the subject's right.
 */

import { HEAD_PRESETS } from './constants.js';

export class HeadModel {
  /**
   * @param {{shells: {layer: string, outerRadius: number}[], name?: string}} spec
   * @param {object} [opts]
   * @param {string} [opts.couplingLayer] layer key used outside the head
   *   ('air' for optical, 'water' for acoustic)
   */
  constructor(spec, opts = {}) {
    this.name = spec.name ?? 'custom';
    // Enforce outermost-first ordering with strictly decreasing radii.
    this.shells = [...spec.shells].sort((a, b) => b.outerRadius - a.outerRadius);
    for (let i = 1; i < this.shells.length; i++) {
      if (this.shells[i].outerRadius >= this.shells[i - 1].outerRadius) {
        throw new Error('HeadModel shells must have strictly decreasing radii');
      }
    }
    this.outerRadius = this.shells[0].outerRadius;
    this.couplingLayer = opts.couplingLayer ?? null;
    this.ref = spec.ref;
  }

  static preset(name, opts) {
    const spec = HEAD_PRESETS[name];
    if (!spec) throw new Error(`unknown head preset: ${name}`);
    return new HeadModel(spec, opts);
  }

  /** Layer key at a given radius, or null if outside the head. */
  layerAtRadius(r) {
    if (r > this.outerRadius) return this.couplingLayer;
    for (let i = 0; i < this.shells.length; i++) {
      const inner = i + 1 < this.shells.length ? this.shells[i + 1].outerRadius : 0;
      if (r <= this.shells[i].outerRadius && r > inner) return this.shells[i].layer;
    }
    // r === 0 falls through to the innermost shell.
    return this.shells[this.shells.length - 1].layer;
  }

  layerAtPoint(p) {
    return this.layerAtRadius(Math.hypot(p.x, p.y, p.z));
  }

  isInside(p) {
    return Math.hypot(p.x, p.y, p.z) <= this.outerRadius;
  }

  /** Thickness of a named shell, mm. */
  thicknessOf(layerKey) {
    const i = this.shells.findIndex((s) => s.layer === layerKey);
    if (i < 0) return 0;
    const inner = i + 1 < this.shells.length ? this.shells[i + 1].outerRadius : 0;
    return this.shells[i].outerRadius - inner;
  }

  /**
   * Segment the straight line from `a` to `b` into per-layer lengths.
   *
   * @returns {{layer: string|null, length: number}[]} in travel order,
   *   merged so consecutive identical layers are combined.
   */
  segmentPath(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dd = dx * dx + dy * dy + dz * dz;
    const total = Math.sqrt(dd);
    if (total === 0) return [];

    const ad = a.x * dx + a.y * dy + a.z * dz;
    const aa = a.x * a.x + a.y * a.y + a.z * a.z;

    // Crossing parameters with every shell boundary.
    const ts = [0, 1];
    for (const shell of this.shells) {
      const R = shell.outerRadius;
      const c = aa - R * R;
      const disc = ad * ad - dd * c;
      if (disc <= 0) continue;
      const sq = Math.sqrt(disc);
      for (const t of [(-ad - sq) / dd, (-ad + sq) / dd]) {
        if (t > 1e-12 && t < 1 - 1e-12) ts.push(t);
      }
    }
    ts.sort((x, y) => x - y);

    const out = [];
    for (let i = 0; i < ts.length - 1; i++) {
      const t0 = ts[i], t1 = ts[i + 1];
      const len = (t1 - t0) * total;
      if (len < 1e-9) continue;
      const tm = 0.5 * (t0 + t1);
      const r = Math.hypot(a.x + tm * dx, a.y + tm * dy, a.z + tm * dz);
      const layer = this.layerAtRadius(r);
      const last = out[out.length - 1];
      if (last && last.layer === layer) last.length += len;
      else out.push({ layer, length: len });
    }
    return out;
  }

  /**
   * Interfaces crossed along the straight line a->b, in travel order.
   * Used for Fresnel / impedance transmission losses.
   * @returns {{from: string|null, to: string|null}[]}
   */
  interfacesAlong(a, b) {
    const segs = this.segmentPath(a, b);
    const out = [];
    for (let i = 0; i < segs.length - 1; i++) {
      out.push({ from: segs[i].layer, to: segs[i + 1].layer });
    }
    return out;
  }

  /**
   * Where the straight line from an exterior point `from` toward `to` first
   * meets the scalp. Returns null if it misses the head.
   */
  entryPoint(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const dd = dx * dx + dy * dy + dz * dz;
    const ad = from.x * dx + from.y * dy + from.z * dz;
    const aa = from.x * from.x + from.y * from.y + from.z * from.z;
    const R = this.outerRadius;
    const disc = ad * ad - dd * (aa - R * R);
    if (disc <= 0) return null;
    const t = (-ad - Math.sqrt(disc)) / dd;
    if (t < 0 || t > 1) return null;
    return { x: from.x + t * dx, y: from.y + t * dy, z: from.z + t * dz, t };
  }

  /** Depth of a point below the scalp surface, mm. */
  depthOf(p) {
    return this.outerRadius - Math.hypot(p.x, p.y, p.z);
  }

  describe() {
    return this.shells.map((s, i) => {
      const inner = i + 1 < this.shells.length ? this.shells[i + 1].outerRadius : 0;
      return {
        layer: s.layer,
        outerRadius: s.outerRadius,
        innerRadius: inner,
        thickness: s.outerRadius - inner,
      };
    });
  }
}
