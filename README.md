# Interference focusing in brain

**Can you steer a wave to one point deep inside a head by interference from many
emitters outside it, lighting up that point and nothing else?**

Yes — with ultrasound, to about a millimetre, and it is already an approved
clinical technology. No — with light, by roughly thirty orders of magnitude, and
no advance in opsins or lasers changes that.

This repository is the planner that shows the difference, plus the physics and
biology behind the answer.

**[→ Open the planner](https://vikasdimaniya.github.io/optogenetics-interference-focusing/)**
 · **[Read the verdict](docs/VERDICT.md)** · **[Physics](docs/PHYSICS.md)**
 · **[Biology](docs/BIOLOGY.md)** · **[Prior art](docs/PRIOR-ART.md)**

---

## What it does

Give it a head, a wavelength, an emitter array and one or more target points
inside the brain. It returns:

- **Where to put each emitter** — Cartesian and spherical coordinates, standoff
  from the scalp, exportable as CSV.
- **How to drive each one** — relative amplitude, phase in degrees, and the
  physical delay in nanoseconds that realises it.
- **What field you actually get** — intensity on a slice through the target,
  with focus width, focal volume, peak-to-background ratio, targeting error, and
  a count of every *other* hotspot above half the peak.
- **Whether it is physically possible** — a verdict with per-check severities
  and the numbers behind each one: coherence budget, array sampling, diffraction
  limit, exposure safety, thermal rise.

The last item is the point. A planner that happily prints emitter coordinates
for a scheme that cannot work is worse than no planner at all.

## The comparison, in one run

Same head, same target 67 mm below the scalp, same solver, same 256 emitters:

| | Red light, 630 nm | Ultrasound, 650 kHz |
|---|---|---|
| Verdict | **physically impossible** | **plausible, with engineering obstacles** |
| Coherent energy reaching target | ~10⁻¹²²⁴ | essentially all of it |
| Focus width (FWHM) | no focus exists | **1.09 mm** lateral, 2.19 mm axial |
| Peak / background in brain | undefined | **358 : 1** |
| Other hotspots above 50% | — | **0** |
| Targeting error | — | **0.00 mm** |
| Total emitted power | unbounded | **2.3 W** |
| Surface exposure vs limit | unbounded | **14× under the limit** |

Reproduce with `node bin/plan.js --compare`.

## Why light fails

Not diffraction — the diffraction-limited spot for red light through a wide
aperture is under a micrometre, far finer than a neuron. The obstacle is
**scattering**. A photon that scatters still carries energy but no longer
carries a phase you can predict, and the phase-coherent fraction decays as
`exp(−(µa+µs)·L)`. In brain, `µs` is about 10–50 /mm, so coherent light is gone
within **0.9 mm of grey matter and 0.3 mm of white matter**.

The light you see when you hold a torch against your hand is real, but it is
*diffuse* — it has scattered thousands of times and forgotten where it came
from. Diffuse transmission beats coherent transmission through a head by 600 to
1200 orders of magnitude. You can see it. You cannot steer it.

Full argument with citations in [docs/VERDICT.md](docs/VERDICT.md).

## Why ultrasound works

At 650 kHz the wavelength in brain is 2.4 mm — far larger than any cell — so
tissue is acoustically near-homogeneous and the field stays coherent across the
whole head. Attenuation is absorption, which costs amplitude but not
predictability. The skull is the hard part: its speed of sound is nearly twice
that of brain, so each element needs a phase correction, which clinical systems
compute from the patient's CT.

This is not a proposal. Insightec's Exablate Neuro is a 1024-element
hemispherical array at 680 kHz, FDA-approved, treating essential tremor by
ablating a millimetre-scale thalamic target through an intact skull.

## Using it

### In a browser

Open `index.html`, or the [hosted version](https://vikasdimaniya.github.io/optogenetics-interference-focusing/).
No build step and no dependencies — it is plain ES modules.

Click the map to move the target, shift-click to add another. The presets along
the bottom of the controls walk through the argument: *The original idea* →
*Best case for light* → *Ultrasound, same geometry*.

To serve locally:

```bash
node serve.mjs        # http://localhost:8080
```

### From Node

```js
import { plan, summarise } from './src/api.js';

const result = plan({
  mode: 'acoustic',
  drive: 650e3,                                   // Hz  (or nm in optical mode)
  head: 'humanAdult',
  array: { layout: 'sphericalCap', count: 256, standoffMm: 12, halfAngleDeg: 75 },
  targets: [{ x: 0, y: 0, z: 25 }],               // mm, origin at head centre
  solver: 'phaseConjugation',
});

console.log(summarise(result));
console.log(result.table[0]);
// { index: 0, x: 3.1, y: 1.8, z: 103.9, thetaDeg: 1.98, phiDeg: 30.1,
//   standoffMm: 12, relativeAmplitude: 1, phaseDeg: 214.7, delayNs: 917.6, ... }
```

### From the command line

```bash
node bin/plan.js --mode acoustic --drive 650e3 --count 256 --target 0,0,25
node bin/plan.js --compare          # the table above
node bin/plan.js --mode optical --drive 630 --csv > emitters.csv
```

## How it works

**Propagation.** A layered spherical head (scalp, skull, CSF, grey, white) with
straight-ray path integration. For concentric shells the per-layer path lengths
have a closed form, so there is no ray marching: one square root per shell, no
allocation, exact. That is what makes the field map interactive.

Straight rays are the right approximation here for two different reasons. For
ultrasound it is exactly the first-order aberration correction used clinically
(per-element time-of-flight from a CT-derived speed map). For light, refraction
is irrelevant next to scattering, which dominates by hundreds of orders of
magnitude.

**Solvers.**

| Solver | What it optimises |
|---|---|
| `phaseConjugation` | Peak intensity at one point. Provably optimal — it is the matched filter, and Cauchy–Schwarz says nothing beats it. |
| `weightedGS` | Equal brightness across several foci, by weighted Gerchberg–Saxton. |
| `lcmv` | Targets lit *and* intensity minimised over ~1200 sampled points elsewhere. This is the one that actually attempts "cancel everywhere else"; it trades peak intensity for suppression. |

**Honesty checks.** Every run is assessed for source coherence, scattering
budget, array sampling, diffraction limit, selectivity, opsin compatibility,
exposure safety, thermal rise, and extracranial deposition. Each finding carries
a severity and the numbers that produced it.

## Tests

```bash
node test/run.js            # 71 tests, ~2 s, no dependencies
node test/run.js physics    # just the physics claims
```

The suite is not only unit tests. `test/test-physics.js` encodes the claims this
repository makes about the world — tissue optical properties against the
published literature, the ballistic-coherence collapse, the diffraction limit,
grating lobes and sidelobe pedestals, exposure budgets. **If a claim in the docs
is wrong, a test here should fail.**

It also checks the parts that are easy to get quietly wrong: the fast path
integral is verified against brute-force ray segmentation to 10⁻⁹ mm, and phase
conjugation is verified to be unbeatable against 400 random weight vectors.

## Layout

```
index.html              the planner UI
css/, app/              styles, canvas rendering, worker, UI wiring
src/
  constants.js          tissue properties, opsins, safety limits — all cited
  tissue.js             wavelength/frequency-dependent property model
  head-model.js         layered sphere, path segmentation
  propagation.js        Green's function, the fast exact path integral
  array-geometry.js     emitter layouts, pitch, grating lobes, diffraction
  solvers.js            phase conjugation, weighted GS, LCMV beamformer
  linalg.js             complex Cholesky and friends
  metrics.js            focus shape, hotspots, power budget, thermal
  feasibility.js        the verdict engine
  api.js                plan(), emitter tables, CSV export
bin/plan.js             CLI
test/                   71 tests
docs/                   VERDICT, PHYSICS, BIOLOGY, PRIOR-ART
```

## Scope and limits

This is a feasibility and teaching tool. It is **not** a treatment planning
system and nothing in it is validated for use on a living subject.

Known simplifications, stated plainly:

- Spherical head. Real heads are not spherical and real skulls vary locally in
  thickness and porosity — which is exactly why clinical ultrasound systems use
  per-subject CT. A spherical shell model is not sufficient on a real head.
- Straight rays; no refraction or mode conversion at interfaces.
- Scalar waves. Shear modes in bone are not modelled.
- The coherent field only. Diffuse transport is computed for comparison but is
  not propagated.
- Standing waves, cavitation and mechanical index are not modelled.

Where the literature disagrees — and for white-matter scattering it disagrees by
a factor of three — `src/constants.js` says so in a comment and explains why the
conclusion survives the spread.

## License

MIT. See [LICENSE](LICENSE).
