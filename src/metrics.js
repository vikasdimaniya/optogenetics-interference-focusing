/**
 * Focus quality, power budget, and thermal metrics.
 *
 * ---------------------------------------------------------------------------
 * Unit normalisation
 * ---------------------------------------------------------------------------
 * PropagationModel returns a dimensionless-amplitude field: with weights
 * normalised so sum|w_j|^2 = 1, the model intensity has units of 1/mm^2
 * (it carries the 1/d^2 spreading).
 *
 * Each emitter is modelled as radiating into a solid angle Omega steradians.
 * A source of power P into Omega has radiant intensity P/Omega, so the
 * irradiance at distance d is P/(Omega d^2). Hence
 *
 *     irradiance [W/mm^2] = (P_total / Omega) * modelIntensity
 *
 * and inverting gives the total emitted power needed for a wanted irradiance
 * at the focus. Omega defaults to 2*pi sr (a source radiating into the
 * half-space it is pressed against).
 */

import { SAFETY, THERMAL, OPSINS } from './constants.js';
import { layerProperties } from './tissue.js';

const DEFAULT_SOLID_ANGLE = 2 * Math.PI;

// ---------------------------------------------------------------------------
// Focus shape
// ---------------------------------------------------------------------------

/**
 * Full width at half maximum along a direction through `centre`, in mm.
 * Probes outward in both directions and interpolates the half-max crossing.
 */
export function fwhmAlong(model, emitters, weights, centre, dir, opts = {}) {
  const { stepMm = 0.02, maxMm = 40 } = opts;
  const m = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const u = { x: dir.x / m, y: dir.y / m, z: dir.z / m };
  const peak = model.fieldAt(emitters, weights, centre).intensity;
  if (peak <= 0) return { fwhm: Infinity, peak: 0 };

  const half = peak / 2;
  const edge = (sign) => {
    let prevS = 0, prevI = peak;
    for (let s = stepMm; s <= maxMm; s += stepMm) {
      const p = {
        x: centre.x + sign * s * u.x,
        y: centre.y + sign * s * u.y,
        z: centre.z + sign * s * u.z,
      };
      const I = model.fieldAt(emitters, weights, p).intensity;
      if (I <= half) {
        // Linear interpolation between the bracketing samples.
        const t = (prevI - half) / (prevI - I || 1);
        return prevS + t * (s - prevS);
      }
      prevS = s; prevI = I;
    }
    return Infinity;
  };
  const a = edge(+1), b = edge(-1);
  return { fwhm: a + b, halfWidthPlus: a, halfWidthMinus: b, peak };
}

/**
 * Focus dimensions along the radial direction (depth, toward the array) and
 * two orthogonal transverse directions.
 */
export function focusShape(model, emitters, weights, target, opts = {}) {
  const r = Math.hypot(target.x, target.y, target.z);
  // Radial unit vector; fall back to +z at the exact centre.
  const radial = r > 1e-9
    ? { x: target.x / r, y: target.y / r, z: target.z / r }
    : { x: 0, y: 0, z: 1 };
  // Two vectors orthogonal to radial.
  const helper = Math.abs(radial.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  let t1 = {
    x: helper.y * radial.z - helper.z * radial.y,
    y: helper.z * radial.x - helper.x * radial.z,
    z: helper.x * radial.y - helper.y * radial.x,
  };
  const n1 = Math.hypot(t1.x, t1.y, t1.z);
  t1 = { x: t1.x / n1, y: t1.y / n1, z: t1.z / n1 };
  const t2 = {
    x: radial.y * t1.z - radial.z * t1.y,
    y: radial.z * t1.x - radial.x * t1.z,
    z: radial.x * t1.y - radial.y * t1.x,
  };

  const axial = fwhmAlong(model, emitters, weights, target, radial, opts);
  const lat1 = fwhmAlong(model, emitters, weights, target, t1, opts);
  const lat2 = fwhmAlong(model, emitters, weights, target, t2, opts);

  const widths = [lat1.fwhm, lat2.fwhm].filter(Number.isFinite);
  return {
    peakModelIntensity: axial.peak,
    axialFwhmMm: axial.fwhm,
    lateralFwhmMm: widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : Infinity,
    lateralFwhmMinMm: widths.length ? Math.min(...widths) : Infinity,
    lateralFwhmMaxMm: widths.length ? Math.max(...widths) : Infinity,
    // Ellipsoidal -6 dB volume, mm^3.
    focalVolumeMm3: Number.isFinite(axial.fwhm) && widths.length
      ? (Math.PI / 6) * axial.fwhm * lat1.fwhm * lat2.fwhm
      : Infinity,
  };
}

// ---------------------------------------------------------------------------
// Where else does it light up?
// ---------------------------------------------------------------------------

/**
 * Local maxima of a 2-D intensity slice, above `relThreshold` of the global
 * maximum and separated by at least `minSeparationPx`.
 *
 * This is the metric that answers the central question of the project: it is
 * not enough for the target to be bright, it has to be the ONLY thing that is
 * bright. Every extra hotspot above the opsin's activation threshold is a
 * population of neurons you did not intend to drive.
 */
export function findHotspots(intensity, nu, nv, opts = {}) {
  const { relThreshold = 0.5, minSeparationPx = 3, maxCount = 400, mask = null } = opts;
  let max = 0;
  for (let i = 0; i < intensity.length; i++) {
    if (mask && !mask[i]) continue;
    if (intensity[i] > max) max = intensity[i];
  }
  if (max <= 0) return { max: 0, spots: [] };
  const cut = max * relThreshold;

  const candidates = [];
  for (let v = 1; v < nv - 1; v++) {
    for (let u = 1; u < nu - 1; u++) {
      const idx = v * nu + u;
      if (mask && !mask[idx]) continue;
      const val = intensity[idx];
      if (val < cut) continue;
      // 8-neighbour local maximum
      let isMax = true;
      for (let dv = -1; dv <= 1 && isMax; dv++) {
        for (let du = -1; du <= 1; du++) {
          if (du === 0 && dv === 0) continue;
          if (intensity[(v + dv) * nu + (u + du)] > val) { isMax = false; break; }
        }
      }
      if (isMax) candidates.push({ u, v, value: val });
    }
  }
  candidates.sort((a, b) => b.value - a.value);

  const spots = [];
  for (const c of candidates) {
    if (spots.length >= maxCount) break;
    let tooClose = false;
    for (const s of spots) {
      if (Math.hypot(s.u - c.u, s.v - c.v) < minSeparationPx) { tooClose = true; break; }
    }
    if (!tooClose) spots.push(c);
  }
  return { max, spots, truncated: spots.length >= maxCount };
}

/**
 * Mask of pixels whose radius lies within [minR, maxR].
 * Used to restrict metrics to brain tissue, so that energy deposited in the
 * skull and scalp is measured separately rather than drowning the focus.
 */
export function maskByRadius(radius, maxR, minR = 0) {
  const m = new Uint8Array(radius.length);
  for (let i = 0; i < radius.length; i++) {
    m[i] = (radius[i] <= maxR && radius[i] >= minR) ? 1 : 0;
  }
  return m;
}

/**
 * Peak intensity outside the brain (scalp, skull, CSF).
 *
 * In transcranial ultrasound this is not an artefact to be hidden: skull
 * heating is the dominant safety limit in clinical practice, and bone sits at
 * high acoustic impedance so pressure actually rises on entry. Reporting it
 * explicitly is more useful than masking it away.
 */
export function extracranialPeak(intensity, radius, brainRadiusMm, headRadiusMm) {
  let max = 0, idx = -1;
  for (let i = 0; i < intensity.length; i++) {
    if (radius[i] <= brainRadiusMm || radius[i] > headRadiusMm) continue;
    if (intensity[i] > max) { max = intensity[i]; idx = i; }
  }
  return { max, index: idx };
}

/**
 * Slice statistics. `peakToBackground` excludes a disc around the brightest
 * point so the focus does not pollute its own background estimate.
 */
export function sliceStatistics(intensity, nu, nv, opts = {}) {
  const { excludeRadiusPx = 6, mask = null } = opts;
  let max = 0, maxIdx = 0;
  for (let i = 0; i < intensity.length; i++) {
    if (mask && !mask[i]) continue;
    if (intensity[i] > max) { max = intensity[i]; maxIdx = i; }
  }
  const mu = maxIdx % nu, mv = Math.floor(maxIdx / nu);
  let sum = 0, count = 0, insideSum = 0;
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      const idx = v * nu + u;
      if (mask && !mask[idx]) continue;
      const val = intensity[idx];
      if (Math.hypot(u - mu, v - mv) <= excludeRadiusPx) { insideSum += val; continue; }
      sum += val; count++;
    }
  }
  const mean = count ? sum / count : 0;
  return {
    max,
    peakIndex: maxIdx,
    peakU: mu,
    peakV: mv,
    backgroundMean: mean,
    peakToBackground: mean > 0 ? max / mean : Infinity,
    // Fraction of the slice's total intensity that lands in the focus.
    focusEnergyFraction: (insideSum + sum) > 0 ? insideSum / (insideSum + sum) : 0,
  };
}

/** Did the focus actually land where it was asked to? */
export function targetingError(model, emitters, weights, target, slice, intensity, mask = null) {
  const stats = sliceStatistics(intensity, slice.nu, slice.nv, { mask });
  const du = slice.extentU / (slice.nu - 1 || 1);
  const dv = slice.extentV / (slice.nv - 1 || 1);
  const su = -slice.extentU / 2 + stats.peakU * du;
  const sv = -slice.extentV / 2 + stats.peakV * dv;
  const peakPoint = {
    x: slice.origin.x + su * slice.axisU.x + sv * slice.axisV.x,
    y: slice.origin.y + su * slice.axisU.y + sv * slice.axisV.y,
    z: slice.origin.z + su * slice.axisU.z + sv * slice.axisV.z,
  };
  return {
    peakPoint,
    errorMm: Math.hypot(peakPoint.x - target.x, peakPoint.y - target.y, peakPoint.z - target.z),
  };
}

// ---------------------------------------------------------------------------
// Power budget
// ---------------------------------------------------------------------------

/**
 * Convert a wanted irradiance at the focus into the power the array must emit,
 * and check that against exposure limits.
 *
 * @param {object} o
 * @param {number} o.modelIntensityAtTarget   from focusShape().peakModelIntensity
 * @param {number} o.targetIrradiance         W/mm^2 wanted at the focus
 * @param {number} o.emitterCount
 * @param {Float64Array} o.weights
 * @param {number} [o.solidAngleSr]
 * @param {number} [o.emitterApertureMm2]     radiating area of one element
 * @param {'optical'|'acoustic'} o.mode
 */
export function powerBudget({
  modelIntensityAtTarget, targetIrradiance, emitterCount, weights,
  solidAngleSr = DEFAULT_SOLID_ANGLE, emitterApertureMm2 = 25, mode = 'optical',
}) {
  if (!(modelIntensityAtTarget > 0)) {
    return {
      feasible: false,
      reason: 'no coherent field reaches the target',
      totalPowerW: Infinity,
      perEmitterPowerW: Infinity,
      surfaceIrradiance: Infinity,
      limit: mode === 'acoustic' ? SAFETY.ultrasoundIsptaLimit : SAFETY.skinMpeCw,
      limitRef: mode === 'acoustic' ? SAFETY.ultrasoundRef : SAFETY.skinMpeRef,
      headroom: 0,
    };
  }
  const totalPowerW = (solidAngleSr * targetIrradiance) / modelIntensityAtTarget;

  // Largest single-emitter share, since that element sets the local hot spot.
  let maxW2 = 0;
  for (let j = 0; j < emitterCount; j++) {
    const w2 = weights[2 * j] ** 2 + weights[2 * j + 1] ** 2;
    if (w2 > maxW2) maxW2 = w2;
  }
  const perEmitterPowerW = totalPowerW * maxW2;
  const surfaceIrradiance = perEmitterPowerW / emitterApertureMm2;
  const limit = mode === 'acoustic' ? SAFETY.ultrasoundIsptaLimit : SAFETY.skinMpeCw;

  return {
    feasible: surfaceIrradiance <= limit,
    totalPowerW,
    perEmitterPowerW,
    surfaceIrradiance,
    limit,
    limitRef: mode === 'acoustic' ? SAFETY.ultrasoundRef : SAFETY.skinMpeRef,
    headroom: limit / surfaceIrradiance,
    // How much power the whole illuminated scalp would have to dissipate.
    totalPowerOnScalpW: totalPowerW,
  };
}

/**
 * Steady-state temperature rise estimate.
 *
 * Conduction-limited centre rise for a uniformly heated sphere of radius a:
 *     dT = Q a^2 / (2k)
 * Perfusion-limited ceiling for a large heated volume:
 *     dT = Q / (rho_b c_b omega_b)
 * The real answer is the smaller of the two. This is a bioheat estimate, not a
 * substitute for a Pennes solve; it is here to catch order-of-magnitude
 * disasters, which is what matters for this project.
 */
export function thermalRise({ irradiance, absorptionPerMm, radiusMm }) {
  const Q = absorptionPerMm * irradiance; // W/mm^3
  const k = THERMAL.brainConductivity;
  const conduction = (Q * radiusMm * radiusMm) / (2 * k);
  const perfusion = Q / (THERMAL.bloodDensity * THERMAL.bloodSpecificHeat * THERMAL.bloodPerfusion);
  const deltaT = Math.min(conduction, perfusion);
  return {
    volumetricHeatWPerMm3: Q,
    conductionLimitedDeltaT: conduction,
    perfusionLimitedDeltaT: perfusion,
    deltaT,
    safe: deltaT <= SAFETY.brainSafeDeltaT,
    limit: SAFETY.brainSafeDeltaT,
  };
}

/**
 * Irradiance threshold for the chosen opsin, and whether the drive wavelength
 * is actually within its action spectrum.
 */
export function opsinCheck(opsinKey, wavelengthNm) {
  const o = OPSINS[opsinKey];
  if (!o) throw new Error(`unknown opsin: ${opsinKey}`);
  const [lo, hi] = o.usableRangeNm;
  const inRange = wavelengthNm >= lo && wavelengthNm <= hi;
  // Crude Gaussian action spectrum for relative efficiency off-peak.
  const sigma = (hi - lo) / 4;
  const relativeEfficiency = Math.exp(-((wavelengthNm - o.peakNm) ** 2) / (2 * sigma * sigma));
  return {
    opsin: o.name,
    peakNm: o.peakNm,
    usableRangeNm: o.usableRangeNm,
    hypothetical: !!o.hypothetical,
    inRange,
    relativeEfficiency,
    thresholdIrradiance: o.thresholdIrradiance,
    effectiveThreshold: o.thresholdIrradiance / Math.max(1e-6, relativeEfficiency),
    ref: o.ref,
  };
}

/**
 * Ballistic (phase-coherent) energy survival from the array to the target.
 *
 * Reported as a natural log because the number itself routinely underflows
 * double precision - which is itself the headline result for optical light.
 */
export function coherenceBudget(model, emitters, target) {
  let bestLn = -Infinity;
  let sumPathMm = 0;
  for (const e of emitters) {
    const { lnFraction, distance } = model.ballisticFraction(e, target);
    if (lnFraction > bestLn) bestLn = lnFraction;
    sumPathMm += distance;
  }
  const meanPathMm = sumPathMm / Math.max(1, emitters.length);

  // Scattering-length count along a representative radial path.
  const depth = model.head.depthOf(target);
  let scatteringLengths = 0;
  let transportLengths = 0;
  for (let i = 0; i < model.nShell; i++) {
    const p = model.props[i];
    const sh = model.shells[i];
    const inner = sh.innerRadius;
    const outer = sh.outerRadius;
    const r = Math.hypot(target.x, target.y, target.z);
    const traversed = Math.max(0, Math.min(outer, model.head.outerRadius) - Math.max(inner, r));
    if (traversed > 0 && p.mus > 0) {
      scatteringLengths += traversed * p.mus;
      transportLengths += traversed * p.musp;
    }
  }

  return {
    lnBallisticFraction: bestLn,
    log10BallisticFraction: bestLn / Math.LN10,
    meanPathMm,
    depthMm: depth,
    scatteringLengths,
    transportLengths,
    // Rule of thumb: beyond ~10 transport mean free paths the field is fully
    // diffuse and a deterministic phase model is meaningless.
    coherentFocusingPossible: transportLengths < 10,
  };
}

/**
 * Peak-to-background ratio achievable by wavefront shaping with N controlled
 * modes against M speckle modes:  eta ~ (pi/4) * (N/M) for a phase-only SLM.
 * Vellekoop & Mosk, Opt Lett 32:2309 (2007).
 *
 * Included so the tool can say what a *measured* transmission matrix would buy
 * you, as opposed to the analytic phase model.
 */
export function wavefrontShapingContrast(controlledModes, speckleModes) {
  if (!(speckleModes > 0)) return Infinity;
  return (Math.PI / 4) * (controlledModes / speckleModes);
}

/** Number of optical modes in a focal volume: roughly (volume)/(lambda/2n)^3. */
export function speckleModeCount(volumeMm3, wavelengthMm, n = 1.37) {
  const cell = (wavelengthMm / (2 * n)) ** 3;
  return volumeMm3 / cell;
}
