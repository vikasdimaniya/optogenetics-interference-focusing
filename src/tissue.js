/**
 * Wavelength- and frequency-dependent tissue properties.
 *
 * Turns the tables in constants.js into the four numbers the propagator needs
 * for each layer:
 *
 *   n        refractive index (optical) or 1 (acoustic uses speed directly)
 *   k        wavenumber inside the layer, rad/mm
 *   muAmp    AMPLITUDE attenuation coefficient, 1/mm
 *   muEnergy ENERGY attenuation coefficient, 1/mm
 *
 * The distinction between muAmp and muEnergy is the crux of this whole project,
 * so it is worth being explicit.
 *
 * For a COHERENT (ballistic, phase-preserving) field, a photon that scatters is
 * gone: it no longer arrives at the focus with a predictable phase. So the
 * coherent amplitude decays with the TOTAL interaction coefficient
 *     mu_t = mu_a + mu_s                      (not mu_a + mu_s')
 * and the amplitude attenuation is mu_t / 2 because intensity ~ |amplitude|^2.
 *
 * For TOTAL energy (coherent + diffuse, which is what a power meter reads) the
 * relevant quantity is the diffusion effective attenuation
 *     mu_eff = sqrt(3 * mu_a * (mu_a + mu_s'))
 * which is vastly smaller. This is why light obviously does get into your hand
 * when you hold a torch against it, while still being useless for interference:
 * what comes out the other side is diffuse, not phase-coherent.
 */

import {
  HB_SPECTRA, WATER_ABSORPTION, OPTICAL_LAYERS, ACOUSTIC_LAYERS,
} from './constants.js';

const HB_MOLAR_WHOLE_BLOOD = 2.33e-3; // mol/L at 150 g/L, MW 64500
const LN10 = Math.LN10;
const NEPER_PER_DB = 1 / 8.685889638;

/** Linear interpolation over a {key: value} table with numeric keys. */
export function interpolateTable(table, x) {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (x <= keys[0]) return table[keys[0]];
  if (x >= keys[keys.length - 1]) return table[keys[keys.length - 1]];
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1] < x) i++;
  const x0 = keys[i], x1 = keys[i + 1];
  const t = (x - x0) / (x1 - x0);
  const v0 = table[x0], v1 = table[x1];
  if (Array.isArray(v0)) return v0.map((v, j) => v + t * (v1[j] - v));
  return v0 + t * (v1 - v0);
}

/** Absorption coefficient of a layer at a wavelength, 1/mm. */
export function opticalAbsorption(layerKey, wavelengthNm) {
  const L = OPTICAL_LAYERS[layerKey];
  if (!L) throw new Error(`unknown optical layer: ${layerKey}`);

  const [epsOxy, epsDeoxy] = interpolateTable(HB_SPECTRA, wavelengthNm);
  const epsBlend = L.oxygenSat * epsOxy + (1 - L.oxygenSat) * epsDeoxy;
  const concentration = L.bloodFraction * HB_MOLAR_WHOLE_BLOOD;
  // ln(10)*eps*C is 1/cm; /10 -> 1/mm
  const muaBlood = (LN10 * epsBlend * concentration) / 10;
  const muaWater = L.waterFraction * interpolateTable(WATER_ABSORPTION, wavelengthNm);
  return muaBlood + muaWater + L.baselineMua;
}

/** Reduced scattering coefficient, 1/mm (Mie power law). */
export function opticalReducedScattering(layerKey, wavelengthNm) {
  const L = OPTICAL_LAYERS[layerKey];
  return L.musPrime500 * Math.pow(wavelengthNm / 500, -L.scatteringPower);
}

/** Single-scattering coefficient, 1/mm.  mus = mus' / (1 - g). */
export function opticalScattering(layerKey, wavelengthNm) {
  const L = OPTICAL_LAYERS[layerKey];
  return opticalReducedScattering(layerKey, wavelengthNm) / (1 - L.g);
}

/** Diffusion-theory effective attenuation coefficient, 1/mm. */
export function opticalEffectiveAttenuation(layerKey, wavelengthNm) {
  const mua = opticalAbsorption(layerKey, wavelengthNm);
  const musp = opticalReducedScattering(layerKey, wavelengthNm);
  return Math.sqrt(3 * mua * (mua + musp));
}

/**
 * Full optical property set for one layer.
 * @param {string} layerKey
 * @param {number} wavelengthNm
 * @param {'ballistic'|'diffuse'} regime  which attenuation to report as muAmp
 */
export function opticalProperties(layerKey, wavelengthNm, regime = 'ballistic') {
  const L = OPTICAL_LAYERS[layerKey];
  const mua = opticalAbsorption(layerKey, wavelengthNm);
  const mus = opticalScattering(layerKey, wavelengthNm);
  const musp = opticalReducedScattering(layerKey, wavelengthNm);
  const muEff = Math.sqrt(3 * mua * (mua + musp));

  // Wavenumber inside the medium: k = 2*pi*n/lambda0.  lambda in nm -> mm.
  const lambdaMm = wavelengthNm * 1e-6;
  const k = (2 * Math.PI * L.refractiveIndex) / lambdaMm;

  const muEnergyBallistic = mua + mus;
  const muEnergy = regime === 'diffuse' ? muEff : muEnergyBallistic;

  return {
    layer: layerKey,
    name: L.name,
    n: L.refractiveIndex,
    k,
    wavelengthInMediumMm: lambdaMm / L.refractiveIndex,
    mua, mus, musp, g: L.g, muEff,
    muEnergy,
    muAmp: muEnergy / 2,
    scatteringMeanFreePathMm: 1 / mus,
    transportMeanFreePathMm: 1 / musp,
    penetrationDepthMm: 1 / muEff,
  };
}

/** Full acoustic property set for one layer. */
export function acousticProperties(layerKey, frequencyHz) {
  const L = ACOUSTIC_LAYERS[layerKey];
  if (!L) throw new Error(`unknown acoustic layer: ${layerKey}`);

  const fMHz = frequencyHz / 1e6;
  const alphaDbPerCm = L.alphaDbCmMHz * Math.pow(fMHz, L.alphaPower);
  // dB/cm -> Np/cm -> Np/mm.  This is already an AMPLITUDE coefficient,
  // which is the convention for acoustic attenuation in dB/cm.
  const muAmp = (alphaDbPerCm * NEPER_PER_DB) / 10;

  const wavelengthMm = L.speed / frequencyHz;
  const k = (2 * Math.PI * frequencyHz) / L.speed;

  return {
    layer: layerKey,
    name: L.name,
    speed: L.speed,
    density: L.density,
    impedance: L.density * (L.speed * 1e-3), // rayl, with speed in m/s
    k,
    wavelengthInMediumMm: wavelengthMm,
    alphaDbPerCm,
    muAmp,
    muEnergy: 2 * muAmp,
    // Acoustic scattering in brain is negligible at these wavelengths
    // (lambda ~ mm >> cell size), so there is no ballistic/diffuse split.
    mus: 0,
    scatteringMeanFreePathMm: Infinity,
    transportMeanFreePathMm: Infinity,
    penetrationDepthMm: 1 / (2 * muAmp),
  };
}

/**
 * Unified accessor.
 * @param {'optical'|'acoustic'} mode
 * @param {string} layerKey
 * @param {number} drive  wavelength in nm (optical) or frequency in Hz (acoustic)
 * @param {object} [opts]
 */
export function layerProperties(mode, layerKey, drive, opts = {}) {
  return mode === 'acoustic'
    ? acousticProperties(layerKey, drive)
    : opticalProperties(layerKey, drive, opts.regime ?? 'ballistic');
}

/**
 * Pressure transmission coefficient at a normal-incidence acoustic interface.
 * Included because the scalp->skull impedance step is a real loss term that
 * the straight-ray model would otherwise miss entirely.
 */
export function acousticTransmission(z1, z2) {
  return (2 * z2) / (z1 + z2);
}

/** Fresnel transmission for normal incidence at an optical interface. */
export function fresnelTransmission(n1, n2) {
  const r = (n1 - n2) / (n1 + n2);
  return 1 - r * r;
}
