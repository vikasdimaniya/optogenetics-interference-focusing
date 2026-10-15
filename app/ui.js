/**
 * UI wiring. Reads controls, runs the planner in a worker, paints the result.
 */

import { OPSINS } from '../src/constants.js';
import { PLANES } from '../src/api.js';
import { emitterTableCsv } from '../src/api.js';
import {
  renderField, renderColorbar, renderProfile, makeTransform,
  projectToSlice, unprojectFromSlice, sliceNormal,
} from './render.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  mode: 'optical',
  targets: [{ x: 0, y: 0, z: 25 }],
  activeTarget: 0,
  lastPayload: null,
};

const PRESETS = {
  proposal: {
    label: 'The original idea',
    mode: 'optical', wavelength: 630, sourceType: 'led', opsin: 'ChRmine',
    layout: 'sphericalCap', count: 256, halfAngle: 80, standoff: 5,
    headPreset: 'humanAdult', targets: [{ x: 0, y: 0, z: 25 }], solver: 'phaseConjugation',
  },
  bestLight: {
    label: 'Best case for light',
    mode: 'optical', wavelength: 1000, sourceType: 'laser', opsin: 'hypotheticalNIR',
    layout: 'sphericalCap', count: 1024, halfAngle: 90, standoff: 2,
    headPreset: 'humanAdult', targets: [{ x: 0, y: 0, z: 25 }], solver: 'phaseConjugation',
  },
  ultrasound: {
    label: 'Ultrasound, same geometry',
    mode: 'acoustic', frequency: 650, layout: 'sphericalCap', count: 256,
    halfAngle: 75, standoff: 12, headPreset: 'humanAdult',
    targets: [{ x: 0, y: 0, z: 25 }], solver: 'phaseConjugation',
  },
  mouse: {
    label: 'Mouse, red light',
    mode: 'optical', wavelength: 630, sourceType: 'laser', opsin: 'ChRmine',
    layout: 'sphericalCap', count: 128, halfAngle: 70, standoff: 2,
    headPreset: 'mouse', targets: [{ x: 0, y: 0, z: 2.5 }], solver: 'phaseConjugation',
  },
  window: {
    label: 'Cranial window',
    mode: 'optical', wavelength: 590, sourceType: 'laser', opsin: 'ChRmine',
    layout: 'sphericalCap', count: 512, halfAngle: 60, standoff: 2,
    headPreset: 'window', targets: [{ x: 0, y: 0, z: 9.3 }], solver: 'phaseConjugation',
  },
};

// A thin slab standing in for a cranial window / acute slice preparation.
const WINDOW_HEAD = {
  name: 'Cranial window (thin slab)',
  shells: [
    { layer: 'csf', outerRadius: 10 },
    { layer: 'greyMatter', outerRadius: 9.7 },
  ],
};

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

let worker = null;
let fallbackPlan = null;
let reqId = 0;
let pending = false;
let queued = false;

function initWorker() {
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => onResult(ev.data);
    worker.onerror = async () => {
      worker = null;
      await loadFallback();
      schedule();
    };
  } catch {
    loadFallback();
  }
}

async function loadFallback() {
  if (fallbackPlan) return;
  const mod = await import('../src/api.js');
  fallbackPlan = mod.plan;
  console.warn('Worker unavailable; computing on the main thread.');
}

// ---------------------------------------------------------------------------
// Reading the form
// ---------------------------------------------------------------------------

function readConfig() {
  const mode = state.mode;
  const headPresetVal = $('headPreset').value;
  const drive = mode === 'acoustic'
    ? Number($('frequency').value) * 1e3
    : Number($('wavelength').value);

  const cfg = {
    mode,
    drive,
    head: headPresetVal === 'window' ? WINDOW_HEAD : headPresetVal,
    array: {
      layout: $('layout').value,
      count: Number($('count').value),
      halfAngleDeg: Number($('halfAngle').value),
      standoffMm: Number($('standoff').value),
      ringCount: 6,
    },
    targets: state.targets.map((t) => ({ ...t })),
    solver: $('solver').value,
    opsin: $('opsin').value,
    sourceType: mode === 'acoustic' ? 'transducer' : $('sourceType').value,
    emitterApertureMm2: Number($('aperture').value),
    targetIrradiance: (10 ** Number($('irradiance').value)) * 1e-3, // mW/mm^2 -> W/mm^2
    slice: { plane: $('plane').value, resolution: Number($('resolution').value) },
    hotspotThreshold: 0.5,
  };
  return cfg;
}

function schedule() {
  if (pending) { queued = true; return; }
  pending = true;
  queued = false;
  $('spinner').hidden = false;
  const cfg = readConfig();
  const id = ++reqId;

  if (worker) {
    worker.postMessage({ id, cfg });
  } else {
    // Main-thread fallback: yield once so the spinner paints.
    setTimeout(async () => {
      await loadFallback();
      try {
        const r = fallbackPlan(cfg);
        onResult(buildFallbackPayload(id, cfg, r));
      } catch (err) {
        onResult({ id, ok: false, error: String(err) });
      }
    }, 0);
  }
}

function buildFallbackPayload(id, cfg, r) {
  return {
    id, ok: true, config: cfg,
    shells: r.head.describe(),
    headOuterRadius: r.head.outerRadius,
    brainRadiusMm: r.brainRadiusMm,
    emitters: r.emitters.map((e) => ({ x: e.x, y: e.y, z: e.z })),
    targets: cfg.targets,
    table: r.table,
    slice: {
      plane: r.slice.plane, origin: r.slice.origin,
      axisU: r.slice.axisU, axisV: r.slice.axisV,
      nu: r.slice.nu, nv: r.slice.nv,
      extentU: r.slice.extentU, extentV: r.slice.extentV,
      maskRadiusMm: r.slice.maskRadiusMm,
    },
    field: {
      intensity: r.field.intensity, mask: r.field.mask,
      nu: r.field.nu, nv: r.field.nv, max: r.field.max,
    },
    brainMask: r.brainMask,
    shape: r.shape, stats: r.stats,
    hotspots: r.hotspots,
    targetingError: r.targetingError,
    extracranialPeak: r.extracranialPeak,
    profiles: null,
    assessment: r.assessment,
    layers: r.model.props.map((p, i) => ({
      layer: p.layer, name: p.name,
      wavelengthInMediumMm: p.wavelengthInMediumMm,
      mua: p.mua ?? null, mus: p.mus ?? null, musp: p.musp ?? null,
      muEff: p.muEff ?? null, muAmp: p.muAmp, speed: p.speed ?? null,
      penetrationDepthMm: p.penetrationDepthMm,
      transportMeanFreePathMm: p.transportMeanFreePathMm,
      thickness: r.head.describe()[i].thickness,
    })),
  };
}

function onResult(payload) {
  pending = false;
  $('spinner').hidden = true;
  if (payload.id !== reqId) { if (queued) schedule(); return; }
  if (!payload.ok) {
    $('findings').innerHTML = `<div class="finding finding--fatal"><div class="finding__top">
      <span class="finding__sev">error</span><span class="finding__title">Computation failed</span></div>
      <p class="finding__detail">${escapeHtml(payload.error)}</p></div>`;
    if (queued) schedule();
    return;
  }
  state.lastPayload = payload;
  draw();
  renderFindings(payload);
  renderKeyNumbers(payload);
  renderLayerTable(payload);
  renderEmitterTable(payload);
  updateVerdict(payload);
  if (queued) schedule();
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function displayOpts() {
  return {
    logScale: $('logScale').checked,
    dynamicRangeDb: Number($('dynamicRange').value),
    showEmitters: $('showEmitters').checked,
    showShells: $('showShells').checked,
    showHotspots: $('showHotspots').checked,
    showTargets: true,
  };
}

function draw() {
  const p = state.lastPayload;
  if (!p) return;
  const canvas = $('map');
  const ctx = canvas.getContext('2d');
  renderField(ctx, canvas, p, displayOpts());
  renderColorbar($('colorbar'), displayOpts());

  const dr = Number($('dynamicRange').value);
  if (p.profiles) {
    renderProfile($('profRadial'), p.profiles.radial, {
      dynamicRangeDb: dr, label: `+/-${p.profiles.radial.halfWidthMm} mm`,
    });
    renderProfile($('profTrans'), p.profiles.transverse, {
      dynamicRangeDb: dr, label: `+/-${p.profiles.transverse.halfWidthMm} mm`,
    });
  } else {
    for (const id of ['profRadial', 'profTrans']) {
      const c = $(id);
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.font = '11px ui-monospace, monospace';
      g.fillText('no coherent field', 10, c.height / 2);
    }
  }

  const planeName = { coronal: 'Coronal (x–z)', axial: 'Axial (x–y)', sagittal: 'Sagittal (y–z)' };
  $('stageTitle').textContent = `${planeName[p.slice.plane]} through target 1`;
}

// ---------------------------------------------------------------------------
// Findings and numbers
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderFindings(p) {
  const html = p.assessment.findings.map((f) => `
    <div class="finding finding--${f.severity}">
      <div class="finding__top">
        <span class="finding__sev">${f.severity}</span>
        <span class="finding__title">${escapeHtml(f.title)}</span>
      </div>
      <p class="finding__detail">${escapeHtml(f.detail)}</p>
    </div>`).join('');
  $('findings').innerHTML = html;
}

function fmtSci(v, digits = 2) {
  if (v === 0) return '0';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  const a = Math.abs(v);
  if (a >= 0.01 && a < 10000) return v.toPrecision(digits + 1).replace(/\.?0+$/, '');
  return v.toExponential(digits);
}

function renderKeyNumbers(p) {
  const a = p.assessment;
  const hasField = p.shape.peakModelIntensity > 0;
  const cells = [];

  const add = (k, v, n, cls = '') => cells.push(
    `<div class="keynum ${cls}"><div class="keynum__k">${k}</div>`
    + `<div class="keynum__v">${v}</div><div class="keynum__n">${n ?? ''}</div></div>`,
  );

  add('target depth', `${a.coherence.depthMm.toFixed(1)} mm`, 'below the scalp');

  if (p.config.mode === 'optical') {
    const l10 = a.coherence.log10BallisticFraction;
    add('coherent light left',
      l10 < -6 ? `10<sup>${l10.toFixed(0)}</sup>` : fmtSci(10 ** l10),
      `${a.coherence.transportLengths.toFixed(1)} transport MFP`,
      l10 < -3 ? 'keynum--bad' : 'keynum--good');
  } else {
    add('wavelength in brain', `${p.layers.find((l) => l.layer === 'greyMatter').wavelengthInMediumMm.toFixed(2)} mm`, 'sets the focus size');
  }

  if (hasField) {
    add('focus width', `${p.shape.lateralFwhmMm.toFixed(2)} mm`,
      `${p.shape.axialFwhmMm.toFixed(1)} mm along the beam`,
      p.shape.lateralFwhmMm < 5 ? 'keynum--good' : '');
    add('focal volume', `${fmtSci(p.shape.focalVolumeMm3)} mm³`, '-6 dB ellipsoid');
    add('peak / background',
      Number.isFinite(p.stats.peakToBackground) ? p.stats.peakToBackground.toFixed(0) : '∞',
      'inside brain tissue',
      p.stats.peakToBackground > 50 ? 'keynum--good' : 'keynum--bad');
    add('extra hotspots', `${Math.max(0, p.hotspots.spots.length - 1)}`,
      'above 50% of peak',
      p.hotspots.spots.length <= 1 ? 'keynum--good' : 'keynum--bad');
    add('targeting error', `${p.targetingError.errorMm.toFixed(2)} mm`, 'peak vs requested point');
  } else {
    add('focus', 'none', 'field underflows to zero', 'keynum--bad');
  }

  add('array pitch', `${a.pitchMm.toFixed(2)} mm`,
    `pitch/λ = ${fmtSci(a.gratingLobes.ratio)}`);

  const b = a.budget;
  add('total emitted power',
    Number.isFinite(b.totalPowerW) ? `${fmtSci(b.totalPowerW)} W` : '∞',
    `for ${fmtSci(a.targetIrradiance * 1e3)} mW/mm² at focus`,
    b.feasible ? 'keynum--good' : 'keynum--bad');
  add('surface exposure',
    Number.isFinite(b.surfaceIrradiance) ? `${fmtSci(b.surfaceIrradiance * 1e3)} mW/mm²` : '∞',
    `limit ${fmtSci(b.limit * 1e3)} mW/mm²`,
    b.feasible ? 'keynum--good' : 'keynum--bad');

  $('keyNumbers').innerHTML = cells.join('');
}

function renderLayerTable(p) {
  const optical = p.config.mode === 'optical';
  const head = optical
    ? ['layer', 'mm', 'μ<sub>a</sub>', 'μ<sub>s</sub>', "μ<sub>s</sub>'", 'μ<sub>eff</sub>', 'l<sub>t</sub> mm']
    : ['layer', 'mm', 'c m/s', 'α Np/mm', 'λ mm', '1/e mm'];
  const rows = p.layers.map((l) => (optical
    ? `<tr><td>${l.name}</td><td>${l.thickness.toFixed(1)}</td>
         <td>${fmtSci(l.mua)}</td><td>${fmtSci(l.mus)}</td><td>${fmtSci(l.musp)}</td>
         <td>${fmtSci(l.muEff)}</td><td>${fmtSci(l.transportMeanFreePathMm)}</td></tr>`
    : `<tr><td>${l.name}</td><td>${l.thickness.toFixed(1)}</td>
         <td>${(l.speed / 1e3).toFixed(0)}</td><td>${fmtSci(l.muAmp)}</td>
         <td>${l.wavelengthInMediumMm.toFixed(2)}</td>
         <td>${fmtSci(l.penetrationDepthMm)}</td></tr>`)).join('');
  $('layerTable').innerHTML =
    `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderEmitterTable(p) {
  const rows = p.table.slice(0, 400).map((r) => `<tr>
    <td>${r.index}</td><td>${r.x}</td><td>${r.y}</td><td>${r.z}</td>
    <td>${r.thetaDeg}</td><td>${r.phiDeg}</td><td>${r.standoffMm}</td>
    <td>${r.relativeAmplitude}</td><td>${r.phaseDeg}</td><td>${fmtSci(r.delayNs)}</td>
  </tr>`).join('');
  const note = p.table.length > 400
    ? `<p class="hint">Showing the first 400 of ${p.table.length}. The CSV contains all of them.</p>`
    : '';
  $('emitterTable').innerHTML = `${note}<table><thead><tr>
    <th>#</th><th>x mm</th><th>y mm</th><th>z mm</th><th>θ°</th><th>φ°</th>
    <th>gap mm</th><th>amp</th><th>phase°</th><th>delay ns</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}

function updateVerdict(p) {
  const el = $('verdict');
  const sev = p.assessment.worstSeverity;
  el.className = `verdict verdict--${sev}`;
  el.querySelector('.verdict__label').textContent = sev;
  const n = p.assessment.counts;
  const parts = [];
  if (n.fatal) parts.push(`${n.fatal} fatal`);
  if (n.severe) parts.push(`${n.severe} severe`);
  if (n.warning) parts.push(`${n.warning} warning`);
  el.querySelector('.verdict__text').textContent =
    `${p.assessment.verdict}${parts.length ? ` — ${parts.join(', ')}` : ''}`;
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

function renderTargets() {
  $('targetList').innerHTML = state.targets.map((t, i) => `
    <div class="target ${i === state.activeTarget ? 'is-active' : ''}" data-i="${i}">
      <span class="target__idx" title="Make active">${i + 1}</span>
      <input type="number" step="1" value="${t.x}" data-axis="x" aria-label="target ${i + 1} x">
      <input type="number" step="1" value="${t.y}" data-axis="y" aria-label="target ${i + 1} y">
      <input type="number" step="1" value="${t.z}" data-axis="z" aria-label="target ${i + 1} z">
      <button type="button" class="target__del" title="Remove" ${state.targets.length === 1 ? 'disabled' : ''}>&times;</button>
    </div>`).join('');

  $('targetList').querySelectorAll('.target').forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector('.target__idx').onclick = () => { state.activeTarget = i; renderTargets(); draw(); };
    row.querySelectorAll('input').forEach((inp) => {
      inp.onchange = () => {
        state.targets[i][inp.dataset.axis] = Number(inp.value);
        schedule();
      };
    });
    row.querySelector('.target__del').onclick = () => {
      if (state.targets.length === 1) return;
      state.targets.splice(i, 1);
      state.activeTarget = Math.min(state.activeTarget, state.targets.length - 1);
      renderTargets();
      schedule();
    };
  });
}

// ---------------------------------------------------------------------------
// Canvas interaction
// ---------------------------------------------------------------------------

function canvasToPoint(ev) {
  const p = state.lastPayload;
  if (!p) return null;
  const canvas = $('map');
  const rect = canvas.getBoundingClientRect();
  const px = ((ev.clientX - rect.left) / rect.width) * canvas.width;
  const py = ((ev.clientY - rect.top) / rect.height) * canvas.height;
  const geo = makeTransform(p, canvas.width, canvas.height);
  const [u, v] = geo.toMm(px, py);
  return { point: unprojectFromSlice(p.slice, u, v), u, v, px, py, geo };
}

function setupCanvas() {
  const canvas = $('map');

  canvas.addEventListener('click', (ev) => {
    const hit = canvasToPoint(ev);
    if (!hit) return;
    const r = Math.hypot(hit.point.x, hit.point.y, hit.point.z);
    if (r > state.lastPayload.brainRadiusMm) return; // only inside brain
    const t = {
      x: +hit.point.x.toFixed(1), y: +hit.point.y.toFixed(1), z: +hit.point.z.toFixed(1),
    };
    if (ev.shiftKey) {
      state.targets.push(t);
      state.activeTarget = state.targets.length - 1;
    } else {
      state.targets[state.activeTarget] = t;
    }
    renderTargets();
    schedule();
  });

  canvas.addEventListener('mousemove', (ev) => {
    const p = state.lastPayload;
    const hit = canvasToPoint(ev);
    if (!p || !hit) return;
    const { point } = hit;
    const r = Math.hypot(point.x, point.y, point.z);
    const shell = p.shells.find((s, i) => {
      const inner = i + 1 < p.shells.length ? p.shells[i + 1].outerRadius : 0;
      return r <= s.outerRadius && r > inner;
    });
    // Nearest pixel intensity.
    const du = p.slice.extentU / (p.slice.nu - 1);
    const dv = p.slice.extentV / (p.slice.nv - 1);
    const iu = Math.round((hit.u + p.slice.extentU / 2) / du);
    const iv = Math.round((hit.v + p.slice.extentV / 2) / dv);
    let txt = `x ${point.x.toFixed(1)}  y ${point.y.toFixed(1)}  z ${point.z.toFixed(1)} mm`
      + `\nr ${r.toFixed(1)} mm   ${shell ? shell.layer : 'outside head'}`;
    if (iu >= 0 && iu < p.slice.nu && iv >= 0 && iv < p.slice.nv) {
      const idx = iv * p.slice.nu + iu;
      let peak = 0;
      for (let i = 0; i < p.field.intensity.length; i++) {
        if (p.brainMask[i] && p.field.intensity[i] > peak) peak = p.field.intensity[i];
      }
      if (peak > 0) {
        const rel = p.field.intensity[idx] / peak;
        txt += `\n${rel > 0 ? `${(10 * Math.log10(rel)).toFixed(1)} dB` : '-∞ dB'} of focus peak`;
      }
    }
    $('readout').textContent = txt;
  });

  canvas.addEventListener('mouseleave', () => { $('readout').textContent = ''; });
}

// ---------------------------------------------------------------------------
// Control wiring
// ---------------------------------------------------------------------------

const SOLVER_HINTS = {
  phaseConjugation: 'Maximises intensity at the target. Provably the best you can do at a single '
    + 'point for a given total power, but it does not try to control the rest of the field.',
  weightedGS: 'Iteratively equalises brightness across several targets, so a deep focus and a '
    + 'shallow one come out the same. Phase-only drive.',
  lcmv: 'Holds the targets lit while actively minimising intensity over 1200 sampled points '
    + 'elsewhere in the brain. This is the solver that actually attempts "cancel everywhere else"; '
    + 'it trades peak intensity for suppression.',
};

function wavelengthHint(nm) {
  if (nm < 500) return 'Blue. Strongly absorbed by haemoglobin and strongly scattered. '
    + 'This is where ChR2 works and why fibre implants exist.';
  if (nm < 650) return 'Red. Where ChRmine and ReaChR operate. The deepest any real '
    + 'single-photon opsin reaches.';
  if (nm < 950) return 'Near-infrared "tissue window": lowest total attenuation, but no '
    + 'single-photon opsin responds here.';
  if (nm < 1100) return 'Beyond the opsin range. Water absorption is climbing.';
  return 'Water absorption dominates here; penetration collapses regardless of scattering.';
}

function frequencyHint(kHz) {
  if (kHz < 300) return 'Low frequency: the skull is nearly transparent but the focus is '
    + 'several millimetres across.';
  if (kHz <= 800) return 'The band clinical transcranial focused ultrasound actually uses: '
    + 'a workable compromise between skull loss and focus size.';
  if (kHz <= 1200) return 'Tighter focus, but skull attenuation and aberration are rising fast.';
  return 'Skull loss is severe at this frequency; transcranial use becomes impractical.';
}

function syncOutputs() {
  $('wlOut').textContent = `${$('wavelength').value} nm`;
  $('wlHint').textContent = wavelengthHint(Number($('wavelength').value));
  $('freqOut').textContent = `${$('frequency').value} kHz`;
  $('freqHint').textContent = frequencyHint(Number($('frequency').value));
  $('countOut').textContent = $('count').value;
  $('angleOut').textContent = `${$('halfAngle').value}°`;
  $('standoffOut').textContent = `${$('standoff').value} mm`;
  $('apertureOut').textContent = `${$('aperture').value} mm²`;
  $('resOut').textContent = `${$('resolution').value} px`;
  $('drOut').textContent = `${$('dynamicRange').value} dB`;
  const mw = 10 ** Number($('irradiance').value);
  $('irrOut').textContent = `${mw < 0.01 ? mw.toExponential(1) : mw.toPrecision(2)} mW/mm²`;
  $('solverHint').textContent = SOLVER_HINTS[$('solver').value] ?? '';
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.seg').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.mode === mode);
  });
  document.querySelectorAll('[data-when]').forEach((el) => {
    el.hidden = el.dataset.when !== mode;
  });
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  setMode(p.mode);
  if (p.wavelength) $('wavelength').value = p.wavelength;
  if (p.frequency) $('frequency').value = p.frequency;
  if (p.sourceType) $('sourceType').value = p.sourceType;
  if (p.opsin) $('opsin').value = p.opsin;
  $('layout').value = p.layout;
  $('count').value = p.count;
  $('halfAngle').value = p.halfAngle;
  $('standoff').value = p.standoff;
  $('headPreset').value = p.headPreset;
  $('solver').value = p.solver;
  state.targets = p.targets.map((t) => ({ ...t }));
  state.activeTarget = 0;
  syncOutputs();
  renderTargets();
  schedule();
}

function init() {
  // Opsin options.
  $('opsin').innerHTML = Object.entries(OPSINS).map(([k, o]) => {
    const label = o.hypothetical
      ? `${o.name}`
      : `${o.name} — ${o.peakNm} nm`;
    return `<option value="${k}" ${k === 'ChRmine' ? 'selected' : ''}>${label}</option>`;
  }).join('');

  // Add the cranial-window option to the head select.
  const hp = $('headPreset');
  const opt = document.createElement('option');
  opt.value = 'window';
  opt.textContent = 'Cranial window (10 mm slab)';
  hp.appendChild(opt);

  document.querySelectorAll('.seg').forEach((b) => {
    b.onclick = () => {
      setMode(b.dataset.mode);
      // Sensible defaults when switching.
      if (b.dataset.mode === 'acoustic') { $('standoff').value = 12; $('halfAngle').value = 75; }
      else { $('standoff').value = 5; $('halfAngle').value = 80; }
      syncOutputs();
      schedule();
    };
  });

  // Bind exactly one event per control: ranges fire `input` continuously,
  // selects fire `change`. Binding both to the same element queues a second,
  // identical computation on every interaction and leaves the spinner up.
  const ranges = ['wavelength', 'frequency', 'count', 'halfAngle', 'standoff',
    'aperture', 'resolution', 'irradiance'];
  const selects = ['layout', 'solver', 'opsin', 'headPreset', 'plane', 'sourceType'];
  for (const id of ranges) {
    $(id).addEventListener('input', () => { syncOutputs(); schedule(); });
  }
  for (const id of selects) {
    $(id).addEventListener('change', () => { syncOutputs(); schedule(); });
  }

  const redrawOnly = ['logScale', 'showEmitters', 'showShells', 'showHotspots', 'dynamicRange'];
  for (const id of redrawOnly) {
    $(id).addEventListener('input', () => { syncOutputs(); draw(); });
  }

  $('addTarget').onclick = () => {
    const last = state.targets[state.targets.length - 1];
    state.targets.push({ x: last.x + 12, y: last.y, z: last.z });
    state.activeTarget = state.targets.length - 1;
    renderTargets();
    schedule();
  };
  $('clearTargets').onclick = () => {
    state.targets = [state.targets[state.activeTarget] ?? { x: 0, y: 0, z: 25 }];
    state.activeTarget = 0;
    renderTargets();
    schedule();
  };

  document.querySelectorAll('[data-preset]').forEach((b) => {
    b.onclick = () => applyPreset(b.dataset.preset);
  });

  $('downloadCsv').onclick = () => {
    const p = state.lastPayload;
    if (!p) return;
    const meta = {
      generated_by: 'optogenetics-interference-focusing',
      mode: p.config.mode,
      drive: p.config.mode === 'acoustic' ? `${p.config.drive} Hz` : `${p.config.drive} nm`,
      solver: p.config.solver,
      head: typeof p.config.head === 'string' ? p.config.head : 'custom',
      targets: JSON.stringify(p.config.targets),
      verdict: p.assessment.verdict,
      coordinate_frame: 'mm, origin at head centre, +z vertex, +y anterior, +x subject right',
    };
    download('emitter-placement.csv', emitterTableCsv(p.table, meta), 'text/csv');
  };

  $('downloadJson').onclick = () => {
    const p = state.lastPayload;
    if (!p) return;
    download('plan.json', JSON.stringify({
      config: p.config,
      shells: p.shells,
      assessment: {
        verdict: p.assessment.verdict,
        worstSeverity: p.assessment.worstSeverity,
        findings: p.assessment.findings,
        coherence: p.assessment.coherence,
        budget: p.assessment.budget,
        diffraction: p.assessment.diffraction,
        pitchMm: p.assessment.pitchMm,
      },
      focus: p.shape,
      stats: p.stats,
      emitters: p.table,
    }, null, 2), 'application/json');
  };

  setupCanvas();
  setMode('optical');
  syncOutputs();
  renderTargets();
  initWorker();
  schedule();
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

init();
