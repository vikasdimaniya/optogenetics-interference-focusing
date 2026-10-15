/**
 * These tests encode the physical claims the repository makes. If a claim in
 * the documentation is wrong, a test here should fail.
 */
import {
  suite, test, assert, assertClose, assertGreater, groupHeader,
} from './harness.js';
import {
  opticalAbsorption, opticalScattering, opticalReducedScattering,
  opticalEffectiveAttenuation, opticalProperties, acousticProperties,
  interpolateTable,
} from '../src/tissue.js';
import { WATER_ABSORPTION, OPSINS, SAFETY } from '../src/constants.js';
import { plan } from '../src/api.js';

groupHeader('Tissue optics against the literature');
suite('tissue properties');

test('reduced scattering follows the Mie power law and lands in range', () => {
  // Jacques 2013 for brain: mus' ~ 2.4 /mm at 500 nm falling to ~1.1 /mm at 800 nm.
  const at500 = opticalReducedScattering('greyMatter', 500);
  const at800 = opticalReducedScattering('greyMatter', 800);
  assertClose(at500, 2.42, 0.01);
  assert(at800 > 0.9 && at800 < 1.4, `mus'(800) = ${at800.toFixed(3)} /mm, expected ~1.1`);
  assertGreater(at500, at800, 'scattering must fall with wavelength');
});

test('single-scattering coefficient is ~10x the reduced one', () => {
  // mus = mus'/(1-g) with g = 0.88 -> factor 8.33. This factor is the whole
  // reason coherent light cannot cross a brain.
  const musp = opticalReducedScattering('greyMatter', 800);
  const mus = opticalScattering('greyMatter', 800);
  assertClose(mus / musp, 1 / (1 - 0.88), 1e-9);
  assert(mus > 8 && mus < 12, `mus(800) = ${mus.toFixed(2)} /mm, expected ~9.5`);
});

test('scattering mean free path in brain is about 100 micrometres', () => {
  const p = opticalProperties('greyMatter', 800);
  assert(p.scatteringMeanFreePathMm > 0.07 && p.scatteringMeanFreePathMm < 0.15,
    `l_s = ${(p.scatteringMeanFreePathMm * 1000).toFixed(0)} um, expected ~105 um`);
  assert(p.transportMeanFreePathMm > 0.6 && p.transportMeanFreePathMm < 1.3,
    `l_t = ${p.transportMeanFreePathMm.toFixed(2)} mm, expected ~0.9 mm`);
});

test('blue light is far more absorbed than red, because of haemoglobin', () => {
  const blue = opticalAbsorption('greyMatter', 480);
  const red = opticalAbsorption('greyMatter', 630);
  const nir = opticalAbsorption('greyMatter', 800);
  assertGreater(blue / red, 5, `mua(480)/mua(630) = ${(blue / red).toFixed(1)}, expected >5`);
  assert(blue > 0.15 && blue < 1.0, `mua(480) = ${blue.toFixed(3)} /mm`);
  assert(nir > 0.01 && nir < 0.06, `mua(800) = ${nir.toFixed(4)} /mm, expected ~0.03`);
});

test('diffuse penetration depth in brain at 800 nm is a few millimetres', () => {
  // This is the number people mean by "NIR goes deeper" - and it is about the
  // DIFFUSE fluence, not about anything phase-coherent.
  const d = 1 / opticalEffectiveAttenuation('greyMatter', 800);
  assert(d > 1.5 && d < 8, `1/mu_eff = ${d.toFixed(2)} mm, expected ~3 mm`);
});

test('water absorption shuts the long-wavelength door', () => {
  // The "use a bigger wavelength" idea runs into water, not just opsins.
  const a700 = interpolateTable(WATER_ABSORPTION, 700);
  const a1450 = interpolateTable(WATER_ABSORPTION, 1450);
  assertGreater(a1450 / a700, 1000,
    `water absorption rises ${(a1450 / a700).toFixed(0)}x from 700 to 1450 nm`);
  // At 1450 nm, 80% water tissue has mua ~2.3 /mm: a 1/e depth under half a mm.
  const mua = 0.8 * a1450;
  assert(1 / mua < 1, `1/mua at 1450 nm = ${(1 / mua).toFixed(2)} mm, expected sub-mm`);
});

test('white matter scatters more than grey, as myelin implies', () => {
  assertGreater(
    opticalReducedScattering('whiteMatter', 800),
    opticalReducedScattering('greyMatter', 800),
  );
});

suite('tissue acoustics');

test('ultrasound wavelength in brain is millimetres', () => {
  const p = acousticProperties('greyMatter', 650e3);
  assertClose(p.wavelengthInMediumMm, 1546 / 650, 0.01);
  assert(p.wavelengthInMediumMm > 2 && p.wavelengthInMediumMm < 3,
    `lambda = ${p.wavelengthInMediumMm.toFixed(2)} mm`);
});

test('brain is acoustically near-transparent: metres of penetration depth', () => {
  const p = acousticProperties('greyMatter', 650e3);
  // Amplitude attenuation ~0.004 /mm -> 1/e depth over 100 mm.
  assertGreater(p.penetrationDepthMm, 50,
    `acoustic penetration depth ${p.penetrationDepthMm.toFixed(0)} mm`);
});

test('skull is the lossy layer, and attenuation rises with frequency', () => {
  const lo = acousticProperties('skull', 250e3);
  const hi = acousticProperties('skull', 1.5e6);
  assertGreater(hi.muAmp, lo.muAmp, 'attenuation must rise with frequency');
  assertGreater(acousticProperties('skull', 650e3).muAmp,
    acousticProperties('greyMatter', 650e3).muAmp * 5,
    'skull must dominate the loss budget');
});

test('bone sits at much higher acoustic impedance than brain', () => {
  const bone = acousticProperties('skull', 650e3);
  const brain = acousticProperties('greyMatter', 650e3);
  assertGreater(bone.impedance / brain.impedance, 2.5,
    'impedance mismatch drives both aberration and reflection');
});

// ---------------------------------------------------------------------------
groupHeader('The verdict: light vs ultrasound to a deep target');
suite('optical deep targeting');

const DEEP_TARGET = { x: 0, y: 0, z: 25 }; // ~67 mm below the scalp
const OPTICAL_ARRAY = { layout: 'sphericalCap', count: 256, standoffMm: 5, halfAngleDeg: 80 };

test('red light to a deep target: the coherent field is gone, by hundreds of orders of magnitude', () => {
  const r = plan({
    mode: 'optical', drive: 630, array: OPTICAL_ARRAY,
    targets: [DEEP_TARGET], opsin: 'ChRmine', computeField: false,
  });
  const c = r.assessment.coherence;
  assertGreater(c.transportLengths, 10, 'must exceed the diffusion threshold');
  assert(c.log10BallisticFraction < -100,
    `log10 ballistic energy fraction is ${c.log10BallisticFraction.toFixed(0)}, expected < -100`);
  const fatal = r.assessment.findings.find((f) => f.code === 'optical-scattering');
  assert(fatal.severity === 'fatal', `expected fatal, got ${fatal.severity}`);
  assert(r.assessment.worstSeverity === 'fatal');
});

test('a longer wavelength does not rescue it', () => {
  for (const nm of [800, 1000, 1300]) {
    const r = plan({
      mode: 'optical', drive: nm, array: OPTICAL_ARRAY,
      targets: [DEEP_TARGET], opsin: 'hypotheticalNIR', computeField: false,
    });
    assert(r.assessment.coherence.log10BallisticFraction < -100,
      `${nm} nm: log10 fraction ${r.assessment.coherence.log10BallisticFraction.toFixed(0)}`);
  }
});

test('the optical array is undersampled by four orders of magnitude', () => {
  const r = plan({
    mode: 'optical', drive: 630, array: OPTICAL_ARRAY,
    targets: [DEEP_TARGET], computeField: false,
  });
  const gl = r.assessment.gratingLobes;
  assertGreater(gl.ratio, 1e4,
    `pitch/lambda = ${gl.ratio.toExponential(2)}; a single lobe needs <= 0.5`);
});

test('an APERIODIC array has no discrete grating lobes, only a 1/N pedestal', () => {
  // The textbook grating-lobe formula assumes a periodic lattice. A Fibonacci
  // spiral is aperiodic, so the same energy goes into a diffuse pedestal rather
  // than re-concentrating at specific angles. Getting this wrong overstates the
  // problem, and the honest limit is the element count, not the Nyquist pitch.
  const r = plan({
    mode: 'acoustic', drive: 650e3,
    array: { layout: 'sphericalCap', count: 256, standoffMm: 12, halfAngleDeg: 75 },
    targets: [DEEP_TARGET], slice: { resolution: 121 },
  });
  const f = r.assessment.findings.find((x) => x.code === 'grating-lobes');
  assert(f.severity !== 'fatal' && f.severity !== 'severe',
    `aperiodic layout should not be fatal, got ${f.severity}`);
  assertClose(f.numbers.sidelobePedestal, 1 / 256, 1e-9);
  // And the measured peak-to-background should be of order N, as predicted.
  assertGreater(r.stats.peakToBackground, 50,
    `measured PBR ${r.stats.peakToBackground.toFixed(0)} should be of order N = 256`);
});

test('a PERIODIC optical array is fatal on sampling grounds', () => {
  const r = plan({
    mode: 'optical', drive: 630,
    array: { layout: 'rings', count: 256, standoffMm: 5, halfAngleDeg: 80, ringCount: 8 },
    targets: [DEEP_TARGET], computeField: false,
  });
  const f = r.assessment.findings.find((x) => x.code === 'grating-lobes');
  assert(f.severity === 'fatal', `periodic + undersampled must be fatal, got ${f.severity}`);
});

test('zero-field configurations report selectivity as undefined, not infinite', () => {
  const r = plan({
    mode: 'optical', drive: 630, array: OPTICAL_ARRAY,
    targets: [DEEP_TARGET], slice: { resolution: 61 },
  });
  const f = r.assessment.findings.find((x) => x.code === 'selectivity');
  assert(f.severity === 'fatal', 'no field means no selectivity');
  assert(/undefined/i.test(f.title), `expected "undefined" in title, got: ${f.title}`);
});

test('required optical power exceeds the skin exposure limit absurdly', () => {
  const r = plan({
    mode: 'optical', drive: 630, array: OPTICAL_ARRAY,
    targets: [DEEP_TARGET], opsin: 'ChRmine',
  });
  const f = r.assessment.findings.find((x) => x.code === 'exposure');
  assert(f.severity === 'fatal', `expected fatal exposure finding, got ${f.severity}`);
  assert(!r.assessment.budget.feasible);
});

test('deep optical mode produces a genuinely zero field without crashing or NaN', () => {
  // Underflow to exactly zero is the physically correct answer here; the code
  // must degrade gracefully rather than emit NaN.
  const r = plan({
    mode: 'optical', drive: 630, array: OPTICAL_ARRAY,
    targets: [DEEP_TARGET], slice: { resolution: 61 },
  });
  assert(r.shape.peakModelIntensity === 0,
    `expected exact zero, got ${r.shape.peakModelIntensity}`);
  for (let i = 0; i < r.field.intensity.length; i++) {
    assert(Number.isFinite(r.field.intensity[i]), `NaN/Inf at pixel ${i}`);
  }
  assert(Number.isFinite(r.stats.peakToBackground) || r.stats.peakToBackground === Infinity);
  assert(typeof r.assessment.verdict === 'string');
});

test('shallow optical targeting IS coherently reachable - the premise works at 1 mm', () => {
  // Through a thinned skull or a cranial window, at a fraction of a millimetre,
  // the phase model is sound. This is the regime where holographic optogenetics
  // actually operates today.
  const r = plan({
    mode: 'optical', drive: 630,
    head: {
      name: 'thin cortical slab',
      shells: [
        { layer: 'csf', outerRadius: 10 },
        { layer: 'greyMatter', outerRadius: 9.7 },
      ],
    },
    array: { layout: 'sphericalCap', count: 256, standoffMm: 2, halfAngleDeg: 60 },
    targets: [{ x: 0, y: 0, z: 9.3 }],
    opsin: 'ChRmine', computeField: false,
  });
  const c = r.assessment.coherence;
  assert(c.transportLengths < 10,
    `at 0.4 mm depth transport lengths = ${c.transportLengths.toFixed(2)}, expected < 10`);
  const f = r.assessment.findings.find((x) => x.code === 'optical-scattering');
  assert(f.severity !== 'fatal', `shallow optics should not be fatal, got ${f.severity}`);
});

test('LEDs are rejected outright, whatever the geometry', () => {
  const r = plan({
    mode: 'optical', drive: 630, array: OPTICAL_ARRAY,
    targets: [DEEP_TARGET], sourceType: 'led', computeField: false,
  });
  const f = r.assessment.findings.find((x) => x.code === 'incoherent-source');
  assert(f.severity === 'fatal', 'incoherent sources cannot interfere');
});

suite('acoustic deep targeting');

const ACOUSTIC_PLAN = {
  mode: 'acoustic', drive: 650e3,
  array: { layout: 'sphericalCap', count: 256, standoffMm: 12, halfAngleDeg: 75 },
  targets: [DEEP_TARGET],
  targetIrradiance: 1e-3,
};

test('ultrasound reaches the same deep target with a coherent field', () => {
  const r = plan({ ...ACOUSTIC_PLAN, computeField: false });
  const f = r.assessment.findings.find((x) => x.code === 'acoustic-scattering');
  assert(f.severity === 'ok');
  assertGreater(r.shape.peakModelIntensity, 0, 'a real field must arrive');
});

test('focus is millimetre-scale', () => {
  const r = plan({ ...ACOUSTIC_PLAN, computeField: false });
  assert(r.shape.lateralFwhmMm > 0.5 && r.shape.lateralFwhmMm < 6,
    `lateral FWHM ${r.shape.lateralFwhmMm.toFixed(2)} mm, expected 1-5 mm`);
  assert(Number.isFinite(r.shape.axialFwhmMm));
  assertGreater(r.shape.axialFwhmMm, r.shape.lateralFwhmMm,
    'axial extent should exceed lateral for an external aperture');
});

test('simulated focus is within a factor of 3 of the diffraction limit', () => {
  const r = plan({ ...ACOUSTIC_PLAN, computeField: false });
  const dl = r.assessment.diffraction.lateralFwhmMm;
  const sim = r.shape.lateralFwhmMm;
  assert(sim / dl > 0.5 && sim / dl < 3,
    `simulated ${sim.toFixed(2)} mm vs diffraction limit ${dl.toFixed(2)} mm`);
});

test('surface exposure for ultrasound is within the FDA limit', () => {
  const r = plan({ ...ACOUSTIC_PLAN, computeField: false });
  const f = r.assessment.findings.find((x) => x.code === 'exposure');
  assert(f.severity === 'ok' || f.severity === 'warning',
    `expected feasible exposure, got ${f.severity}: ${f.title}`);
  assert(r.assessment.budget.feasible);
  assertGreater(r.assessment.budget.headroom, 1);
});

test('acoustic verdict is not fatal, and no finding is fatal', () => {
  const r = plan({ ...ACOUSTIC_PLAN, slice: { resolution: 121 } });
  const fatals = r.assessment.findings.filter((f) => f.severity === 'fatal');
  assert(fatals.length === 0,
    `unexpected fatal findings: ${fatals.map((f) => f.code).join(', ')}`);
  assertGreater(r.stats.peakToBackground, 5,
    `peak/background in brain = ${r.stats.peakToBackground.toFixed(1)}`);
});

test('ultrasound targeting error is sub-pixel', () => {
  const r = plan({ ...ACOUSTIC_PLAN, slice: { resolution: 161 } });
  const pixel = r.slice.extentU / (r.slice.nu - 1);
  assert(r.targetingError.errorMm <= 1.5 * pixel,
    `error ${r.targetingError.errorMm.toFixed(2)} mm vs pixel ${pixel.toFixed(2)} mm`);
});

test('a 16-element array cannot do what a 256-element array can', () => {
  const coarse = plan({
    ...ACOUSTIC_PLAN,
    array: { layout: 'sphericalCap', count: 16, standoffMm: 12, halfAngleDeg: 75 },
    slice: { resolution: 121 },
  });
  const fine = plan({ ...ACOUSTIC_PLAN, slice: { resolution: 121 } });
  assertGreater(fine.stats.peakToBackground, coarse.stats.peakToBackground,
    `16 elements: PBR ${coarse.stats.peakToBackground.toFixed(1)}, `
    + `256: ${fine.stats.peakToBackground.toFixed(1)}`);
  assertGreater(coarse.hotspots.spots.length, 0, 'coarse array should show extra hotspots');
});

suite('opsin data integrity');

test('every non-hypothetical opsin peaks below 700 nm', () => {
  for (const [key, o] of Object.entries(OPSINS)) {
    if (o.hypothetical) continue;
    assert(o.peakNm < 700,
      `${key} claims a ${o.peakNm} nm peak; no real single-photon opsin does that`);
    assert(o.usableRangeNm[0] < o.peakNm && o.usableRangeNm[1] > o.peakNm,
      `${key} range must bracket its peak`);
    assert(typeof o.ref === 'string' && o.ref.length > 10, `${key} needs a citation`);
  }
});

test('ChRmine is the most light-sensitive real opsin in the table', () => {
  const real = Object.entries(OPSINS).filter(([, o]) => !o.hypothetical);
  const best = real.reduce((a, b) => (a[1].thresholdIrradiance < b[1].thresholdIrradiance ? a : b));
  assert(best[0] === 'ChRmine' || best[0] === 'hsChRmine',
    `most sensitive should be a ChRmine variant, got ${best[0]}`);
});

test('the hypothetical NIR opsin is flagged as such in the verdict', () => {
  const r = plan({
    mode: 'optical', drive: 1000, array: OPTICAL_ARRAY,
    targets: [DEEP_TARGET], opsin: 'hypotheticalNIR', computeField: false,
  });
  const f = r.assessment.findings.find((x) => x.code === 'opsin-hypothetical');
  assert(f && f.severity === 'severe', 'must warn that the opsin does not exist');
});

test('safety limits carry citations', () => {
  assert(SAFETY.skinMpeRef.includes('ANSI'));
  assert(SAFETY.ultrasoundRef.includes('FDA'));
  assertClose(SAFETY.skinMpeCw, 2.0e-3, 1e-9); // 0.2 W/cm^2
});
