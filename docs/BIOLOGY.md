# Biology

What optogenetics can actually do today, what it cannot, and which of the
premise's assumptions hold up.

Tags: **[D]** demonstrated in primary literature · **[S]** speculative.

---

## 1. The opsin wavelength ceiling

The premise assumes that longer-wavelength opsins are coming, and that when they
arrive the penetration problem goes away. The first half is roughly true up to
about 750 nm and then stops; the second half does not follow.

### What exists

| Opsin | λ peak | Longest demonstrated | Source |
|---|---|---|---|
| ChR2 (H134R) | 470 nm | — | Boyden et al., *Nat Neurosci* 8:1263 (2005) |
| C1V1 | 540 nm | — | Yizhar et al., *Nature* 477:171 (2011) |
| ReaChR | 590 nm | through intact skull | Lin et al., *Nat Neurosci* 16:1499 (2013) |
| ChrimsonR | 590 nm | **735 nm**, >20 ms pulses | Klapoetke et al., *Nat Methods* 11:338 (2014) |
| ChRmine | 585 nm | — | Marshel et al., *Science* 365:eaaw5202 (2019) |
| rsChRmine | ~600 nm | **720 / 750 nm** in vivo | Kishi et al., *Cell* 185:672 (2022) |

**750 nm is the record for any single-photon opsin.** [D] rsChRmine drove neural
responses at 720 and 750 nm at elevated power, where wild-type ChRmine and
ChrimsonR gave none — the authors describe it as the first channelrhodopsin to
work in that band. The λmax record for any microbial rhodopsin is 610 nm
(RubyACR).

*(ChRmine's source organism is disputed. Marshel 2019 reports* Tiarina fusus, *a
marine ciliate; later work attributes it to the cryptophyte alga* Rhodomonas
lens. T. fusus *preys on cryptophytes, so the original sequence most likely came
from gut contents.)*

### Why ~700 nm is close to a hard ceiling, not a research frontier

This is the best-grounded part of the biology, and it comes from vision science
rather than optogenetics.

**Luo, Yue, Ala-Laurila & Yau, "Activation of visual pigments by light and
heat", *Science* 332:1307 (2011)** established that light activation and
*thermal* activation of a retinal pigment pass through the **same ground-state
isomerisation barrier**, with

```
E_a ≈ 0.84 · hc / λmax
```

The consequence is a trap. Red-shifting the absorption peak is the same thing as
lowering the isomerisation barrier — which means the molecule starts flipping on
its own from body heat.

| λ | photon energy | implied barrier |
|---|---|---|
| 470 nm | 60.8 kcal/mol | 51.1 |
| 590 nm | 48.5 | 40.7 |
| **700 nm** | **40.8** | **34.3** |
| **1000 nm** | **28.6** | **24.0** |
| **1300 nm** | **22.0** | **18.5** |

Literature places heat-driven dark activation around **20–25 kcal/mol**. A
1000 nm retinal pigment's implied barrier sits *inside* that range; a 1300 nm one
is well inside it.

Luo et al. put the formal limit at **λmax = 698 nm**, where the long-wavelength
spectral descent matches the Boltzmann limit (`m = 1` vibrational mode) — and
note that a hypothetical 1000 nm pigment would need `m < 1`. They soften it
slightly (`m` is nominal, so `m < 1` is "in principle" possible), but the
*biological* limit is the real one: extrapolated thermal noise for cone pigments
asymptotes at ~360× the rate of the 620 nm pigment, which in a salamander red
cone would be ~29,700 spontaneous activations per second per cell. Their
conclusion: *"the predicted high noise for pigments with λmax in the infrared
presumably explains why they apparently do not exist in nature."*

The quantum-chemical mechanism is in **Gozem, Schapiro, Ferré & Olivucci,
*Science* 337:1225 (2012)**: the thermal transition state has the same
electronic structure as the photoexcited state. The trade-off is intrinsic to
retinal, not an engineering detail.

**For an ion channel the consequence is worse than for a visual pigment.** A
constitutively leaky channel is a standing depolarising current in every
transduced neuron — a signal-to-noise failure and a toxicity at the same time.

**Direct answer: a 1000 nm or 1300 nm single-photon retinal opsin should not be
expected.** Getting past ~780 nm requires abandoning retinal (bilin/phytochrome
chemistry — real, but those are transcription and protein-interaction tools
operating over seconds to hours, not millisecond ion channels), abandoning
single-photon excitation (2-photon, which is focal and scattering-limited to
shallow depths), or abandoning direct opsin excitation (upconversion).

### And even a perfect NIR opsin would not help

Scattering is nearly wavelength-independent where it matters. The scattering
mean free path in white matter goes 22 µm → 30 µm from 480 to 1300 nm, because
rising anisotropy cancels falling `µs′`. Red light buys *diffuse* penetration —
which is exactly why fNIRS and photobiomodulation exist — not *coherent*
penetration. See [PHYSICS.md](PHYSICS.md) §3.

---

## 2. Transcranial optogenetics as actually demonstrated

### Chen et al., *Nat Biotechnol* 39:161 (2021) — "Deep brain optogenetics without intracranial surgery" [D]

This is the real transcranial ChRmine paper. *(Marshel et al. Science 2019 is
often miscited as such; it is 2-photon holographic stimulation in visual cortex
and the word "transcranial" does not appear in it.)*

- 635 nm, 400 µm fibre resting **on the intact skull**.
- **Mouse VTA at 4.5 mm.** Light-responsive units from ≥200 mW/mm² at 5 ms
  pulses; reliable activity from **40 mW/mm²** with 100 ms pulses.
- **Maximum depth 7 mm — in rat**, with intracranial AAV, 400 mW/mm², 100 ms
  pulses. Monte Carlo: **~0.02% of the surface irradiance reaches 7 mm**,
  described as "near the sensitivity limit predicted for ChRmine."
- The genuinely surgery-free result: AAV-PHP.eB retro-orbital (4×10¹¹ vg) →
  dorsal raphe → transcranial stimulation changed social behaviour. No
  craniotomy, no implant.
- Safety envelope: ~0.3 °C rise at 800 mW/mm² / 10% duty; **frank tissue
  lesioning at 6,400 mW/mm²**.
- The control that defines the achievement: bReaChES gave no responses at those
  depths, and no place preference even at 3.2 W/mm².

### What that implies for a human

From that paper's own transmission figure, the effective attenuation is
0.296 /mm — a 1/e length of **0.82 mm**:

| depth | transmitted | surface irradiance for 0.1 mW/mm² at depth |
|---|---|---|
| 10 mm | 5×10⁻⁶ | 1.9×10⁴ mW/mm² |
| 20 mm | 2.7×10⁻¹¹ | 3.7×10⁹ |
| 40 mm | 7.3×10⁻²² | 1.4×10²⁰ |
| **60 mm** | **2×10⁻³²** | **5×10³⁰** |

*(Naive exponential extrapolation of one published figure, folding in mouse/rat
skull. Not a published number. But it survives by many orders of magnitude.)*

A mouse brain is ~10 mm across; a human brain is ~140 mm. Scalp-to-hippocampus
is 50–60 mm, scalp-to-STN 70–80 mm. A 4.5 mm mouse target is **superficial** by
human standards.

With lesioning at 6,400 mW/mm², usable surface irradiance tops out near
1 W/mm² — already short of a 10 mm target. **An opsin 100× more sensitive than
ChRmine buys about 4 mm.**

### Upconversion — Chen et al., *Science* 359:679 (2018) [D]

NaYF₄:Yb/Tm nanoparticles convert 980 nm NIR to 450/475 nm blue at ~2.5%
efficiency. A 2.0 W laser on the skull gave ~13.8 mW/mm² NIR at 4.5 mm →
~0.34 mW/mm² of blue, enough for ChR2. Demonstrated dopamine release, theta
entrainment, memory-engram reactivation, seizure suppression.

**The decisive caveat: the nanoparticles were stereotaxically injected into the
brain.** Only the light is non-invasive. This is the pattern for every working
deep scheme — put the transducer at the target, and use light only over the last
fraction of a millimetre.

---

## 3. Alternatives that change the physics

| Approach | Depth | Specificity | Notes |
|---|---|---|---|
| **Sonogenetics** (MscL, hsTRPA1) | full brain | genetic | Ultrasound-gated channels. Ibsen et al. *Nat Commun* 6:8264 (2015); Duque et al. *Nat Commun* 13:600 (2022) |
| **Thermogenetics** (TRPV1 + FUS) | full brain | genetic | Local heating of a focal volume |
| **Magnetothermal** | full brain | genetic | Needs injected nanoparticles |
| **Upconversion** | ~4.5 mm shown | genetic | Needs injected particles |
| **Chemogenetics + FUS-BBB** | full brain | genetic | Slow (minutes) |
| **Non-genetic NIR photovoltaics** | demonstrated | **none** | Jin et al., *Sci Adv* 11:eadt4771 (2025) — works, but no cell-type specificity, which is the whole point |

The common thread: every route that reaches deep human brain either carries the
energy with ultrasound or magnetic fields, or places a transducer at the target.
None of them improve the opsin and none of them focus light from outside.

---

## 4. The CRISPR correction

**Making an opsin AAV involves no CRISPR, no Cas9, no guide RNA, and no genome
editing of the recipient at any step.** CRISPR and AAV gene delivery share the
word "gene" and nothing else mechanistically.

The actual workflow:

1. **Get the opsin coding sequence.** Opsins are natural microbial genes:
   ChR2 from *Chlamydomonas reinhardtii*; Chrimson from *C. noctigama*, with
   ChrimsonR = the K176R point mutant; ChRmine found by structure-based database
   mining. Point mutants are made by **site-directed mutagenesis or DNA
   synthesis**, not editing.
2. **Codon-optimise and add trafficking tags** — a fluorophore plus membrane
   trafficking signals (Kir2.1 TS, ER2 export, or Kv2.1 soma-targeting).
3. **Clone between two ITRs**:
   `5′ITR — promoter — opsin-fluorophore — WPRE — polyA — 3′ITR`. The 145 bp
   ITRs are the only AAV sequences retained; cargo limit ~4.4 kb. Promoter
   choice is where specificity lives (hSyn, CaMKIIα, GFAP, mDlx).
4. **Package by triple transfection of HEK293**: the ITR vector plasmid (the
   only DNA packaged), a rep/cap plasmid (which capsid you use — AAV9, PHP.eB,
   BI-hTFR1), and an adenoviral helper. rep/cap and helper carry no ITRs, so
   they are not packaged and the particles are replication-incompetent.
5. **Purify** by iodixanol gradient or affinity chromatography; titre by qPCR.
6. **Deliver** — stereotactic, IV, intrathecal, ICV, or convection-enhanced.

**Inside the neuron**, the genome uncoats, is second-strand synthesised, and
**circularises into episomal concatemers via the ITRs**. It is transcribed from
its own promoter and persists as extrachromosomal DNA. **No host sequence is
cut, replaced or corrected. The neuron's genome is untouched and nothing is
heritable.**

Honest caveat: "non-integrating" is statistical, not absolute — low-frequency
random integration is detectable in sensitive assays. The accurate phrasing is
"episomal and non-integrating by design, with rare integration detectable and no
established causal tumorigenicity."

**Where CRISPR genuinely appears in optogenetics:** making Cre/Flp driver and
reporter **mouse lines** by knock-in — a germline animal-engineering step done
years earlier, in which the AAV you later inject contains no CRISPR components.
Also in receptor validation, and in CRISPRa/CRISPRi as a separate modality.

*One line: CRISPR edits a genome; an opsin AAV adds an episomal copy of an algal
light-gated ion channel and edits nothing.*

**This has a sharp consequence for humans.** Cre-dependent targeting is
structurally non-translatable — you cannot make a person a transgenic driver
line. The only route to human cell-type specificity is **enhancer AAVs**: a
short genomic enhancer identified from scATAC-seq, placed in the vector itself.
Mich et al., *Cell Rep* 34:108754 (2021) found >30% of enhancer-AAVs gave
subclass-specific expression, with five PVALB enhancers retaining specificity in
primate cortex; Ben-Simon et al., *Cell* 188:3045 (2025) released >1,000 of
them. Enhancers are a few hundred bp, so they fit alongside an opsin where a
full cell-type promoter often would not.

---

## 5. Delivery to a human brain

The premise assumes "a simple injection" puts the virus in the brain. Partly
true, with caveats.

- **AAV-PHP.eB** crosses the blood-brain barrier efficiently — **in specific
  mouse strains**, via the LY6A receptor, which primates do not have the same
  way. It does not transfer.
- **Human TfR1-targeting capsids** (BI-hTFR1 and relatives, 2024) are the real
  advance: engineered against a receptor humans actually have.
- **AAV9 IV in humans** works but at enormous systemic doses, with known
  hepatotoxicity and dorsal root ganglion toxicity at high dose.
- **Focused-ultrasound BBB opening** lets you open a chosen region and deliver
  there — which is, again, ultrasound doing the targeting.

---

## 6. Human optogenetics: what has actually happened

**In the retina, yes.** [D] GenSight's GS030 (ChrimsonR) produced partial visual
recovery in a blind retinitis pigmentosa patient — Sahel et al., *Nat Med*
27:1223 (2021). Nanoscope's MCO-010 is further along in trials.

**In the brain, no.** [D] There has never been an optogenetics trial in a human
brain.

**Why retina first** is instructive, and every reason is about the physics this
repository is concerned with:

- The retina is **optically accessible** — the eye evolved to let light in.
  There is no scattering problem at all.
- It is a thin, well-characterised layer with a known target cell population.
- It is **immune-privileged**, lowering the risk from an algal protein.
- Doses are tiny, and intravitreal injection is routine.
- Failure is contained in one eye.

None of those hold for a deep brain target.

---

## 7. Safety issues that apply regardless

- **The opsin is a foreign antigen.** Algal proteins expressed in human neurons
  can be immunogenic.
- **AAV dorsal root ganglion toxicity** at high systemic dose is well
  documented, and it collides specifically with the high doses deep CNS
  transduction would need.
- **Overexpression toxicity and trafficking.** Opsins mistraffic and aggregate
  when overexpressed; soma-targeting tags (Kv2.1) exist partly to address this.
- **Phototoxicity and heating from the light itself**, which is the constraint
  that closes the optical route independently of everything above.
