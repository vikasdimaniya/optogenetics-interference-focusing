#!/usr/bin/env node
/**
 * Command-line planner.
 *
 *   node bin/plan.js --mode acoustic --drive 650e3 --count 256 --target 0,0,25
 *   node bin/plan.js --compare
 *   node bin/plan.js --mode optical --drive 630 --csv > emitters.csv
 *   node bin/plan.js --json
 */

import { plan, summarise, emitterTableCsv } from '../src/api.js';

const ARGS = (() => {
  const out = { _: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const key = a[i].slice(2);
      const next = a[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a[i]);
  }
  return out;
})();

function usage() {
  console.log(`
Interference focusing planner

  --mode <optical|acoustic>   wave type                     (default optical)
  --drive <number>            wavelength nm, or frequency Hz for acoustic
  --head <preset>             humanAdult | mouse            (default humanAdult)
  --layout <name>             sphericalCap | rings | fullSphere
  --count <n>                 emitter count                 (default 256)
  --half-angle <deg>          cap half-angle                (default 75)
  --standoff <mm>             gap from scalp                (default 10)
  --target x,y,z              target point in mm; repeatable via --target2 etc.
  --solver <name>             phaseConjugation | weightedGS | lcmv
  --opsin <name>              ChR2 | ChRmine | rsChRmine | ...
  --source <laser|led>        optical source coherence      (default laser)
  --irradiance <W/mm^2>       wanted irradiance at the focus
  --resolution <px>           slice resolution              (default 180)
  --plane <name>              coronal | axial | sagittal

  --csv                       print the emitter table as CSV
  --json                      print the full result as JSON
  --compare                   run the light-vs-ultrasound comparison
  --help
`);
}

function parseTarget(s) {
  const p = String(s).split(',').map(Number);
  if (p.length !== 3 || p.some(Number.isNaN)) {
    throw new Error(`bad --target "${s}", expected x,y,z`);
  }
  return { x: p[0], y: p[1], z: p[2] };
}

function buildConfig() {
  const mode = ARGS.mode ?? 'optical';
  const targets = [];
  for (const k of Object.keys(ARGS)) {
    if (/^target\d*$/.test(k)) targets.push(parseTarget(ARGS[k]));
  }
  if (targets.length === 0) targets.push({ x: 0, y: 0, z: 25 });

  return {
    mode,
    drive: ARGS.drive ? Number(ARGS.drive) : (mode === 'acoustic' ? 650e3 : 630),
    head: ARGS.head ?? 'humanAdult',
    array: {
      layout: ARGS.layout ?? 'sphericalCap',
      count: Number(ARGS.count ?? 256),
      halfAngleDeg: Number(ARGS['half-angle'] ?? 75),
      standoffMm: Number(ARGS.standoff ?? (mode === 'acoustic' ? 12 : 5)),
      ringCount: 6,
    },
    targets,
    solver: ARGS.solver ?? 'phaseConjugation',
    opsin: ARGS.opsin ?? 'ChRmine',
    sourceType: ARGS.source ?? (mode === 'acoustic' ? 'transducer' : 'laser'),
    targetIrradiance: ARGS.irradiance ? Number(ARGS.irradiance) : undefined,
    slice: {
      plane: ARGS.plane ?? 'coronal',
      resolution: Number(ARGS.resolution ?? 180),
    },
    computeField: !ARGS.csv,
  };
}

function compare() {
  const target = { x: 0, y: 0, z: 25 };
  const runs = [
    ['Red light, 630 nm, LEDs (the proposal as stated)', {
      mode: 'optical', drive: 630, sourceType: 'led', opsin: 'ChRmine',
      array: { layout: 'sphericalCap', count: 256, standoffMm: 5, halfAngleDeg: 80 },
    }],
    ['Best case for light: coherent laser, hypothetical 1000 nm opsin', {
      mode: 'optical', drive: 1000, sourceType: 'laser', opsin: 'hypotheticalNIR',
      array: { layout: 'sphericalCap', count: 1024, standoffMm: 2, halfAngleDeg: 85 },
    }],
    ['Ultrasound, 650 kHz, same geometry', {
      mode: 'acoustic', drive: 650e3,
      array: { layout: 'sphericalCap', count: 256, standoffMm: 12, halfAngleDeg: 75 },
      targetIrradiance: 1e-3,
    }],
  ];

  const rows = [];
  for (const [label, cfg] of runs) {
    const r = plan({ ...cfg, targets: [target], slice: { resolution: 161 } });
    console.log(`\n${'='.repeat(70)}\n${label}\n${'='.repeat(70)}`);
    console.log(summarise(r));
    rows.push({ label, r });
  }

  console.log(`\n${'='.repeat(70)}\nSIDE BY SIDE\n${'='.repeat(70)}`);
  const field = (r, f) => {
    const has = r.shape.peakModelIntensity > 0;
    switch (f) {
      case 'verdict': return r.assessment.verdict;
      case 'coherent': return r.config.mode === 'optical'
        ? `1e${r.assessment.coherence.log10BallisticFraction.toFixed(0)}`
        : 'essentially all';
      case 'focus': return has ? `${r.shape.lateralFwhmMm.toFixed(2)} mm` : 'none';
      case 'pbr': return has && Number.isFinite(r.stats.peakToBackground)
        ? r.stats.peakToBackground.toFixed(0) : 'n/a';
      case 'hotspots': return has ? String(Math.max(0, r.hotspots.spots.length - 1)) : 'n/a';
      case 'power': return Number.isFinite(r.assessment.budget.totalPowerW)
        ? `${r.assessment.budget.totalPowerW.toExponential(1)} W` : 'unbounded';
      default: return '';
    }
  };
  const labels = {
    verdict: 'verdict', coherent: 'coherent energy at target', focus: 'focus FWHM',
    pbr: 'peak/background', hotspots: 'extra hotspots', power: 'total power',
  };
  const w = 30;
  for (const key of Object.keys(labels)) {
    const cells = rows.map((x) => field(x.r, key).padEnd(24));
    console.log(`  ${labels[key].padEnd(w)} ${cells.join(' ')}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------

if (ARGS.help) { usage(); process.exit(0); }

try {
  if (ARGS.compare) {
    compare();
  } else {
    const cfg = buildConfig();
    const result = plan(cfg);
    if (ARGS.csv) {
      process.stdout.write(emitterTableCsv(result.table, {
        generated_by: 'optogenetics-interference-focusing',
        mode: cfg.mode,
        drive: cfg.mode === 'acoustic' ? `${cfg.drive} Hz` : `${cfg.drive} nm`,
        solver: cfg.solver,
        targets: JSON.stringify(cfg.targets),
        verdict: result.assessment.verdict,
        coordinate_frame: 'mm, origin at head centre, +z vertex, +y anterior, +x subject right',
      }));
      process.stdout.write('\n');
    } else if (ARGS.json) {
      console.log(JSON.stringify({
        config: result.config,
        verdict: result.assessment.verdict,
        findings: result.assessment.findings,
        focus: result.shape,
        stats: result.stats,
        coherence: result.assessment.coherence,
        budget: result.assessment.budget,
        emitters: result.table,
      }, null, 2));
    } else {
      console.log(`\n${summarise(result)}\n`);
      for (const f of result.assessment.findings) {
        if (f.severity === 'ok') continue;
        console.log(`[${f.severity.toUpperCase()}] ${f.title}`);
        console.log(`  ${f.detail.replace(/\s+/g, ' ').match(/.{1,86}(\s|$)/g).join('\n  ').trim()}\n`);
      }
    }
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  usage();
  process.exit(1);
}
