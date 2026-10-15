/**
 * Tissue optical and acoustic properties.
 *
 * Every number here is traceable to a published source. Where sources disagree
 * the spread is noted in a comment, because the spread matters more than the
 * mean for the conclusions this repo draws.
 *
 * Units used throughout the whole codebase, no exceptions:
 *   length        mm
 *   wavelength    nm  (optical)  /  frequency Hz (acoustic)
 *   coefficients  1/mm
 *   speed         mm/s
 *   density       kg/m^3
 *   power         W
 *   irradiance    W/mm^2   (1 W/mm^2 = 100 W/cm^2)
 *   temperature   degC
 */

// ---------------------------------------------------------------------------
// Chromophore spectra (optical absorption)
// ---------------------------------------------------------------------------

/**
 * Molar extinction coefficients of oxy- and deoxy-haemoglobin,
 * cm^-1 / (mol/L), compiled by S. Prahl (Oregon Medical Laser Center),
 * from W. B. Gratzer (Med. Res. Council Labs) and N. Kollias (Wellman Labs).
 * https://omlc.org/spectra/hemoglobin/summary.html
 *
 * Converted to mua via:  mua = ln(10) * eps * C   with C in mol/L.
 * Whole blood at 150 g Hb / L and MW 64500 g/mol gives C = 2.33e-3 mol/L.
 */
export const HB_SPECTRA = {
  // nm:   [eps_HbO2, eps_Hb]
  400: [266232, 223296], 420: [305016, 319908], 440: [116136, 102580],
  460: [33210, 42850], 480: [18870, 29858], 500: [20862, 20862],
  520: [32604, 32604], 540: [53236, 44480], 560: [39036, 53788],
  580: [50104, 38142], 600: [14592, 14400], 620: [3200, 5588],
  640: [1506, 4930], 660: [862, 3226], 680: [740, 2088],
  700: [690, 1506], 720: [730, 1156], 740: [830, 1026],
  760: [1017, 1548], 780: [1152, 1311], 800: [1277, 1075],
  820: [1399, 946], 840: [1515, 870], 860: [1613, 818],
  880: [1700, 790], 900: [1760, 772], 920: [1815, 770],
  940: [1859, 780], 960: [1888, 800], 980: [1898, 826],
  1000: [1894, 858],
};

/**
 * Pure water absorption coefficient, 1/mm.
 * Hale & Querry, Appl. Opt. 12:555 (1973) for lambda > 700 nm;
 * Pope & Fry, Appl. Opt. 36:8710 (1997) in the visible.
 *
 * This is the term that closes the "just use a longer wavelength" door:
 * water absorption climbs by ~4 orders of magnitude from 700 to 1450 nm.
 */
export const WATER_ABSORPTION = {
  400: 6.4e-6, 450: 9.0e-6, 500: 2.1e-5, 550: 5.7e-5, 600: 2.2e-4,
  650: 3.2e-4, 700: 6.0e-4, 750: 2.6e-3, 800: 2.0e-3, 850: 4.3e-3,
  900: 6.8e-3, 950: 3.9e-2, 1000: 3.6e-2, 1050: 1.6e-2, 1100: 1.5e-2,
  1150: 3.5e-2, 1200: 1.0e-1, 1250: 9.5e-2, 1300: 1.4e-1, 1350: 5.0e-1,
  1400: 1.2e0, 1450: 2.9e0, 1500: 2.0e0, 1600: 7.0e-1, 1700: 5.5e-1,
};

// ---------------------------------------------------------------------------
// Optical tissue layers
// ---------------------------------------------------------------------------

/**
 * Reduced scattering follows the Mie power law  mus'(lambda) = a * (lambda/500)^-b,
 * with a in 1/mm at 500 nm. Fit parameters from:
 *   S. L. Jacques, "Optical properties of biological tissues: a review",
 *   Phys. Med. Biol. 58:R37 (2013), Table 1 / Eq. 2.
 *
 * Anisotropy g ~ 0.9 for all of these in the red/NIR, so the single-scattering
 * coefficient is mus = mus' / (1 - g), i.e. ~10x the reduced value. That factor
 * of 10 is the single most important number in this repository: it is what
 * destroys the ballistic (phase-coherent) field.
 *
 * bloodFraction / oxygenSat / waterFraction feed the chromophore model for mua.
 */
export const OPTICAL_LAYERS = {
  scalp: {
    name: 'Scalp / skin',
    musPrime500: 3.72, scatteringPower: 1.39,   // Jacques 2013, skin (dermis)
    g: 0.90,
    bloodFraction: 0.020, oxygenSat: 0.70, waterFraction: 0.65,
    baselineMua: 0.015,                          // melanin + protein background
    refractiveIndex: 1.37,
  },
  skull: {
    name: 'Cranial bone',
    musPrime500: 2.00, scatteringPower: 1.05,   // Jacques 2013, skull/bone
    g: 0.92,
    bloodFraction: 0.010, oxygenSat: 0.70, waterFraction: 0.30,
    baselineMua: 0.010,
    refractiveIndex: 1.56,
  },
  csf: {
    name: 'Cerebrospinal fluid',
    musPrime500: 0.03, scatteringPower: 0.50,   // nearly transparent
    g: 0.90,
    bloodFraction: 0.000, oxygenSat: 0.98, waterFraction: 0.99,
    baselineMua: 0.0005,
    refractiveIndex: 1.335,
  },
  greyMatter: {
    name: 'Cortical grey matter',
    musPrime500: 2.42, scatteringPower: 1.611,  // Jacques 2013, brain/grey
    g: 0.88,
    bloodFraction: 0.040, oxygenSat: 0.70, waterFraction: 0.80,
    baselineMua: 0.003,
    refractiveIndex: 1.37,
  },
  whiteMatter: {
    name: 'White matter',
    // Myelin makes white matter the most strongly scattering tissue here, and
    // also the least agreed-upon: published mus'(500) for human white matter
    // spans roughly 3-11 /mm, and g estimates run from 0.88 to 0.97. The value
    // below sits mid-range and reproduces the scattering mean free path of
    // ~25 um at 800 nm that the review literature reports. The conclusions in
    // this repository are insensitive to the choice: the full spread moves the
    // ballistic survival exponent between about e^-700 and e^-3000, all of
    // which are zero in any operational sense.
    musPrime500: 6.0, scatteringPower: 0.334,
    g: 0.90,
    bloodFraction: 0.020, oxygenSat: 0.70, waterFraction: 0.70,
    baselineMua: 0.004,
    refractiveIndex: 1.40,
  },
};

// ---------------------------------------------------------------------------
// Acoustic tissue layers
// ---------------------------------------------------------------------------

/**
 * Acoustic properties. Sources:
 *   Duck, "Physical Properties of Tissue" (1990);
 *   Fry & Barger, J. Acoust. Soc. Am. 63:1576 (1978) for skull;
 *   Pinton et al., Med. Phys. 39:299 (2012) for skull attenuation/heterogeneity;
 *   White et al., Ultrasound Med. Biol. 32:1085 (2006) for skull speed.
 *
 * alphaDbCmMHz is attenuation in dB/cm at 1 MHz; alphaPower is the exponent in
 * alpha(f) = alpha0 * f^n. Soft tissue n ~ 1.1-1.3; skull n ~ 1.0-1.3 and the
 * literature spread there is genuinely large (Pinton 2012 reports 2.7 dB/cm/MHz
 * for a *homogenised* skull model, Fry & Barger up to ~20 for cortical bone).
 * The default below is deliberately pessimistic-but-typical for whole skull.
 */
export const ACOUSTIC_LAYERS = {
  water: {
    name: 'Coupling water',
    speed: 1.482e6, density: 1000,
    alphaDbCmMHz: 0.0022, alphaPower: 2.0,
  },
  scalp: {
    name: 'Scalp / soft tissue',
    speed: 1.540e6, density: 1050,
    alphaDbCmMHz: 0.55, alphaPower: 1.2,
  },
  skull: {
    name: 'Cranial bone',
    speed: 2.820e6, density: 1908,
    alphaDbCmMHz: 11.0, alphaPower: 1.1,
  },
  csf: {
    name: 'Cerebrospinal fluid',
    speed: 1.504e6, density: 1007,
    alphaDbCmMHz: 0.01, alphaPower: 1.5,
  },
  greyMatter: {
    name: 'Cortical grey matter',
    speed: 1.546e6, density: 1046,
    alphaDbCmMHz: 0.58, alphaPower: 1.3,
  },
  whiteMatter: {
    name: 'White matter',
    speed: 1.552e6, density: 1041,
    alphaDbCmMHz: 0.82, alphaPower: 1.3,
  },
};

// ---------------------------------------------------------------------------
// Opsins
// ---------------------------------------------------------------------------

/**
 * Activation thresholds are the irradiance needed for reliable spiking in the
 * cited preparation; they vary with expression level, so treat them as an order
 * of magnitude, not a constant. "demonstrated" = published in vivo.
 */
export const OPSINS = {
  ChR2: {
    name: 'ChR2 (H134R)',
    peakNm: 470, usableRangeNm: [420, 520],
    thresholdIrradiance: 1.0e-3,          // ~1 mW/mm^2
    ref: 'Boyden, Zhang, Bamberg, Nagel & Deisseroth, Nat Neurosci 8:1263 (2005)',
  },
  C1V1: {
    name: 'C1V1 (E122T/E162T)',
    peakNm: 540, usableRangeNm: [480, 600],
    thresholdIrradiance: 5.0e-4,
    ref: 'Yizhar et al., Nature 477:171 (2011)',
  },
  ReaChR: {
    name: 'ReaChR',
    peakNm: 590, usableRangeNm: [530, 650],
    thresholdIrradiance: 3.0e-4,
    // First demonstration of driving neurons through an intact mouse skull.
    ref: 'Lin, Knutsen, Muller, Kleinfeld & Tsien, Nat Neurosci 16:1499 (2013)',
  },
  ChrimsonR: {
    name: 'ChrimsonR (K176R)',
    peakNm: 590, usableRangeNm: [550, 735],
    thresholdIrradiance: 1.0e-3,
    // Spikes reported in cortical slice with >20 ms pulses at 735 nm.
    ref: 'Klapoetke et al., Nat Methods 11:338 (2014), Suppl. Fig. 13',
  },
  ChRmine: {
    name: 'ChRmine',
    peakNm: 585, usableRangeNm: [520, 660],
    // In vivo transcranial work puts the practical floor near 0.1 mW/mm^2:
    // Monte Carlo there gives ~0.02% of 400 mW/mm^2 reaching 7 mm, described
    // as "near the sensitivity limit predicted for ChRmine".
    thresholdIrradiance: 1.0e-4,
    ref: 'Marshel et al., Science 365:eaaw5202 (2019); sensitivity floor from '
      + 'Chen et al., Nat Biotechnol 39:161 (2021). Source organism is disputed: '
      + 'Marshel reports Tiarina fusus, later work attributes it to Rhodomonas lens.',
  },
  hsChRmine: {
    name: 'hsChRmine (high-speed)',
    peakNm: 590, usableRangeNm: [520, 670],
    thresholdIrradiance: 3.0e-4,          // faster kinetics, less sensitive
    ref: 'Kishi et al., Cell 185:672 (2022)',
  },
  rsChRmine: {
    name: 'rsChRmine (red-shifted)',
    peakNm: 600, usableRangeNm: [540, 750],
    thresholdIrradiance: 2.0e-4,
    // The longest wavelength at which ANY single-photon opsin has been shown
    // to drive neurons in vivo: 720 and 750 nm, at elevated power. Wild-type
    // ChRmine and ChrimsonR gave no response at those wavelengths.
    ref: 'Kishi et al., Cell 185:672 (2022), Fig. 7I-J',
  },
  // Deliberately included so the planner can show what a hypothetical NIR
  // opsin would and would not fix. No such single-photon opsin exists, and
  // there is a photochemical reason to expect none ever will: see
  // docs/BIOLOGY.md on the ~700 nm retinal ceiling.
  hypotheticalNIR: {
    name: 'Hypothetical 1000 nm opsin (does not exist)',
    peakNm: 1000, usableRangeNm: [900, 1100],
    thresholdIrradiance: 1.0e-5,
    hypothetical: true,
    ref: 'Speculative. The longest demonstrated single-photon opsin is '
      + 'rsChRmine at 750 nm; the thermal-noise argument of Luo, Yue, '
      + 'Ala-Laurila & Yau, Science 332:1307 (2011) makes a 1000 nm '
      + 'retinal-based channel implausible in principle.',
  },
};

// ---------------------------------------------------------------------------
// Safety limits
// ---------------------------------------------------------------------------

export const SAFETY = {
  /**
   * ANSI Z136.1 maximum permissible exposure, skin, CW, long exposure (>10 s).
   * 0.2 W/cm^2 in 400-1400 nm = 2.0e-3 W/mm^2. This is the limit on what you
   * are allowed to put on the scalp, and it is the binding constraint for any
   * transcranial optical scheme.
   */
  skinMpeCw: 2.0e-3,                       // W/mm^2
  skinMpeRef: 'ANSI Z136.1-2022, Table 7 (skin MPE, 400-1400 nm, t > 10 s)',

  /**
   * Brain tissue thermal damage. CEM43 (cumulative equivalent minutes at 43 C)
   * thresholds: ~2 min for CNS white matter is the conservative figure.
   * Yarmolenko et al., Int J Hyperthermia 27:320 (2011).
   */
  brainCem43Threshold: 2.0,                // minutes
  brainSafeDeltaT: 1.0,                    // degC, conservative continuous rise

  /**
   * FDA diagnostic ultrasound track-3 limits; low-intensity transcranial FUS
   * neuromodulation studies generally stay under these.
   * ISPTA.3 720 mW/cm^2 = 7.2e-3 W/mm^2 ; mechanical index 1.9.
   */
  ultrasoundIsptaLimit: 7.2e-3,            // W/mm^2
  mechanicalIndexLimit: 1.9,
  ultrasoundRef: 'FDA Guidance: Marketing Clearance of Diagnostic Ultrasound Systems (2023)',
};

// ---------------------------------------------------------------------------
// Thermal properties (Pennes bioheat)
// ---------------------------------------------------------------------------

export const THERMAL = {
  brainConductivity: 0.528e-3,   // W/(mm*degC)   -- 0.528 W/(m*K)
  brainSpecificHeat: 3630,       // J/(kg*degC)
  brainDensity: 1046e-9,         // kg/mm^3
  bloodPerfusion: 9.0e-3,        // 1/s  (~540 mL/100g/min cerebral blood flow)
  bloodSpecificHeat: 3840,       // J/(kg*degC)
  bloodDensity: 1050e-9,         // kg/mm^3
  baselineTemp: 37.0,            // degC
  ref: 'Pennes, J Appl Physiol 1:93 (1948); IT IS Foundation tissue database v4.0',
};

// ---------------------------------------------------------------------------
// Anatomy defaults (adult human head, and mouse for comparison)
// ---------------------------------------------------------------------------

export const HEAD_PRESETS = {
  humanAdult: {
    name: 'Human adult',
    // Radii of concentric shells, outermost first, in mm.
    // Typical adult: outer scalp radius ~92 mm, scalp 6 mm, skull 7 mm, CSF 2 mm.
    shells: [
      { layer: 'scalp', outerRadius: 92 },
      { layer: 'skull', outerRadius: 86 },
      { layer: 'csf', outerRadius: 79 },
      { layer: 'greyMatter', outerRadius: 77 },
      { layer: 'whiteMatter', outerRadius: 68 },
    ],
    ref: 'Spherical approximation; shell thicknesses after Okada et al., Appl Opt 36:21 (1997)',
  },
  mouse: {
    name: 'Mouse',
    shells: [
      { layer: 'scalp', outerRadius: 5.6 },
      { layer: 'skull', outerRadius: 5.3 },
      { layer: 'csf', outerRadius: 5.0 },
      { layer: 'greyMatter', outerRadius: 4.9 },
      { layer: 'whiteMatter', outerRadius: 3.2 },
    ],
    ref: 'Approximate adult C57BL/6 dimensions',
  },
};

export const SPEED_OF_LIGHT = 2.998e11; // mm/s
