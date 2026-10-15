/**
 * Wave propagation from exterior emitters to interior points.
 *
 * The scalar Green's function for emitter at A, field point at B:
 *
 *   G(B, A) = (T / |B-A|) * exp(-sum_i muAmp_i * L_i) * exp(i * K * sum_i w_i * L_i)
 *
 * where L_i are the path lengths through each tissue shell, T is the product of
 * interface transmission coefficients, and (K, w_i) carry the phase:
 *
 *   optical:   w_i = n_i          (refractive index),   K = 2*pi / lambda0
 *   acoustic:  w_i = c_ref / c_i  (slowness ratio),     K = 2*pi*f / c_ref
 *
 * so that K * sum(w_i L_i) is the accumulated phase either way.
 *
 * ---------------------------------------------------------------------------
 * The fast exact path integral
 * ---------------------------------------------------------------------------
 * For CONCENTRIC shells the per-layer path lengths have a closed form, so no
 * ray marching and no root sorting is needed.
 *
 * Put the origin at the head centre, let u be the unit vector A->B, and let s
 * be arclength along the ray measured from its closest approach to the origin.
 * Then s_A = A.u, s_B = B.u, and the perpendicular miss distance satisfies
 * p^2 = |A|^2 - s_A^2. The ray is inside radius R exactly where |s| < q with
 * q = sqrt(R^2 - p^2), so the length it spends inside radius R is
 *
 *   len(R) = max(0, min(s_B, q) - max(s_A, -q))
 *
 * and the length inside shell i (between R_i and R_{i+1}) is simply
 * len(R_i) - len(R_{i+1}). One sqrt per shell, no allocation, exact.
 *
 * Further, with |A| fixed on the emitter shell:
 *   d^2  = |A|^2 + |B|^2 - 2 A.B
 *   s_A  = (A.B - |A|^2) / d
 *   s_B  = (|B|^2 - A.B) / d
 * so a single dot product A.B drives everything.
 */

import { layerProperties, fresnelTransmission, acousticTransmission } from './tissue.js';

const TWO_PI = Math.PI * 2;
const INV_TWO_PI = 1 / TWO_PI;

// ---------------------------------------------------------------------------
// Trig lookup table
// ---------------------------------------------------------------------------

const LUT_BITS = 16;
const LUT_SIZE = 1 << LUT_BITS;             // 65536
const LUT_SCALE = LUT_SIZE * INV_TWO_PI;
const SIN_LUT = new Float64Array(LUT_SIZE + 1);
const COS_LUT = new Float64Array(LUT_SIZE + 1);
for (let i = 0; i <= LUT_SIZE; i++) {
  const a = (i * TWO_PI) / LUT_SIZE;
  SIN_LUT[i] = Math.sin(a);
  COS_LUT[i] = Math.cos(a);
}
// Max phase-quantisation error is pi/65536 ~ 4.8e-5 rad, far below any
// physical phase uncertainty we care about.

export function fastSin(phase) {
  let x = phase * LUT_SCALE;
  x -= Math.floor(x / LUT_SIZE) * LUT_SIZE;
  return SIN_LUT[x | 0];
}
export function fastCos(phase) {
  let x = phase * LUT_SCALE;
  x -= Math.floor(x / LUT_SIZE) * LUT_SIZE;
  return COS_LUT[x | 0];
}

// ---------------------------------------------------------------------------

export class PropagationModel {
  /**
   * @param {object} o
   * @param {'optical'|'acoustic'} o.mode
   * @param {number} o.drive             wavelength nm (optical) | frequency Hz (acoustic)
   * @param {HeadModel} o.head
   * @param {boolean} [o.coherent=true]  use ballistic (phase-preserving) attenuation
   * @param {boolean} [o.useLut=true]
   */
  constructor({ mode, drive, head, coherent = true, useLut = true }) {
    this.mode = mode;
    this.drive = drive;
    this.head = head;
    this.coherent = coherent;
    this.useLut = useLut;

    const couplingKey = mode === 'acoustic' ? 'water' : null;
    this.shells = head.describe();

    // Per-shell physical properties, outermost first.
    this.props = this.shells.map((s) => layerProperties(mode, s.layer, drive));

    // Coupling medium outside the head.
    if (mode === 'acoustic') {
      this.coupling = layerProperties('acoustic', 'water', drive);
    } else {
      // Air: non-absorbing, n = 1.
      this.coupling = {
        layer: 'air', name: 'Air', n: 1.0, muAmp: 0, muEnergy: 0, mus: 0,
        k: TWO_PI / (drive * 1e-6), wavelengthInMediumMm: drive * 1e-6,
      };
    }

    if (mode === 'acoustic') {
      this.refSpeed = this.coupling.speed;
      this.K = (TWO_PI * drive) / this.refSpeed;
      this.phaseWeights = this.props.map((p) => this.refSpeed / p.speed);
      this.couplingPhaseWeight = 1;
      this.vacuumWavelengthMm = this.refSpeed / drive;
    } else {
      const lambda0 = drive * 1e-6; // nm -> mm
      this.K = TWO_PI / lambda0;
      this.phaseWeights = this.props.map((p) => p.n);
      this.couplingPhaseWeight = 1;
      this.vacuumWavelengthMm = lambda0;
    }

    // Amplitude attenuation per shell. For the coherent field this is
    // (mu_a + mu_s)/2; for the diffuse field it is mu_eff (energy) / 2.
    this.muAmp = this.props.map((p) => {
      if (this.mode === 'acoustic') return p.muAmp;
      return coherent ? (p.mua + p.mus) / 2 : p.muEff / 2;
    });
    this.couplingMuAmp = this.coupling.muAmp ?? 0;

    // Squared shell radii, for the kernel.
    this.r2 = this.shells.map((s) => s.outerRadius * s.outerRadius);
    this.nShell = this.shells.length;

    // Cumulative interface transmission from the coupling medium inward,
    // indexed by shell. transmissionTo[i] = product of transmissions crossed
    // to reach shell i.
    this.transmissionTo = [];
    let acc = 1;
    let prev = this.coupling;
    for (let i = 0; i < this.nShell; i++) {
      const cur = this.props[i];
      acc *= mode === 'acoustic'
        ? acousticTransmission(prev.impedance, cur.impedance)
        : fresnelTransmission(prev.n, cur.n);
      this.transmissionTo.push(acc);
      prev = cur;
    }
  }

  /** Wavelength inside a given shell index, mm. */
  wavelengthInShell(i) {
    return this.props[i].wavelengthInMediumMm;
  }

  /** Index of the shell containing radius r, or -1 if outside the head. */
  shellIndexAtRadius(r) {
    const rr = r * r;
    for (let i = 0; i < this.nShell; i++) if (rr <= this.r2[i]) {
      if (i + 1 >= this.nShell || rr > this.r2[i + 1]) return i;
    }
    return rr <= this.r2[this.nShell - 1] ? this.nShell - 1 : -1;
  }

  /**
   * The kernel. Computes accumulated phase path and amplitude attenuation
   * exponent for a ray from an emitter on radius Ra to a point at radius Rb.
   *
   * @param {number} abDot   A.B
   * @param {number} ra2     |A|^2
   * @param {number} rb2     |B|^2
   * @param {Float64Array} out  [0]=distance, [1]=phasePath, [2]=attenExponent
   */
  pathIntegral(abDot, ra2, rb2, out) {
    const d2 = ra2 + rb2 - 2 * abDot;
    const d = Math.sqrt(d2 > 0 ? d2 : 0);
    if (d === 0) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }

    const invD = 1 / d;
    const sA = (abDot - ra2) * invD;
    const sB = (rb2 - abDot) * invD;
    let p2 = ra2 - sA * sA;
    if (p2 < 0) p2 = 0;

    // len(R) for each shell, outermost first.
    let phasePath = 0;
    let atten = 0;
    let prevLen = 0; // len for the shell just outside the current one

    // Length inside the outermost shell, needed for the coupling segment.
    let outerLen = 0;

    for (let i = 0; i < this.nShell; i++) {
      const q2 = this.r2[i] - p2;
      let len = 0;
      if (q2 > 0) {
        const q = Math.sqrt(q2);
        const lo = sA > -q ? sA : -q;
        const hi = sB < q ? sB : q;
        if (hi > lo) len = hi - lo;
      }
      if (i === 0) outerLen = len;
      // Shell i occupies len(R_i) - len(R_{i+1}); accumulate by differencing
      // on the fly: contribute (len_i) with weight_i and subtract it from the
      // next iteration via prevLen bookkeeping.
      if (i > 0) {
        const shellLen = prevLen - len;
        if (shellLen > 0) {
          phasePath += this.phaseWeights[i - 1] * shellLen;
          atten += this.muAmp[i - 1] * shellLen;
        }
      }
      prevLen = len;
    }
    // Innermost shell: everything inside R_last.
    if (prevLen > 0) {
      phasePath += this.phaseWeights[this.nShell - 1] * prevLen;
      atten += this.muAmp[this.nShell - 1] * prevLen;
    }
    // Coupling medium: the rest of the ray.
    const couplingLen = (sB - sA) - outerLen;
    if (couplingLen > 0) {
      phasePath += this.couplingPhaseWeight * couplingLen;
      atten += this.couplingMuAmp * couplingLen;
    }

    out[0] = d;
    out[1] = phasePath;
    out[2] = atten;
    return out;
  }

  /** Scratch buffer reused by pathIntegral callers. */
  static scratch() { return new Float64Array(3); }

  /**
   * Complex Green's function for one emitter/point pair.
   * @returns {{re: number, im: number, amp: number, phase: number, distance: number}}
   */
  green(emitter, point, scratch = PropagationModel.scratch()) {
    const ra2 = emitter.x * emitter.x + emitter.y * emitter.y + emitter.z * emitter.z;
    const rb2 = point.x * point.x + point.y * point.y + point.z * point.z;
    const abDot = emitter.x * point.x + emitter.y * point.y + emitter.z * point.z;
    this.pathIntegral(abDot, ra2, rb2, scratch);
    const [d, phasePath, atten] = scratch;
    if (d === 0) return { re: 0, im: 0, amp: 0, phase: 0, distance: 0 };

    const shellIdx = this.shellIndexAtRadius(Math.sqrt(rb2));
    const T = shellIdx >= 0 ? this.transmissionTo[shellIdx] : 1;

    const amp = (T / d) * Math.exp(-atten);
    const phase = this.K * phasePath;
    const c = this.useLut ? fastCos(phase) : Math.cos(phase);
    const s = this.useLut ? fastSin(phase) : Math.sin(phase);
    return { re: amp * c, im: amp * s, amp, phase, distance: d };
  }

  /**
   * Build the (nPoints x nEmitters) complex transfer matrix.
   * Stored interleaved row-major: A[2*(i*N + j)] = re, +1 = im.
   */
  transferMatrix(emitters, points) {
    const N = emitters.length, M = points.length;
    const A = new Float64Array(2 * M * N);
    const scratch = PropagationModel.scratch();
    const ra2 = emitters.map((e) => e.x * e.x + e.y * e.y + e.z * e.z);

    for (let i = 0; i < M; i++) {
      const pt = points[i];
      const rb2 = pt.x * pt.x + pt.y * pt.y + pt.z * pt.z;
      const shellIdx = this.shellIndexAtRadius(Math.sqrt(rb2));
      const T = shellIdx >= 0 ? this.transmissionTo[shellIdx] : 1;
      for (let j = 0; j < N; j++) {
        const e = emitters[j];
        const abDot = e.x * pt.x + e.y * pt.y + e.z * pt.z;
        this.pathIntegral(abDot, ra2[j], rb2, scratch);
        const d = scratch[0];
        if (d === 0) continue;
        const amp = (T / d) * Math.exp(-scratch[2]);
        const phase = this.K * scratch[1];
        const idx = 2 * (i * N + j);
        A[idx] = amp * (this.useLut ? fastCos(phase) : Math.cos(phase));
        A[idx + 1] = amp * (this.useLut ? fastSin(phase) : Math.sin(phase));
      }
    }
    return { A, rows: M, cols: N };
  }

  /** Coherent field at a single point given complex emitter weights. */
  fieldAt(emitters, weights, point) {
    const scratch = PropagationModel.scratch();
    let re = 0, im = 0;
    const rb2 = point.x * point.x + point.y * point.y + point.z * point.z;
    const shellIdx = this.shellIndexAtRadius(Math.sqrt(rb2));
    const T = shellIdx >= 0 ? this.transmissionTo[shellIdx] : 1;
    for (let j = 0; j < emitters.length; j++) {
      const e = emitters[j];
      const ra2 = e.x * e.x + e.y * e.y + e.z * e.z;
      const abDot = e.x * point.x + e.y * point.y + e.z * point.z;
      this.pathIntegral(abDot, ra2, rb2, scratch);
      const d = scratch[0];
      if (d === 0) continue;
      const amp = (T / d) * Math.exp(-scratch[2]);
      const ph = this.K * scratch[1];
      const gre = amp * (this.useLut ? fastCos(ph) : Math.cos(ph));
      const gim = amp * (this.useLut ? fastSin(ph) : Math.sin(ph));
      const wr = weights[2 * j], wi = weights[2 * j + 1];
      re += gre * wr - gim * wi;
      im += gre * wi + gim * wr;
    }
    return { re, im, intensity: re * re + im * im };
  }

  /**
   * Coherent intensity over a 2-D slice. This is the render hot path.
   *
   * @param {Array} emitters
   * @param {Float64Array} weights  interleaved complex, length 2N
   * @param {object} slice  {origin:{x,y,z}, axisU:{x,y,z}, axisV:{x,y,z}, nu, nv,
   *                         extentU, extentV, maskRadiusMm?}
   *
   * `maskRadiusMm` zeroes the field outside that radius. It is not cosmetic:
   * the point-source Green's function has a 1/d singularity at each emitter, so
   * any pixel that strays near the emitter shell is brighter than any focus
   * could ever be. Masking to the head keeps the metrics meaningful, and the
   * region outside the head is not somewhere we are trying to measure anyway.
   *
   * @returns {{intensity, radius, mask, nu, nv, max, maxInside}}
   */
  computeSlice(emitters, weights, slice) {
    const { origin, axisU, axisV, nu, nv, extentU, extentV } = slice;
    const maskRadius = slice.maskRadiusMm ?? Infinity;
    const N = emitters.length;
    const out = new Float32Array(nu * nv);
    const radiusOut = new Float32Array(nu * nv);
    const mask = new Uint8Array(nu * nv);
    const scratch = new Float64Array(3);

    const ex = new Float64Array(N), ey = new Float64Array(N), ez = new Float64Array(N);
    const era2 = new Float64Array(N);
    const wr = new Float64Array(N), wi = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      ex[j] = emitters[j].x; ey[j] = emitters[j].y; ez[j] = emitters[j].z;
      era2[j] = ex[j] * ex[j] + ey[j] * ey[j] + ez[j] * ez[j];
      wr[j] = weights[2 * j]; wi[j] = weights[2 * j + 1];
    }

    const du = extentU / (nu - 1 || 1), dv = extentV / (nv - 1 || 1);
    const K = this.K;
    const useLut = this.useLut;
    let max = 0;

    for (let iv = 0; iv < nv; iv++) {
      const sv = -extentV / 2 + iv * dv;
      for (let iu = 0; iu < nu; iu++) {
        const su = -extentU / 2 + iu * du;
        const px = origin.x + su * axisU.x + sv * axisV.x;
        const py = origin.y + su * axisU.y + sv * axisV.y;
        const pz = origin.z + su * axisU.z + sv * axisV.z;
        const rb2 = px * px + py * py + pz * pz;
        const rb = Math.sqrt(rb2);
        const pix = iv * nu + iu;
        radiusOut[pix] = rb;
        if (rb > maskRadius) continue; // left at 0, mask stays 0
        mask[pix] = 1;
        const shellIdx = this.shellIndexAtRadius(rb);
        const T = shellIdx >= 0 ? this.transmissionTo[shellIdx] : 1;

        let re = 0, im = 0;
        for (let j = 0; j < N; j++) {
          const abDot = ex[j] * px + ey[j] * py + ez[j] * pz;
          this.pathIntegral(abDot, era2[j], rb2, scratch);
          const d = scratch[0];
          if (d === 0) continue;
          const amp = (T / d) * Math.exp(-scratch[2]);
          const ph = K * scratch[1];
          const c = useLut ? fastCos(ph) : Math.cos(ph);
          const s = useLut ? fastSin(ph) : Math.sin(ph);
          const gre = amp * c, gim = amp * s;
          re += gre * wr[j] - gim * wi[j];
          im += gre * wi[j] + gim * wr[j];
        }
        const I = re * re + im * im;
        out[pix] = I;
        if (I > max) max = I;
      }
    }
    return { intensity: out, radius: radiusOut, mask, nu, nv, max, maskRadius };
  }

  /**
   * Ballistic (coherent) survival fraction of ENERGY along the ray from an
   * emitter to a point. This is the number that decides whether coherent
   * focusing is physically possible at all.
   */
  ballisticFraction(emitter, point) {
    const scratch = PropagationModel.scratch();
    const ra2 = emitter.x ** 2 + emitter.y ** 2 + emitter.z ** 2;
    const rb2 = point.x ** 2 + point.y ** 2 + point.z ** 2;
    const abDot = emitter.x * point.x + emitter.y * point.y + emitter.z * point.z;
    this.pathIntegral(abDot, ra2, rb2, scratch);
    // atten is the AMPLITUDE exponent; energy exponent is twice that.
    return { lnFraction: -2 * scratch[2], distance: scratch[0] };
  }
}
