# The verdict

**The question.** Put many emitters around a head, time them so their waves arrive
in phase at one chosen point deep in the brain and out of phase everywhere else.
The interference pattern lights up a single spot of millimetre accuracy and
cancels elsewhere, so only the neurons you chose get the light. Does it work?

**The short answer.** The idea is correct. The wave is wrong.

Interference focusing to a deep point inside a human head is not a fantasy — it
is a deployed clinical technology, used on real patients today, to millimetre
accuracy. It just uses ultrasound, not light. With light the scheme fails, and
it fails by a margin so large that no improvement in opsins, lasers, emitter
count or computing power can close it.

Three separate things break, and each one is independently fatal.

---

## 1. Light loses its phase after about one millimetre of brain

This is the one that matters, and it is worth being precise about, because it is
not the objection most people expect.

Interference requires that the waves arriving at the meeting point have a
**predictable phase**. If you cannot predict the phase, you cannot arrange for
the waves to add there and cancel elsewhere — you can only hope.

Brain tissue scatters light extremely strongly. The relevant number is the
**scattering mean free path**, the average distance a photon travels before its
direction is randomised:

| Tissue | at 800 nm |
|---|---|
| Grey matter | ~90 µm |
| White matter | ~25 µm |
| Skull | ~30 µm |

A photon that scatters is not lost from the head — it is lost from the
*calculation*. It arrives somewhere at some phase you cannot compute. So the
component of the field that still has a usable phase decays as `exp(−µ_t·L)`
with `µ_t = µ_a + µ_s`, and the exponent runs away immediately:

| Path | Phase-coherent fraction surviving, 630 nm |
|---|---|
| Scalp + skull (~13 mm) | ~10⁻⁹⁵ |
| + 20 mm of brain | ~e⁻⁸⁰⁰ |
| + 50 mm of brain | ~e⁻¹⁶⁷² ≈ 10⁻⁷²⁶ |

For scale: a 1 joule pulse of red light contains about 3×10¹⁸ photons. The
observable universe contains about 10⁸⁰ atoms. These are not small numbers in
the sense that a better laser could overcome them; they are zero.

**This is also why the intuition from the torch-under-your-hand is misleading.**
Your hand does glow, and that is real — but what comes out is *diffuse* light
that has scattered thousands of times. Diffuse transmission beats coherent
transmission by 600 to 1200 orders of magnitude. The light that gets through is
exactly the light that has forgotten where it came from. You can see it; you
cannot steer it.

Ballistic photons are gone within roughly **0.9 mm of grey matter and 0.3 mm of
white matter**. That is the entire budget. The depth of a human hippocampus is
about 50 mm.

Run the planner in Light mode at any wavelength and watch the "coherent light
left" figure. It is never close.

---

## 2. A longer wavelength does not rescue it, and there is a reason no such opsin is coming

The premise assumes that longer-wavelength opsins will arrive and solve the
penetration problem. Two independent problems with that.

**The opsin ceiling is photochemical, not a matter of searching harder.**
Channelrhodopsins work by photoisomerising retinal. Luo, Yue, Ala-Laurila & Yau
(*Science* 332:1307, 2011) showed that the same energy barrier governs both
light activation and *thermal* activation, with `E_a ≈ 0.84·hc/λmax`. Pushing
the absorption peak redder lowers the barrier, which means the channel starts
opening on its own from body heat. Their estimate puts the formal limit near
**698 nm**, and notes that the longest-wavelength visual pigment anywhere in
nature sits at about 620 nm. For an ion channel the consequence is worse than
for a visual pigment: a constitutively leaky channel is both a noise source and
a toxicity.

The longest wavelength at which *any* single-photon opsin has actually driven
neurons in vivo is **750 nm** — rsChRmine, at elevated power (Kishi et al.,
*Cell* 185:672, 2022). ChrimsonR manages 735 nm with long pulses. There is no
NIR-absorbing light-gated ion channel of any kind, and the chemistry that
absorbs at 780 nm (open-chain tetrapyrroles, as in phytochromes) does not gate a
channel in milliseconds.

**Even a perfect NIR opsin would not help, because scattering is nearly
wavelength-independent in the regime that matters.** Going redder raises `g`
(forward-scattering) at about the rate it lowers `µs'`, so the scattering mean
free path in white matter barely moves: 22 µm at 480 nm, 30 µm at 1300 nm. Red
light buys *diffuse* penetration, which is why fNIRS and photobiomodulation
work. It does not buy *coherent* penetration, which is what interference needs.
And past ~1100 nm water absorption takes over regardless.

The planner has a "Hypothetical 1000 nm opsin" entry precisely so you can try
this. It changes nothing.

---

## 3. The power budget closes the door independently

Even granting a perfect opsin and ignoring coherence entirely, the arithmetic
fails on diffuse light alone.

The best transcranial optogenetics ever demonstrated: Chen et al.,
*Nat Biotechnol* 39:161 (2021) drove mouse VTA at **4.5 mm** through an intact
skull with 635 nm light, and reached **7 mm in rat** at 400 mW/mm² on the
surface — with Monte Carlo showing **0.02% transmission** to that depth. That
implies a 1/e length of about 0.82 mm.

Extrapolating that (naively, but the conclusion survives by many orders of
magnitude):

| Depth | Fraction transmitted | Surface irradiance to deliver 0.1 mW/mm² |
|---|---|---|
| 10 mm | 5×10⁻⁶ | 1.9×10⁴ mW/mm² |
| 40 mm | 7×10⁻²² | 1.4×10²⁰ mW/mm² |
| 60 mm | 2×10⁻³² | 5×10³⁰ mW/mm² |

The same paper saw **frank tissue lesioning at 6,400 mW/mm²**, and the ANSI
skin exposure limit for continuous near-infrared is **2 mW/mm²**. So the usable
surface irradiance tops out around 1 W/mm², which is already an order of
magnitude short of a **10 mm** target, let alone 60 mm.

Transcranial single-photon optogenetics of the deep human brain is not a hard
problem. It is excluded by roughly thirty orders of magnitude. Even an opsin
100× more sensitive than ChRmine buys about **4 mm** of extra depth.

---

## 4. Two smaller corrections to the setup

**LEDs cannot interfere.** An LED emits spontaneously, with a coherence time of
tens of femtoseconds and no fixed phase relationship to any other LED. Add N
independent LEDs and the cross terms average to zero: intensities simply sum.
You get N times the brightness everywhere the beams overlap and no fringes
anywhere — which is why a room with many bulbs has no interference pattern in
it. Deterministic interference needs mutually coherent sources: one laser split
N ways through phase shifters, or N oscillators driven from a common clock
(which is exactly what an ultrasound array is).

**CRISPR is not how opsin viruses are made.** The two share the word "gene" and
nothing else. An opsin AAV carries an episomal copy of an algal gene between two
145 bp inverted terminal repeats; it edits nothing, cuts nothing, and the
neuron's genome is untouched. CRISPR appears in optogenetics only in making the
Cre driver *mouse lines* — a step that does not exist for humans, which is why
human cell-type targeting has to go through enhancer AAVs instead. The full
workflow is in [BIOLOGY.md](BIOLOGY.md).

---

## 5. What the idea is actually right about

Now the other side, because the underlying instinct is sound and is already
doing useful work.

**The geometry is correct.** Many emitters, phase-conjugated so their path
lengths to the target differ by whole wavelengths, genuinely does produce a
single focus whose width is set by `λ/(2·NA)`. The planner implements exactly
that and it works — in ultrasound mode you get a 1.1 mm focus, 67 mm deep,
landing within a fraction of a millimetre of where you asked, at 2 watts total
and well inside safety limits.

**Someone already built it, for sound.** Transcranial focused ultrasound uses a
1024-element hemispherical array at 680 kHz with per-element phase correction
derived from the patient's CT. It is FDA-approved and treats essential tremor by
ablating a millimetre-scale target in the thalamus through an intact skull. The
mechanism is precisely the one in the proposal.

**Someone already built it, for electric fields.** Temporal interference
stimulation (Grossman et al., *Cell* 169:1029, 2017) applies two kilohertz
fields offset by a few hertz; neither carrier drives neurons, but their
*envelope* beats at a low frequency and can be placed deep. It has run in humans
— hippocampus (Violante et al., *Nat Neurosci* 26:1994, 2023) and striatum. It
is a genuinely active field, with genuinely serious criticism: in humans the
envelope reaches only ~0.1–0.6 V/m, around the floor for detectable effects, and
the *absolute* field remains strongest at the cortex under the electrodes, not
at the target. See [PRIOR-ART.md](PRIOR-ART.md).

**Nobody has published the optical version.** A targeted search across the
literature, preprints and patents found no paper proposing, modelling or
demonstrating deep-brain targeting by external optical interference. Every
"transcranial phased array" is ultrasound. Every *optical* phased array for
brain is an **implanted** silicon probe — and those papers state the reason
plainly: light penetration is limited to about 1 mm, which is why they implant.

So the idea is not unoriginal. It is unpublished because it does not work, and
the people closest to it went and did it with ultrasound instead.

---

## 6. What to do with this

If the goal is **millimetre targeting of deep brain tissue, non-invasively**,
that problem is solved and the answer is ultrasound. Open the planner in
Ultrasound mode: this is the regime where your algorithm is not just valid but
is what the field actually runs.

If the goal is specifically **optogenetic, cell-type-specific control at depth**,
the realistic routes all change the physics rather than improving the opsin:

- **Sonogenetics** — ultrasound-gated ion channels (MscL, hsTRPA1). Keeps the
  cell-type specificity of a transgene; gets the penetration of ultrasound.
- **Thermogenetics** — TRPV1 plus focused-ultrasound heating of a small volume.
- **Upconversion** — NIR in, blue out, from nanoparticles sitting at the target.
  Demonstrated at 4.5 mm in mouse (Chen et al., *Science* 359:679, 2018) — but
  the particles were injected into the brain. Only the light is non-invasive.
- **Focused-ultrasound BBB opening** to deliver the vector to a chosen region,
  then a systemic actuator.

Each of those uses the interference idea where it works and uses light, if at
all, only over the last millimetre.

If the goal is **to understand wave physics by building something**, the planner
is the useful artefact. The light-versus-ultrasound comparison in one tool, with
the same geometry and the same solver, is the clearest way to see what
wavelength actually buys you.

---

*Every claim above is checked by a test in [`test/`](../test). If a number here
is wrong, a test should fail. Run `node test/run.js`.*
