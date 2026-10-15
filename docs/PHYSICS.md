# Physics

The model, the numbers it uses, and where each one comes from.

---

## 1. The forward model

For an emitter at **A** and a field point at **B**, the scalar Green's function is

```
G(B, A) = (T / |B−A|) · exp(−Σ µ_amp,i L_i) · exp(i K Σ w_i L_i)
```

where `L_i` are the path lengths through each tissue shell, `T` is the product
of interface transmission coefficients, and `(K, w_i)` carry the phase:

| | phase weight `w_i` | `K` |
|---|---|---|
| optical | refractive index `n_i` | `2π/λ₀` |
| acoustic | slowness ratio `c_ref/c_i` | `2πf/c_ref` |

The total field is `E(B) = Σ_j w_j G(B, A_j)` for complex emitter weights `w_j`.

### Amplitude attenuation: the one choice that decides everything

For a **phase-coherent** (ballistic) field, a photon that scatters is gone — it
no longer arrives with a predictable phase. So the coherent amplitude decays
with the **total** interaction coefficient

```
µ_t = µ_a + µ_s          (not µ_a + µ_s′)
```

halved for amplitude, since intensity goes as `|E|²`.

For **total energy** — what a power meter reads — the relevant quantity is the
diffusion effective attenuation

```
µ_eff = √(3 µ_a (µ_a + µ_s′))
```

which is vastly smaller. Both are computed; only the first is propagated,
because only the first can interfere.

The gap between them is the whole story. At 800 nm in grey matter,
`µ_t ≈ 9.5 /mm` while `µ_eff ≈ 0.33 /mm` — a factor of 29 in the exponent, which
over 50 mm is a factor of `e^458` in the result.

---

## 2. The fast exact path integral

Concentric shells admit a closed form, so there is no ray marching and no root
sorting.

Put the origin at the head centre, let **u** be the unit vector A→B, and let `s`
be arclength along the ray measured from its closest approach to the origin.
Then `s_A = A·u`, `s_B = B·u`, and the perpendicular miss distance satisfies
`p² = |A|² − s_A²`. The ray is inside radius `R` exactly where `|s| < q` with
`q = √(R² − p²)`, so the length it spends inside radius `R` is

```
len(R) = max(0, min(s_B, q) − max(s_A, −q))
```

and the length inside shell `i` is `len(R_i) − len(R_{i+1})`.

With `|A|` fixed on the emitter shell, a single dot product drives everything:

```
d²  = |A|² + |B|² − 2 A·B
s_A = (A·B − |A|²) / d
s_B = (|B|² − A·B) / d
```

One square root per shell, no allocation, exact. `test/test-geometry.js` checks
it against brute-force ray segmentation over ~1000 emitter/point pairs and
requires agreement to **10⁻⁹ mm** — about 10⁻⁶ of an optical wavelength.

### Straight rays

Refraction is not traced. This is defensible for different reasons in each mode:

- **Ultrasound**: per-element time-of-flight along straight rays through a
  speed-of-sound map *is* the first-order aberration correction used clinically
  (Clement & Hynynen, *Phys Med Biol* 47:1219, 2002). Real systems refine it;
  straight-ray gets most of the way.
- **Light**: a few degrees of ray bending is irrelevant beside scattering, which
  dominates by hundreds of orders of magnitude.

---

## 3. Tissue optics

### Scattering

Reduced scattering follows the Mie power law `µs′(λ) = a (λ/500)^(−b)`, with
coefficients from **Jacques, "Optical properties of biological tissues: a
review", *Phys Med Biol* 58:R37 (2013)**, Table 1.

| Tissue group | a (cm⁻¹) | b | n studies |
|---|---|---|---|
| Skin | 46.0 ± 13.7 | 1.421 ± 0.517 | 8 |
| Brain | 24.2 ± 11.7 | 1.611 ± 1.063 | 8 |
| Bone | 22.9 ± 14.6 | 0.716 ± 0.682 | 3 |

Note the standard deviations: brain's `b` has an SD of 66% of its mean. This
literature genuinely disagrees with itself, and per-study skull values span 4×
in `a` (Bevilacqua 1999 human in vivo: 9.5, 0.141 · Firbank 1993 pig in vitro:
20.9, 0.537 · Alexandrakis 2005: 38.4, 1.470).

The single-scattering coefficient is `µs = µs′/(1−g)` with `g ≈ 0.88–0.92`, so
`µs` is roughly **ten times** `µs′`. That factor of ten is the most important
number in this repository.

White matter is the least agreed-upon: published `µs′(500)` spans about
3–11 /mm and `g` estimates run 0.88–0.97. `src/constants.js` sits mid-range and
reproduces the ~25 µm scattering mean free path at 800 nm that the review
literature reports. The full spread moves the ballistic survival exponent
between roughly `e^−700` and `e^−3000` — every one of which is zero.

### Absorption

Computed from a chromophore model rather than tabulated per tissue:

```
µa = ln(10)·C_Hb·(S·ε_HbO₂ + (1−S)·ε_Hb)/10 + W·µa_water(λ) + baseline
```

with haemoglobin extinction spectra compiled by **S. Prahl** (OMLC, from Gratzer
and Kollias) and water absorption from **Hale & Querry, *Appl Opt* 12:555
(1973)** and **Pope & Fry, *Appl Opt* 36:8710 (1997)**.

This makes the wavelength dependence continuous and visible: blue light is
absorbed by haemoglobin, beyond ~1100 nm water takes over, and the "tissue
window" in between is a trough, not a door.

### Mean free paths, and where ballistic light dies

At 800 nm:

| Tissue | `l_s = 1/µs` | `l_t = 1/µs′` |
|---|---|---|
| Grey matter | ~90 µm | ~0.9 mm |
| White matter | ~25 µm | ~0.25 mm |
| Skull | ~30 µm | — |

The diffusive regime begins past about **10 transport mean free paths**.
Quasi-ballistic imaging with time gating reaches 10–20 scattering lengths —
`e^−20 = 2×10⁻⁹` is detectable, `e^−100` is not.

Ballistic photons are gone within roughly **0.9 mm of grey matter** and
**0.3 mm of white matter**. Independently: Horstmeyer, Ruan & Yang
(*Nat Photonics* 9:563, 2015) state "optical scattering has traditionally
limited the range of imaging within tissue to a depth of one millimetre."

### Cumulative survival through a head

Scattering mean free paths crossed, and the surviving ballistic fraction:

| λ | scalp+skull | +20 mm brain | +50 mm brain |
|---|---|---|---|
| 480 nm | e⁻²⁶⁷ | e⁻⁹⁷⁶ | e⁻²⁰³⁹ |
| 630 nm | e⁻²¹⁸ | e⁻⁷⁹⁹ | e⁻¹⁶⁷² |
| 800 nm | e⁻²³² | e⁻⁷³² | e⁻¹⁴⁸¹ |
| 1300 nm | e⁻³⁰¹ | e⁻⁶⁸⁷ | e⁻¹²⁶⁵ |

`e⁻¹⁴⁸¹ ≈ 10⁻⁶⁴³`. A 1 J pulse at 800 nm holds ~4×10¹⁸ photons; the observable
universe holds ~10⁸⁰ baryons.

Two consequences worth stating:

1. **`l_s` in white matter is essentially wavelength-independent** (22 → 30 µm
   from 480 to 1300 nm), because rising `g` cancels falling `µs′`. *Going redder
   buys diffuse penetration, not ballistic penetration.*
2. **1300 nm is the worst choice for ballistic work** in scalp and skull,
   despite being attractive for OCT, because both `g` and water absorption rise.

Measured human skull transmission for comparison — **Jagdeo et al., *PLoS One*
7:e47460 (2012)**, cadaver, ~10 mm soft tissue + bone: at 830 nm, 0.9%
(temporal) to 11.7% (occipital); at 633 nm, <0.0015% to 0.65%. All of it *total
diffuse*. None of it focusable.

---

## 4. Tissue acoustics

Properties from Duck, *Physical Properties of Tissue* (1990); Fry & Barger,
*JASA* 63:1576 (1978); White et al., *UMB* 32:1085 (2006).

| | c (m/s) | ρ (kg/m³) | α (dB/cm/MHz) |
|---|---|---|---|
| Water | 1482 | 1000 | 0.0022 |
| Scalp | 1540 | 1050 | 0.55 |
| Skull | 2820 | 1908 | ~11 |
| Grey matter | 1546 | 1046 | 0.58 |
| White matter | 1552 | 1041 | 0.82 |

Skull attenuation is where the literature spread is largest: Pinton et al.
(*Med Phys* 39:299, 2012) report 2.7 dB/cm/MHz for a *homogenised* skull, Fry &
Barger up to ~20 for cortical bone. The default here is deliberately
pessimistic-but-typical for whole skull.

**Why this changes everything.** At 650 kHz the wavelength in brain is 2.38 mm —
three orders of magnitude larger than a cell. Tissue is acoustically
near-homogeneous at that scale, so there is no scattering term at all.
Attenuation is absorption: it costs amplitude, not predictability. The field
stays coherent across the entire head.

The skull remains hard. Its speed of sound is nearly twice brain's, so an
uncorrected array focuses nowhere near the target, and it is both the most
absorbing layer and the closest to the elements. Skull heating, not focal
heating, is the dominant safety limit in clinical practice.

---

## 5. Array sampling, grating lobes, and what actually limits selectivity

A **periodic** array with pitch `d` produces extra lobes wherever

```
sin θ = m λ / d,   m = ±1, ±2, …
```

so a single main lobe over all angles requires `d ≤ λ/2` — the spatial Nyquist
condition.

Optically, this is hopeless on a head: at 630 nm the tissue wavelength is
~0.46 µm, so Nyquist sampling a 50,000 mm² scalp cap needs on the order of
**10⁹ independently phased elements**.

**But an aperiodic array does not produce discrete grating lobes.** The formula
above assumes a lattice. A Fibonacci spiral scatters the same energy into a
broad sidelobe pedestal instead of re-concentrating it at specific angles. With
`N` elements and phase conjugation, the coherent gain at the focus is of order
`N`, putting the pedestal near `1/N` of the peak.

So the honest design rule is not Nyquist — it is:

> if the focus must sit `K` times above the activation threshold, the background
> sits at `K/N` of threshold, so you need `N ≫ K`.

The planner reports both: the equivalent periodic lobe count, and the measured
peak-to-background ratio, which is the number that actually decides selectivity.
Randomised and spiral element placement is standard practice in ultrasound
arrays and radio astronomy for exactly this reason.

---

## 6. Diffraction

```
lateral FWHM ≈ 0.51 λ / NA
axial  FWHM ≈ 1.77 λ / NA²
```

Worth internalising: **diffraction is not what limits optical targeting.** Red
light through a 70° aperture is diffraction-limited to about 0.2 µm — finer than
a single neuron. The obstacle is scattering, not resolution.

At 650 kHz with a 50° half-angle, the limit is ~2 mm. Millimetre targeting is
squarely inside it, which is why transcranial focused ultrasound achieves it
clinically.

The axial extent always exceeds the lateral for an external aperture, so a
"point" is really a cigar unless the array surrounds the target. The planner
reports both.

---

## 7. Solvers

### Phase conjugation (matched filter)

`w = conj(g)/‖g‖` maximises `|gᵀw|²` subject to `‖w‖² = 1`. This is
Cauchy–Schwarz with equality iff `w ∥ conj(g)`, so **no solver can beat it at
the focus.** Everything else trades peak intensity for better suppression
elsewhere. `test/test-solvers.js` verifies this against 400 random weight
vectors.

### Weighted Gerchberg–Saxton

Equalises brightness across several foci despite differing depths and path
losses, after Di Leonardo, Ianni & Ruocco, *Opt Express* 15:1913 (2007).

### LCMV beamformer

Minimise `wᴴRw` (total intensity over sampled "keep dark" points) subject to
`A_b w = b` (prescribed field at the targets), with
`R = (1/|D|) Σ_d h_d h_dᴴ + λI` and `h_d = conj(g_d)`.

```
Z = R⁻¹ A_bᴴ
w = Z (A_b Z)⁻¹ b
```

Two implementation notes that cost real debugging time:

- **The conjugate matters.** The field at a dark point is `g_dᵀw`, a plain
  transpose, so `R` must be built from `conj(g_d)`. Building it from `g_d`
  minimises the wrong quadratic form, and the result is *worse* than plain phase
  conjugation — which is how the bug announced itself.
- **Diagonal loading is not cosmetic.** Without `λ`, the solution returns
  enormous opposing emitter amplitudes that cancel to nothing in the model and
  to noise on a bench.

---

## 8. Exposure and thermal

**Optical**: ANSI Z136.1 skin MPE for continuous 400–1400 nm exposure beyond
10 s is 0.2 W/cm² = **2 mW/mm²**.

**Acoustic**: FDA track-3 diagnostic limit, ISPTA.3 720 mW/cm² = **7.2 mW/mm²**,
mechanical index 1.9. Low-intensity transcranial FUS neuromodulation generally
stays under these.

Temperature rise uses a bioheat estimate: conduction-limited centre rise for a
uniformly heated sphere, `ΔT = Q a²/(2k)`, capped by the perfusion-limited
ceiling `ΔT = Q/(ρ_b c_b ω_b)`. This is a sanity check for order-of-magnitude
disasters, not a substitute for a Pennes solve. CEM43 thermal dose thresholds
for CNS tissue are around 2 minutes (Yarmolenko et al., *Int J Hyperthermia*
27:320, 2011).

---

## 9. Wavefront shaping: what a measured transmission matrix would buy

A fair objection: why compute the phase analytically when you could *measure*
the medium's transmission matrix and conjugate it? That is the wavefront-shaping
field, and it is real.

The enhancement with `N` controlled modes against `M` speckle modes goes as
`η ≈ (π/4)(N/M)` for full phase control. (This combined form is standard but is
a derived combination rather than a verbatim quotation; the primary results are
`(π/4)(N−1)+1` for `M=1` in Vellekoop & Mosk, *Opt Lett* 32:2309 (2007), and
`PBR = N/(2πM)` for binary phase in Liu et al., *Optica* 4:280 (2017).)

Three things close this door for a deep human target:

1. **Mode count.** The diffusive regime has `N ≈ 10⁵` or more independent modes
   (Horstmeyer, Ruan & Yang 2015). A focal volume at depth holds far more
   speckle modes than any array has elements.
2. **You need a guidestar.** From the same review, verbatim: *"Significant
   scattering precludes the ability to focus light directly into a guidestar
   within tissue"* and *"To successfully operate in vivo, these
   wavefront-shaping techniques typically require feedback from within the
   biological sample."* Benchtop wavefront shaping works because you have access
   to **both sides** of the sample. In a head you have one.
3. **The brain decorrelates faster than you can measure it.** Qureshi et al.,
   *Biomed Opt Express* 8:4855 (2017) **plus its erratum**, measured speckle
   decorrelation in living mouse brain:

   | source depth | corrected τ |
   |---|---|
   | 1.1 mm | 5.3 ms |
   | 1.8 mm | 1.5 ms |
   | 2.5 mm | 0.37 ms |
   | 3.2 mm | 0.26 ms |

   Perfusion, not thickness, dominates in vivo — ex vivo slices of the same
   thickness decorrelate in *seconds*. The authors' own verdict: with ~3 ms
   system latency, **maximum accessible in vivo depth is 1–2 mm**.

The best demonstrated in vivo focusing is through **2.3 mm of living mouse skin**
(Wang et al., *Optica* 2:728, 2015), with 1.3×10⁵ degrees of freedom and 5.3 ms
playback latency. Nobody has focused light to a deep brain point in a living
animal, let alone a human.

The planner reports this estimate whenever optical mode is more than one
transport mean free path deep.

---

## 10. Known simplifications

- Spherical head. Real skulls vary locally in thickness and porosity, which is
  why clinical systems use per-subject CT. A spherical shell is not sufficient
  on a real head.
- Straight rays; no refraction or mode conversion.
- Scalar waves; shear modes in bone are not modelled.
- Coherent field only; diffuse transport is computed for comparison, not
  propagated.
- Standing waves, cavitation and mechanical index are not modelled. A closed
  cavity with a high-impedance wall supports standing waves, which can put
  pressure maxima where the model shows none. Clinical systems sweep frequency
  or use short bursts to break them up.
