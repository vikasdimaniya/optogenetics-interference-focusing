/**
 * Emitter array layouts.
 *
 * Emitters sit on a sphere concentric with the head, at radius
 * (head.outerRadius + standoff). Each emitter has a position and an inward
 * normal; the normal matters because a real source is directional and because
 * the element's own aperture sets how much of the head it can see.
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function normalize(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

/** Orthonormal basis with `axis` as the third vector. */
function basisFrom(axis) {
  const w = normalize(axis);
  const helper = Math.abs(w.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  let u = {
    x: helper.y * w.z - helper.z * w.y,
    y: helper.z * w.x - helper.x * w.z,
    z: helper.x * w.y - helper.y * w.x,
  };
  u = normalize(u);
  const v = {
    x: w.y * u.z - w.z * u.y,
    y: w.z * u.x - w.x * u.z,
    z: w.x * u.y - w.y * u.x,
  };
  return { u, v, w };
}

function makeEmitter(index, radius, dir) {
  const d = normalize(dir);
  return {
    index,
    x: radius * d.x, y: radius * d.y, z: radius * d.z,
    // Inward normal: a source on the surface aims at the head centre.
    nx: -d.x, ny: -d.y, nz: -d.z,
  };
}

/**
 * Fibonacci-spiral points on a spherical cap. Gives near-uniform spacing,
 * which is what you want for a phased array: uniform spacing minimises the
 * worst-case grating lobe for a given element count.
 *
 * @param {object} o
 * @param {number} o.count
 * @param {number} o.radius            emitter shell radius, mm
 * @param {number} o.halfAngleDeg      cap half-angle from `axis`
 * @param {{x,y,z}} [o.axis]           cap centre direction, default +z (vertex)
 */
export function sphericalCap({ count, radius, halfAngleDeg, axis = { x: 0, y: 0, z: 1 } }) {
  if (count < 1) return [];
  const cosMax = Math.cos((halfAngleDeg * Math.PI) / 180);
  const { u, v, w } = basisFrom(axis);
  const out = [];
  for (let i = 0; i < count; i++) {
    // Uniform in solid angle over the cap.
    const cz = 1 - ((i + 0.5) / count) * (1 - cosMax);
    const r = Math.sqrt(Math.max(0, 1 - cz * cz));
    const phi = i * GOLDEN_ANGLE;
    const lx = r * Math.cos(phi), ly = r * Math.sin(phi);
    const dir = {
      x: lx * u.x + ly * v.x + cz * w.x,
      y: lx * u.y + ly * v.y + cz * w.y,
      z: lx * u.z + ly * v.z + cz * w.z,
    };
    out.push(makeEmitter(i, radius, dir));
  }
  return out;
}

/** Fibonacci sphere: full 4-pi coverage. Physically unrealisable on a head
 *  (face, neck, airway) but it is the correct theoretical upper bound. */
export function fullSphere({ count, radius }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const cz = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - cz * cz));
    const phi = i * GOLDEN_ANGLE;
    out.push(makeEmitter(i, radius, { x: r * Math.cos(phi), y: r * Math.sin(phi), z: cz }));
  }
  return out;
}

/**
 * Concentric rings on a cap. Easier to manufacture than a Fibonacci layout and
 * closer to how real tFUS helmets and EEG-style optode caps are built, but it
 * has stronger grating lobes along the ring direction.
 */
export function rings({ count, radius, halfAngleDeg, ringCount = 4, axis = { x: 0, y: 0, z: 1 } }) {
  const { u, v, w } = basisFrom(axis);
  const out = [];
  const maxTheta = (halfAngleDeg * Math.PI) / 180;
  // Distribute elements proportional to ring circumference.
  const thetas = [];
  for (let r = 1; r <= ringCount; r++) thetas.push((r / ringCount) * maxTheta);
  const weights = thetas.map((t) => Math.sin(t));
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  let placed = 0;
  thetas.forEach((theta, ri) => {
    let n = ri === ringCount - 1
      ? count - placed
      : Math.max(1, Math.round((weights[ri] / wsum) * count));
    n = Math.min(n, count - placed);
    for (let j = 0; j < n; j++) {
      const phi = (2 * Math.PI * j) / n + (ri % 2) * (Math.PI / n);
      const st = Math.sin(theta), ct = Math.cos(theta);
      const lx = st * Math.cos(phi), ly = st * Math.sin(phi);
      out.push(makeEmitter(placed + j, radius, {
        x: lx * u.x + ly * v.x + ct * w.x,
        y: lx * u.y + ly * v.y + ct * w.y,
        z: lx * u.z + ly * v.z + ct * w.z,
      }));
    }
    placed += n;
  });
  return out;
}

export const LAYOUTS = { sphericalCap, fullSphere, rings };

/**
 * Build an array from a plain config object.
 * @param {object} cfg
 * @param {'sphericalCap'|'fullSphere'|'rings'} cfg.layout
 * @param {number} cfg.count
 * @param {number} cfg.standoffMm       gap between scalp and emitter shell
 * @param {number} [cfg.halfAngleDeg]
 * @param {number} [cfg.ringCount]
 * @param {{x,y,z}} [cfg.axis]
 * @param {HeadModel} head
 */
export function buildArray(cfg, head) {
  const radius = head.outerRadius + (cfg.standoffMm ?? 0);
  const fn = LAYOUTS[cfg.layout ?? 'sphericalCap'];
  if (!fn) throw new Error(`unknown layout: ${cfg.layout}`);
  return fn({ ...cfg, radius });
}

// ---------------------------------------------------------------------------
// Array figures of merit
// ---------------------------------------------------------------------------

/** Mean nearest-neighbour spacing, mm. This is the array "pitch". */
export function meanPitch(emitters) {
  if (emitters.length < 2) return Infinity;
  let sum = 0;
  for (const a of emitters) {
    let best = Infinity;
    for (const b of emitters) {
      if (a === b) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / emitters.length;
}

/**
 * Half-angle of the aperture as seen from a target point, radians.
 * Effective numerical aperture is NA = n * sin(halfAngle).
 */
export function apertureHalfAngle(emitters, target) {
  let maxAng = 0;
  // Direction from target to array centroid defines the optical axis.
  const cx = emitters.reduce((s, e) => s + e.x, 0) / emitters.length;
  const cy = emitters.reduce((s, e) => s + e.y, 0) / emitters.length;
  const cz = emitters.reduce((s, e) => s + e.z, 0) / emitters.length;
  const axis = normalize({ x: cx - target.x, y: cy - target.y, z: cz - target.z });
  for (const e of emitters) {
    const d = normalize({ x: e.x - target.x, y: e.y - target.y, z: e.z - target.z });
    const dot = Math.max(-1, Math.min(1, d.x * axis.x + d.y * axis.y + d.z * axis.z));
    const ang = Math.acos(dot);
    if (ang > maxAng) maxAng = ang;
  }
  return maxAng;
}

/**
 * Grating-lobe criterion.
 *
 * A periodic array with pitch d produces extra main-strength lobes wherever
 *     sin(theta) = m * lambda / d,   m = +-1, +-2, ...
 * so a SINGLE main lobe over all angles requires d <= lambda/2 (the spatial
 * Nyquist condition). With d >> lambda you get a forest of equally bright
 * lobes - which is precisely the failure mode where "only one point lights up"
 * stops being true.
 *
 * @returns {{pitchMm, wavelengthMm, ratio, lobeCount, singleLobe, lobeAnglesDeg}}
 */
export function gratingLobes(pitchMm, wavelengthMm) {
  const ratio = pitchMm / wavelengthMm;
  const lobeAnglesDeg = [];
  for (let m = 1; m <= Math.floor(ratio); m++) {
    const s = (m * wavelengthMm) / pitchMm;
    if (s <= 1) lobeAnglesDeg.push((Math.asin(s) * 180) / Math.PI);
  }
  return {
    pitchMm, wavelengthMm, ratio,
    lobeCount: lobeAnglesDeg.length,
    singleLobe: ratio <= 0.5,
    lobeAnglesDeg,
  };
}

/**
 * Diffraction-limited focal spot, mm.
 * Lateral FWHM ~ 0.51 lambda / NA  (Rayleigh/Abbe for a circular aperture)
 * Axial  FWHM ~ 1.77 lambda / NA^2 (paraxial), which is why deep foci are
 * always cigar-shaped, not spherical.
 */
export function diffractionLimit(wavelengthMm, halfAngleRad, n = 1.37) {
  const NA = n * Math.sin(halfAngleRad);
  return {
    NA,
    lateralFwhmMm: NA > 0 ? (0.51 * wavelengthMm) / NA : Infinity,
    axialFwhmMm: NA > 0 ? (1.77 * wavelengthMm) / (NA * NA) : Infinity,
  };
}
