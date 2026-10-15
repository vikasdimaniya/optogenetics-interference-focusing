# Prior art

Has anyone already done this? The short version:

- **For light, no.** No paper, preprint or patent proposes, models or
  demonstrates focusing light to a deep brain point by external interference.
- **For electric fields, yes**, and it is an active human research field with
  serious unresolved criticism.
- **For ultrasound, yes**, and it is FDA-approved clinical hardware.
- **For currents, since about 1951**, and that older literature already
  contains the objections now being raised about the brain version.

---

## 1. The optical version does not exist

A targeted search across the literature, preprints (bioRxiv, arXiv 2020–2026)
and patents found **nothing**. Three precise negative findings:

**"Optical phased array" + "transcranial" returns nothing relevant.** Every
transcranial phased-array result is ultrasound. Every *optical* phased array for
brain use is an **implanted** silicon neural probe — and those papers state the
motivation outright: light penetration in brain is limited to about 1 mm from
the surface, which is why they implant. See Sacher et al., *Communications
Engineering* (2024), "Implantable silicon neural probes with nanophotonic phased
arrays for single-lobe beam steering", and Sacher et al., *Opt Lett* (2022).

**"Optical temporal interference" is not a thing.** The nearest hit is not one:
Ejneby / Jakešová et al. (bioRxiv 2021.11.02.466993) use 638 nm light merely to
*power* implanted organic electrolytic photocapacitors — the interfering fields
are electric fields from implanted devices, exactly as in classical temporal
interference. The light does not interfere.

**The whole temporal-interference family is electrical, magnetic or
microwave.** Grossman 2017; Violante 2023; magnetic TI (bioRxiv
2020.07.20.212845); microwave TI (arXiv 2602.18477, 2026); multipolar TI. There
is no optical member.

If you wanted to claim novelty, this is the gap. The reason it is open is in
[VERDICT.md](VERDICT.md): it does not work, and the people closest to the idea
went and built it with ultrasound instead.

---

## 2. Temporal interference electrical stimulation

**Grossman et al., "Noninvasive Deep Brain Stimulation via Temporally
Interfering Electric Fields", *Cell* 169:1029 (2017).**

This is the closest intellectual relative of the proposal. Two electric fields
at, say, 2.00 and 2.01 kHz. Neither carrier drives neurons — the membrane
low-passes anything above ~1 kHz — but their **envelope** beats at 10 Hz, inside
the neural dynamic range, and the envelope maximum can be placed deep while each
carrier is maximal superficially.

### What the mouse paper showed [D]

- Carriers swept 1–4 kHz: threshold rose linearly at 250 µA/kHz (R² = 0.99);
  5 kHz gave no response up to 2 mA.
- Envelope-following: firing locked at 10.21 ± 0.83 Hz.
- Depth selectivity by c-Fos: TI activated **53.1 ± 14.5% of hippocampal cells
  while cortex sat at 0.48 ± 0.47%**, versus conventional 10 Hz stimulation
  which hit 13.6% cortical and 63.9% hippocampal.
- Steerability: moving the peak by changing current ratios, with in vivo
  displacement of ~1.2 mm.
- Safety: no change in NeuN, caspase-3, γH2AX, Iba1, GFAP at 24 h.

**An important gap:** the paper reports **no FWHM or mm-scale extent** for the
hippocampal activation. The only spatial figures are ROI box sizes and model
resolution. Claims of a specific "millimetre focality" are not traceable to it.
Also worth noting: the electrodes were **epidural**, not transcranial through
scalp.

### In humans

- **Violante et al., *Nat Neurosci* 26:1994 (2023)** — hippocampus. 2.000 +
  2.005 kHz, 2 mA/pair. Cadaver validation: envelope modulation ≈0.1 V/m at
  44 mm depth. fMRI showed a regional gradient; behaviour showed ~12% increased
  odds of target selection.
- **Wessel et al., *Nat Neurosci* 26:2005 (2023)** — striatum, theta-burst
  patterned. Putamen BOLD higher during TI; older adults' motor skill gain
  +33.6%.
- Subsequent work: frequency-specific disruption at Δf = 80 Hz (Vassiliadis et
  al., *Nat Hum Behav* 8:1581, 2024); tolerability across 119 participants /
  257 sessions; Parkinson's beta suppression with externalised DBS leads
  (Lamoš et al., *Mov Disord* 40:1051, 2025); epilepsy IED reduction of
  58.5 ± 27.8% (Missey et al., *Brain Stimul* 19:102981, 2026).

### The criticisms, which are serious

**The dose problem.** Rampersad et al., *NeuroImage* 202:116124 (2019) modelled
it: to reach the field strengths at which TI's suprathreshold effects were shown
in mouse would need **>500 mA per electrode pair**; reaching the lowest human
corticomotor threshold estimate would need ~38 mA. Human studies use 2 mA. Their
verdict: *"suprathreshold stimulation in humans is not possible with the
considered tTIS paradigm"* — while allowing that subthreshold modulation with
deep maxima is theoretically achievable.

**Why mouse results do not transfer.** Alekseichuk et al., *NeuroImage*
194:136 (2019): for two-electrode transcranial electrical stimulation the
induced field is **~100× stronger in mouse brain than human** at the same
injected current. That single factor explains most of the gap.

**The envelope is focal; the total field is not.** Esmaeilpour et al., *Brain
Stimul* 14:55 (2021) is the cleanest statement. In rat hippocampal slices,
modulation thresholds rose with carrier frequency (≥5 V/m at 100 Hz, ≥80 V/m at
2 kHz). At an illustrative 167 mA, superficial cortex reaches ~80 V/m with ~15%
amplitude modulation while deep structures see ~50% modulation. **The deep
region wins on modulation depth, never on absolute field, which is always
maximal at cortex under the electrodes.** Their verdict: *"selectivity is rather
limited regardless of parameter choices."*

**The key number across all human studies that report one: the envelope reaches
~0.1–0.6 V/m**, at or below the ~1 V/m usually taken as the floor for detectable
subthreshold modulation, and about two orders of magnitude below the mouse
fields in which the effects were demonstrated.

One direct cautionary result: Modak et al., *Brain Stimul* 17:867 (2024)
optimised a montage for the left caudate and observed BOLD increases in
mid-orbitofrontal cortex and parahippocampal gyrus instead — **a demonstration
that the modelled envelope peak need not land on the intended target.**

---

## 3. Interferential current therapy: the idea is ~70 years old

Developed by Hans Nemec in Vienna in the early 1950s. Two medium-frequency
currents (1–10 kHz, typically 4 kHz) through a quadripolar montage interfere to
produce a beat at the difference frequency, with the interference region
intended to sit deep.

The physics is identical in kind to TI. So is the critical literature:

- **Özcan et al. (2004)** found crossed (interferential) currents showed **no
  greater depth efficiency** than parallel bipolar currents.
- **Gundog et al., *Am J Phys Med Rehabil* 91:107 (2012)** compared beat
  frequencies of 40, 100 and 180 Hz in knee osteoarthritis and found **no
  significant difference** — the supposed active ingredient did not matter.
- A narrative review (Rampazo & Liebano, *Medicina* 58:141, 2022) concludes most
  IFC parameters do not influence the effect, no experimental work establishes
  the mechanism, and tissue inhomogeneity makes the stimulated region irregular
  rather than a clean deep focus.

TI's genuine novelty over IFC is carriers high enough to avoid direct
recruitment, FEM-based envelope steering via current ratios, and brain targets.
But the depth-selectivity claim has been contested in the peripheral domain for
twenty years.

---

## 4. Transcranial focused ultrasound: the one that works

**Insightec Exablate Neuro (ExAblate 4000)**, per Leung et al., *Sci Rep* 9:7965
(2019):

- **1024 elements**, hemispherical
- **30 cm aperture, 15 cm radius of curvature**
- **680 kHz**

It is FDA-approved and treats essential tremor by thermally ablating a
millimetre-scale thalamic target through an intact skull. Per-element phase
correction is computed from the patient's CT — the straight-ray time-of-flight
method of **Clement & Hynynen, *Phys Med Biol* 47:1219 (2002)**, which is
exactly the correction this planner implements.

Low-intensity transcranial focused ultrasound for *neuromodulation* (rather than
ablation) is a large and active field, with the known caveat that focal volumes
from a single external aperture are elongated — the "cigar problem" — because
axial resolution is always worse than lateral.

**This is the proposal, built, working, on patients.** The only difference from
the premise is the wave.

---

## 5. Holographic optogenetics: real, and a different problem

Worth distinguishing clearly, because the name invites confusion.

Holographic optogenetics (Emiliani, Adesnik and others) uses a spatial light
modulator to sculpt light into many simultaneous foci and drive chosen neurons
with cellular precision — often with 2-photon excitation. It works, it is
powerful, and it is in routine use.

It operates **through a microscope objective, through a cranial window, at
depths under about a millimetre**. The SLM is doing wavefront shaping over a
short, mostly-ballistic path. It is not attempting to focus through an intact
skull and 50 mm of brain, and nothing in that literature suggests it could.

The planner's "Cranial window" preset puts you in roughly that regime — and
notice that the scattering finding stops being fatal there. The premise is
*correct* at that scale. It is the scale-up that fails.

---

## 6. Wavefront shaping through scattering media

If you abandon the analytic phase model and *measure* the transmission matrix
instead, you are in the wavefront-shaping field. [PHYSICS.md](PHYSICS.md) §9 has
the detail; the summary:

- Enhancement goes as `(π/4)(N/M)` with `N` controlled modes against `M` speckle
  modes (Vellekoop & Mosk, *Opt Lett* 32:2309, 2007).
- In vivo you need a **guidestar** — feedback originating at the target —
  because, as Horstmeyer, Ruan & Yang (*Nat Photonics* 9:563, 2015) put it,
  *"significant scattering precludes the ability to focus light directly into a
  guidestar within tissue."* Benchtop work has access to both sides of the
  sample; a head gives you one.
- Living brain speckle decorrelates in **0.26–5.3 ms** depending on depth
  (Qureshi et al., *Biomed Opt Express* 8:4855, 2017, with erratum). The
  authors' own conclusion: with ~3 ms system latency, maximum accessible in vivo
  depth is **1–2 mm**.

Best demonstrated: focusing through **2.3 mm of living mouse skin** (Wang et
al., *Optica* 2:728, 2015). Nobody has focused light to a deep point in a living
brain.

---

## 7. Summary table

| Approach | Wave | Depth in human | Resolution | Status |
|---|---|---|---|---|
| Transcranial focused ultrasound | acoustic | full brain | ~1–3 mm | **FDA-approved clinical** |
| Temporal interference | electric | full brain | contested | human research, serious criticism |
| Interferential current | electric | peripheral | contested | clinical since ~1951 |
| Holographic optogenetics | optical | <1 mm | single cell | routine, through a window |
| Wavefront shaping w/ guidestar | optical | 1–2 mm | ~10–60 µm | research, mouse |
| Transcranial optogenetics | optical | 4.5 mm (mouse) | diffuse | demonstrated in rodents |
| **External optical interference** | optical | — | — | **not attempted; excluded by ~30 orders of magnitude** |
