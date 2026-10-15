/**
 * The verdict engine.
 *
 * Given a configured plan, decide whether the physics actually permits it and
 * say why or why not, in numbers. This module is deliberately blunt: a planner
 * that happily prints emitter coordinates for a scheme that cannot work is
 * worse than no planner at all.
 *
 * Severities:
 *   fatal    - violates physics or safety by orders of magnitude. No engineering fixes this.
 *   severe   - a hard obstacle that current technology does not solve.
 *   warning  - a real problem with known mitigations.
 *   ok       - checked and fine.
 */

import { SAFETY } from './constants.js';
import { gratingLobes, meanPitch, apertureHalfAngle, diffractionLimit } from './array-geometry.js';
import {
  coherenceBudget, powerBudget, thermalRise, opsinCheck,
  wavefrontShapingContrast, speckleModeCount,
} from './metrics.js';

const SEVERITY_ORDER = { fatal: 0, severe: 1, warning: 2, ok: 3 };

function fmtLog10(log10) {
  if (!Number.isFinite(log10)) return log10 > 0 ? 'infinite' : '0';
  if (log10 > -3 && log10 < 3) return (10 ** log10).toPrecision(3);
  return `1e${log10 >= 0 ? '+' : ''}${log10.toFixed(0)}`;
}

/**
 * @param {object} o
 * @param {PropagationModel} o.model
 * @param {Array} o.emitters
 * @param {Float64Array} o.weights
 * @param {{x,y,z}} o.target
 * @param {object} o.shape            from focusShape()
 * @param {object} [o.sliceStats]     from sliceStatistics()
 * @param {object} [o.hotspots]       from findHotspots()
 * @param {string} [o.opsin]
 * @param {number} [o.targetIrradiance]  W/mm^2 wanted at the focus
 * @param {number} [o.emitterApertureMm2]
 */
export function assess(o) {
  const {
    model, emitters, weights, target, shape,
    sliceStats, hotspots, opsin = 'ChRmine',
    emitterApertureMm2 = 25,
  } = o;
  const findings = [];
  const mode = model.mode;
  const head = model.head;

  // -------------------------------------------------------------------------
  // 0. Are the sources even capable of interfering?
  // -------------------------------------------------------------------------
  const sourceType = o.sourceType ?? (mode === 'acoustic' ? 'transducer' : 'laser');
  if (sourceType === 'led') {
    findings.push({
      severity: 'fatal',
      code: 'incoherent-source',
      title: 'LEDs cannot interfere: no fixed phase relationship between them',
      detail:
        'An LED emits spontaneously. Its coherence time is on the order of tens of femtoseconds '
        + '(coherence length a few micrometres), and two separate LEDs have no phase relationship at '
        + 'all - their relative phase scrambles far faster than any neuron, or any detector, could '
        + 'integrate. Add the fields of N independent LEDs and the cross terms average to zero, so the '
        + 'intensities simply sum: you get N times the brightness everywhere the beams overlap and no '
        + 'interference pattern anywhere. This is why a room lit by many bulbs has no fringes in it. '
        + 'Deterministic interference needs mutually coherent sources: one laser split N ways with '
        + 'phase shifters, or N phase-locked oscillators (which is what an ultrasound array is). '
        + 'Switching from LEDs to a split-and-phase-shift laser is necessary before any of the rest of '
        + 'this analysis even applies.',
      numbers: {},
    });
  } else {
    findings.push({
      severity: 'ok',
      code: 'incoherent-source',
      title: `Source type "${sourceType}" can be phase-locked`,
      detail: mode === 'acoustic'
        ? 'Piezoelectric elements driven from a common clock are mutually coherent by construction; '
          + 'per-element phase is set in the driving electronics.'
        : 'A single laser split N ways through phase modulators gives mutually coherent emitters. '
          + 'Independent laser diodes would not: they need to be injection-locked or seeded from one '
          + 'master oscillator.',
      numbers: {},
    });
  }

  // -------------------------------------------------------------------------
  // 1. Is there a coherent field at the target at all?
  // -------------------------------------------------------------------------
  const coherence = coherenceBudget(model, emitters, target);

  if (mode === 'optical') {
    const l10 = coherence.log10BallisticFraction;
    if (coherence.transportLengths > 10) {
      findings.push({
        severity: 'fatal',
        code: 'optical-scattering',
        title: 'Scattering destroys the coherent field long before it arrives',
        detail:
          `The straight-line path from scalp to target crosses ${coherence.scatteringLengths.toFixed(0)} `
          + `scattering mean free paths (${coherence.transportLengths.toFixed(1)} transport mean free paths). `
          + `The ballistic, phase-preserving fraction of the energy that survives to the target is `
          + `${fmtLog10(l10)}. Interference requires a predictable phase at the meeting point; after `
          + `more than ~10 transport mean free paths the field is a random speckle pattern, and the `
          + `deterministic "sum the path lengths" phase model this planner uses is physically meaningless. `
          + `This is not an engineering shortfall - the number is ${fmtLog10(l10)}, not 0.01.`,
        numbers: {
          scatteringMeanFreePaths: coherence.scatteringLengths,
          transportMeanFreePaths: coherence.transportLengths,
          log10BallisticEnergyFraction: l10,
          depthMm: coherence.depthMm,
        },
      });
    } else {
      findings.push({
        severity: coherence.transportLengths > 3 ? 'warning' : 'ok',
        code: 'optical-scattering',
        title: `Coherent field survives: ${coherence.transportLengths.toFixed(2)} transport mean free paths`,
        detail:
          `Ballistic energy fraction ${fmtLog10(coherence.log10BallisticFraction)} at `
          + `${coherence.depthMm.toFixed(1)} mm depth. Below ~1 transport mean free path a `
          + `deterministic phase model is sound; between 1 and 10 it degrades and you would need a `
          + `measured transmission matrix rather than a computed one.`,
        numbers: {
          transportMeanFreePaths: coherence.transportLengths,
          log10BallisticEnergyFraction: coherence.log10BallisticFraction,
        },
      });
    }
  } else {
    findings.push({
      severity: 'ok',
      code: 'acoustic-scattering',
      title: 'Negligible scattering: the wave stays coherent',
      detail:
        `At ${(model.drive / 1e3).toFixed(0)} kHz the wavelength in brain is `
        + `${(model.props.find((p) => p.layer === 'greyMatter')
          ?? model.props[model.props.length - 1]).wavelengthInMediumMm.toFixed(2)} mm, far larger `
        + `than any cellular structure, so brain tissue is acoustically near-homogeneous and the field `
        + `stays phase-coherent across the whole head. Attenuation is absorption, not scattering, so it `
        + `costs amplitude but not predictability.`,
      numbers: {
        wavelengthMm: (model.props.find((p) => p.layer === 'greyMatter')
          ?? model.props[model.props.length - 1]).wavelengthInMediumMm,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 2. Is the array sampled finely enough to make ONE lobe?
  // -------------------------------------------------------------------------
  const pitch = meanPitch(emitters);
  // Fall back to the innermost shell if there is no explicit grey matter layer,
  // so custom head models (a slab, a phantom) do not crash the assessment.
  const brainShell = model.props.find((p) => p.layer === 'greyMatter')
    ?? model.props[model.props.length - 1];
  const lambdaMm = brainShell.wavelengthInMediumMm;
  const gl = gratingLobes(pitch, lambdaMm);

  // A Fibonacci or otherwise aperiodic layout does NOT produce discrete grating
  // lobes - that formula assumes a periodic lattice. An aperiodic array instead
  // scatters the same energy into a broad sidelobe pedestal sitting at roughly
  // 1/N of the peak, where N is the element count. So for aperiodic arrays the
  // honest selectivity figure is the measured peak-to-background ratio, which
  // the solver achieves at about N, and the design requirement is "enough
  // elements for the dynamic range you need", not the Nyquist condition.
  const aperiodic = o.layout === undefined || o.layout === 'sphericalCap' || o.layout === 'fullSphere';
  const pedestal = 1 / Math.max(1, emitters.length);

  if (aperiodic) {
    findings.push({
      severity: gl.ratio > 0.5 ? 'warning' : 'ok',
      code: 'grating-lobes',
      title: gl.ratio > 0.5
        ? `Aperiodic array: no discrete grating lobes, sidelobe pedestal near 1/N = ${pedestal.toExponential(1)}`
        : 'Array satisfies the spatial Nyquist condition: single main lobe',
      detail:
        `Element spacing is ${pitch.toFixed(2)} mm against a tissue wavelength of `
        + `${lambdaMm < 0.01 ? lambdaMm.toExponential(2) : lambdaMm.toFixed(2)} mm `
        + `(ratio ${gl.ratio < 100 ? gl.ratio.toFixed(2) : gl.ratio.toExponential(2)}). `
        + `A periodic array at this spacing would show ${gl.lobeCount} discrete grating lobes, but this `
        + `layout is aperiodic, so that energy is spread into a diffuse pedestal instead of `
        + `re-concentrating at specific angles. With ${emitters.length} elements the coherent gain at `
        + `the focus is of order N, putting the pedestal around ${(100 * pedestal).toFixed(2)}% of the `
        + `peak. That is the number that decides selectivity: if the focus has to sit K times above the `
        + `activation threshold, the background sits at K/N of threshold, so you need N >> K elements. `
        + `Randomised or spiral element placement is standard practice in both ultrasound arrays and `
        + `radio astronomy for exactly this reason.`,
      numbers: {
        pitchMm: pitch, wavelengthMm: lambdaMm, pitchOverWavelength: gl.ratio,
        equivalentPeriodicLobeCount: gl.lobeCount, sidelobePedestal: pedestal,
        elementCount: emitters.length,
      },
    });
  } else if (gl.ratio > 100) {
    findings.push({
      severity: 'fatal',
      code: 'grating-lobes',
      title: 'Periodic array, wildly undersampled: a forest of equally bright lobes, not one spot',
      detail:
        `Element spacing is ${pitch.toFixed(1)} mm and the wavelength in tissue is `
        + `${lambdaMm.toExponential(2)} mm, a ratio of ${gl.ratio.toExponential(2)}. On a periodic `
        + `lattice a single main lobe requires spacing below lambda/2. Undersampled by this much, `
        + `constructive interference recurs wherever the path difference is any whole number of `
        + `wavelengths, which happens on a dense lattice throughout the entire head. Switching to an `
        + `aperiodic layout converts those lobes into a diffuse pedestal, which is strictly better but `
        + `still leaves a background at 1/N of the peak.`,
      numbers: {
        pitchMm: pitch, wavelengthMm: lambdaMm, pitchOverWavelength: gl.ratio,
        gratingLobeCount: gl.lobeCount,
      },
    });
  } else if (!gl.singleLobe) {
    findings.push({
      severity: gl.lobeCount > 3 ? 'warning' : 'ok',
      code: 'grating-lobes',
      title: `Periodic array: ${gl.lobeCount} discrete grating lobe${gl.lobeCount === 1 ? '' : 's'}`,
      detail:
        `Element spacing ${pitch.toFixed(2)} mm vs wavelength ${lambdaMm.toFixed(2)} mm `
        + `(ratio ${gl.ratio.toFixed(2)}). Grating lobes appear at `
        + `${gl.lobeAnglesDeg.map((a) => `${a.toFixed(0)}deg`).join(', ')} off axis. Switching to an `
        + `aperiodic layout, adding elements, or apodising the aperture all suppress them; this is `
        + `routine array design, not a physical barrier.`,
      numbers: { pitchMm: pitch, pitchOverWavelength: gl.ratio, gratingLobeCount: gl.lobeCount },
    });
  } else {
    findings.push({
      severity: 'ok',
      code: 'grating-lobes',
      title: 'Array satisfies the spatial Nyquist condition: single main lobe',
      detail: `Spacing ${pitch.toFixed(2)} mm is below lambda/2 = ${(lambdaMm / 2).toFixed(2)} mm.`,
      numbers: { pitchMm: pitch, pitchOverWavelength: gl.ratio },
    });
  }

  // -------------------------------------------------------------------------
  // 3. Diffraction limit - usually the reassuring one
  // -------------------------------------------------------------------------
  const halfAngle = apertureHalfAngle(emitters, target);
  const dl = diffractionLimit(lambdaMm, halfAngle, mode === 'optical' ? brainShell.n : 1);
  findings.push({
    severity: dl.lateralFwhmMm <= 2 ? 'ok' : 'warning',
    code: 'diffraction',
    title: `Diffraction-limited spot: ${dl.lateralFwhmMm < 0.01
      ? dl.lateralFwhmMm.toExponential(2) : dl.lateralFwhmMm.toFixed(2)} mm lateral`,
    detail:
      `Aperture half-angle ${((halfAngle * 180) / Math.PI).toFixed(0)}deg gives NA ${dl.NA.toFixed(2)}, `
      + `so the theoretical lateral FWHM is `
      + `${dl.lateralFwhmMm < 0.01 ? dl.lateralFwhmMm.toExponential(2) : dl.lateralFwhmMm.toFixed(3)} mm `
      + `and the axial FWHM is `
      + `${dl.axialFwhmMm < 0.01 ? dl.axialFwhmMm.toExponential(2) : dl.axialFwhmMm.toFixed(3)} mm. `
      + (mode === 'optical'
        ? 'Note that diffraction is NOT what limits optical targeting - the wavelength is so short that '
          + 'the diffraction limit is far finer than a single neuron. The obstacle is scattering, '
          + 'not resolution.'
        : 'Millimetre-scale targeting is squarely within the diffraction limit at this frequency, which '
          + 'is why transcranial focused ultrasound achieves it clinically today.'),
    numbers: {
      apertureHalfAngleDeg: (halfAngle * 180) / Math.PI,
      NA: dl.NA,
      lateralFwhmMm: dl.lateralFwhmMm,
      axialFwhmMm: dl.axialFwhmMm,
    },
  });

  // -------------------------------------------------------------------------
  // 4. Simulated focus vs the ideal
  // -------------------------------------------------------------------------
  if (shape && Number.isFinite(shape.lateralFwhmMm)) {
    findings.push({
      severity: shape.lateralFwhmMm <= 5 ? 'ok' : 'warning',
      code: 'simulated-focus',
      title: `Simulated focus: ${shape.lateralFwhmMm.toFixed(2)} mm lateral x `
        + `${shape.axialFwhmMm.toFixed(2)} mm axial`,
      detail:
        `-6 dB focal volume ${shape.focalVolumeMm3.toFixed(2)} mm^3. The axial extent is `
        + `${(shape.axialFwhmMm / Math.max(1e-9, shape.lateralFwhmMm)).toFixed(1)}x the lateral extent: `
        + `foci from an external aperture are always elongated along the beam, so "a point" is really a `
        + `cigar unless the array surrounds the target.`,
      numbers: {
        lateralFwhmMm: shape.lateralFwhmMm,
        axialFwhmMm: shape.axialFwhmMm,
        focalVolumeMm3: shape.focalVolumeMm3,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 5. Selectivity: how many OTHER places are above threshold?
  // -------------------------------------------------------------------------
  const noField = !(shape?.peakModelIntensity > 0);
  if (noField) {
    findings.push({
      severity: 'fatal',
      code: 'selectivity',
      title: 'No measurable field at the target: selectivity is undefined',
      detail:
        'The coherent field amplitude at the target underflows double precision, so there is no focus '
        + 'to characterise and no background to compare it against. Peak-to-background, focus width and '
        + 'targeting error are all meaningless for this configuration and are not reported.',
      numbers: {},
    });
  } else if (sliceStats) {
    const pbr = sliceStats.peakToBackground;
    const spotCount = hotspots ? hotspots.spots.length : null;
    const sev = pbr < 3 ? 'fatal' : pbr < 10 ? 'severe' : pbr < 50 ? 'warning' : 'ok';
    findings.push({
      severity: sev,
      code: 'selectivity',
      title: `Peak-to-background ratio ${Number.isFinite(pbr) ? pbr.toFixed(1) : 'infinite'}`
        + (spotCount !== null ? `, ${spotCount} hotspot${spotCount === 1 ? '' : 's'} above 50% of peak` : ''),
      detail:
        `Only ${(sliceStats.focusEnergyFraction * 100).toFixed(1)}% of the in-slice intensity lands in `
        + `the focus itself. Every additional hotspot above the opsin's activation threshold is a `
        + `population of neurons being driven that you did not select. A peak-to-background ratio below `
        + `about 10 means the "background" is also stimulating.`,
      numbers: {
        peakToBackground: pbr,
        hotspotCount: spotCount,
        focusEnergyFraction: sliceStats.focusEnergyFraction,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 5b. Energy deposited outside the brain
  // -------------------------------------------------------------------------
  if (o.extracranialPeak && shape?.peakModelIntensity > 0) {
    const ratio = o.extracranialPeak.max / shape.peakModelIntensity;
    findings.push({
      severity: ratio > 10 ? 'severe' : ratio > 1 ? 'warning' : 'ok',
      code: 'extracranial',
      title: `Peak intensity in scalp/skull is ${ratio < 0.01 ? ratio.toExponential(2) : ratio.toFixed(2)}x the focus`,
      detail: mode === 'acoustic'
        ? 'Bone has nearly twice the acoustic impedance of brain, so pressure rises on entry, and the '
          + 'skull is both the most absorbing layer and the closest one to the array. Skull heating, not '
          + 'focal heating, is the dominant safety limit in clinical transcranial ultrasound; it is '
          + 'managed with active scalp cooling and duty-cycle limits. This is an engineering constraint '
          + 'with known mitigations, not a barrier.'
        : 'For an optical scheme this ratio is the whole story: essentially all the energy stops in the '
          + 'scalp and skull. That is the same effect as a torch held against your hand - the hand glows '
          + 'because light is diffusing a short way through it, not because any of it is being steered.',
      numbers: { extracranialToFocusRatio: ratio },
    });
  }

  // -------------------------------------------------------------------------
  // 6. Opsin / wavelength compatibility
  // -------------------------------------------------------------------------
  let opsinInfo = null;
  if (mode === 'optical') {
    opsinInfo = opsinCheck(opsin, model.drive);
    if (opsinInfo.hypothetical) {
      findings.push({
        severity: 'severe',
        code: 'opsin-hypothetical',
        title: 'This opsin does not exist',
        detail:
          `"${opsinInfo.opsin}" is a placeholder for the long-wavelength opsin the premise assumes will `
          + `arrive. Single-photon channelrhodopsins are retinal-based, and the energy needed to isomerise `
          + `retinal sets a ceiling on the longest usable wavelength somewhere around 700-750 nm. Pushing `
          + `beyond that is not a matter of screening more proteins; it needs a different photochemistry `
          + `or a multi-photon or upconversion scheme. See docs/BIOLOGY.md.`,
        numbers: { peakNm: opsinInfo.peakNm },
      });
    } else if (!opsinInfo.inRange) {
      findings.push({
        severity: 'severe',
        code: 'opsin-wavelength',
        title: `${model.drive} nm is outside the action spectrum of ${opsinInfo.opsin}`,
        detail:
          `${opsinInfo.opsin} responds over ${opsinInfo.usableRangeNm[0]}-${opsinInfo.usableRangeNm[1]} nm `
          + `(peak ${opsinInfo.peakNm} nm). At ${model.drive} nm the relative efficiency is `
          + `${(opsinInfo.relativeEfficiency * 100).toExponential(1)}%, so the required irradiance rises `
          + `accordingly. ${opsinInfo.ref}`,
        numbers: {
          driveNm: model.drive, peakNm: opsinInfo.peakNm,
          relativeEfficiency: opsinInfo.relativeEfficiency,
        },
      });
    } else {
      findings.push({
        severity: 'ok',
        code: 'opsin-wavelength',
        title: `${model.drive} nm drives ${opsinInfo.opsin} at `
          + `${(opsinInfo.relativeEfficiency * 100).toFixed(0)}% of peak efficiency`,
        detail: `Activation threshold ${(opsinInfo.thresholdIrradiance * 1e3).toPrecision(2)} mW/mm^2. ${opsinInfo.ref}`,
        numbers: {
          relativeEfficiency: opsinInfo.relativeEfficiency,
          thresholdIrradiance: opsinInfo.thresholdIrradiance,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 7. Power budget and exposure safety
  // -------------------------------------------------------------------------
  const targetIrradiance = o.targetIrradiance
    ?? (mode === 'optical' ? (opsinInfo?.effectiveThreshold ?? 1e-3) : 1e-3);

  const budget = powerBudget({
    modelIntensityAtTarget: shape?.peakModelIntensity ?? 0,
    targetIrradiance,
    emitterCount: emitters.length,
    weights,
    emitterApertureMm2,
    mode,
  });

  if (!budget.feasible) {
    const over = budget.limit > 0 ? budget.surfaceIrradiance / budget.limit : Infinity;
    findings.push({
      severity: over > 1e3 ? 'fatal' : 'severe',
      code: 'exposure',
      title: Number.isFinite(over)
        ? `Required surface exposure exceeds the safety limit by ${fmtLog10(Math.log10(over))}x`
        : 'Required surface exposure is unbounded: no coherent field arrives at all',
      detail:
        `To reach ${(targetIrradiance * 1e3).toPrecision(3)} mW/mm^2 at the focus the array must emit `
        + `${Number.isFinite(budget.totalPowerW) ? budget.totalPowerW.toExponential(2) : 'infinite'} W, `
        + `putting ${Number.isFinite(budget.surfaceIrradiance) ? budget.surfaceIrradiance.toExponential(2) : 'infinite'} `
        + `W/mm^2 on the scalp against a limit of ${budget.limit.toExponential(2)} W/mm^2. `
        + `${budget.limitRef}. `
        + (mode === 'optical'
          ? 'The scalp would be destroyed - and then vaporised - long before a usable number of photons '
            + 'reached the target coherently.'
          : 'Lowering the frequency or widening the aperture both reduce the surface intensity needed.'),
      numbers: {
        targetIrradiance,
        totalPowerW: budget.totalPowerW,
        surfaceIrradiance: budget.surfaceIrradiance,
        limit: budget.limit,
        overLimitFactor: over,
      },
    });
  } else {
    findings.push({
      severity: budget.headroom < 2 ? 'warning' : 'ok',
      code: 'exposure',
      title: `Surface exposure within limits, ${budget.headroom.toFixed(1)}x headroom`,
      detail:
        `Total emitted power ${budget.totalPowerW.toExponential(2)} W gives `
        + `${budget.surfaceIrradiance.toExponential(2)} W/mm^2 at the surface against a limit of `
        + `${budget.limit.toExponential(2)} W/mm^2. ${budget.limitRef}`,
      numbers: {
        totalPowerW: budget.totalPowerW,
        surfaceIrradiance: budget.surfaceIrradiance,
        headroom: budget.headroom,
      },
    });
  }

  // -------------------------------------------------------------------------
  // 8. Thermal
  // -------------------------------------------------------------------------
  const absorptionAtTarget = mode === 'optical'
    ? brainShell.mua
    : (2 * brainShell.muAmp);
  const thermal = thermalRise({
    irradiance: targetIrradiance,
    absorptionPerMm: absorptionAtTarget,
    radiusMm: Math.max(0.1, (shape?.lateralFwhmMm ?? 2) / 2),
  });
  findings.push({
    severity: thermal.safe ? 'ok' : (thermal.deltaT > 10 ? 'fatal' : 'severe'),
    code: 'thermal',
    title: `Focal temperature rise ${thermal.deltaT < 0.01
      ? thermal.deltaT.toExponential(2) : thermal.deltaT.toFixed(3)} degC`,
    detail:
      `Volumetric heating ${thermal.volumetricHeatWPerMm3.toExponential(2)} W/mm^3 at the focus. `
      + `Conduction-limited rise ${thermal.conductionLimitedDeltaT.toExponential(2)} degC, `
      + `perfusion-limited ceiling ${thermal.perfusionLimitedDeltaT.toExponential(2)} degC. `
      + `Conservative continuous limit is ${SAFETY.brainSafeDeltaT} degC `
      + `(CEM43 threshold ~${SAFETY.brainCem43Threshold} min for CNS tissue). `
      + `Note this counts only the focus; for optical schemes the scalp, not the focus, is what cooks.`,
    numbers: { deltaT: thermal.deltaT, volumetricHeatWPerMm3: thermal.volumetricHeatWPerMm3 },
  });

  // -------------------------------------------------------------------------
  // 9. Mode-specific extras
  // -------------------------------------------------------------------------
  if (mode === 'optical' && coherence.transportLengths > 1) {
    const vol = shape?.focalVolumeMm3 ?? 1;
    const modes = speckleModeCount(vol, lambdaMm, brainShell.n);
    const contrast = wavefrontShapingContrast(emitters.length, modes);
    findings.push({
      severity: 'severe',
      code: 'wavefront-shaping',
      title: 'Even a measured transmission matrix would not help with this few elements',
      detail:
        `If you abandoned the analytic phase model and measured the actual transmission matrix `
        + `(wavefront shaping with a guidestar), the focus contrast you could buy is about `
        + `(pi/4)(N/M) with N controlled modes against M speckle modes. Here N = ${emitters.length} `
        + `and M = ${modes.toExponential(2)} speckle modes in the focal volume, giving a contrast of `
        + `${contrast.toExponential(2)} - no focus at all. You would need N comparable to M. `
        + `And living brain speckle decorrelates in roughly a millisecond from blood flow, so the `
        + `measurement would be stale before you could use it. `
        + `(Vellekoop & Mosk, Opt Lett 32:2309, 2007; Horstmeyer, Ruan & Yang, Nat Photonics 9:563, 2015.)`,
      numbers: { controlledModes: emitters.length, speckleModes: modes, contrast },
    });
  }

  const skull = mode === 'acoustic' ? model.props.find((p) => p.layer === 'skull') : null;
  if (skull) {
    const thickness = head.thicknessOf('skull');
    const skullLossDb = skull.alphaDbPerCm * (thickness / 10);
    findings.push({
      severity: skullLossDb > 20 ? 'severe' : 'warning',
      code: 'skull-aberration',
      title: `Skull costs ${skullLossDb.toFixed(1)} dB and must be phase-corrected`,
      detail:
        `The skull's speed of sound (${(skull.speed / 1e6).toFixed(2)} km/s) is nearly twice that of `
        + `brain, so an uncorrected array focuses nowhere near the target. This planner applies a `
        + `straight-ray per-layer time-of-flight correction, which is exactly the first-order method used `
        + `clinically from CT-derived skull maps (Clement & Hynynen, Phys Med Biol 47:1219, 2002). Real `
        + `skulls are heterogeneous and locally variable in thickness, so a per-subject CT or MR-based `
        + `correction is mandatory; a spherical-shell model is not sufficient on a real head.`,
      numbers: { skullLossDb, skullSpeedMps: skull.speed / 1e3, skullThicknessMm: thickness },
    });
    findings.push({
      severity: 'warning',
      code: 'standing-waves',
      title: 'Standing waves and cavitation need checking at the bench',
      detail:
        'A closed, roughly spherical cavity with a high-impedance wall supports standing waves, which '
        + 'can put pressure maxima where the model says there are none. Clinical systems sweep frequency '
        + 'or use short bursts to break them up. Mechanical index and cavitation thresholds are not '
        + 'modelled here and must be evaluated separately before any exposure.',
      numbers: {},
    });
  }

  // -------------------------------------------------------------------------
  // Overall verdict
  // -------------------------------------------------------------------------
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const worst = findings.length ? findings[0].severity : 'ok';
  const counts = findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});

  const verdict = {
    fatal: 'Physically impossible as configured',
    severe: 'Not achievable with current technology',
    warning: 'Plausible, with real engineering obstacles',
    ok: 'No blocking obstacle found',
  }[worst];

  return {
    verdict,
    worstSeverity: worst,
    counts,
    findings,
    coherence,
    budget,
    thermal,
    diffraction: dl,
    gratingLobes: gl,
    pitchMm: pitch,
    opsin: opsinInfo,
    targetIrradiance,
  };
}
