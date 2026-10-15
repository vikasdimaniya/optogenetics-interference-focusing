/**
 * Canvas rendering: intensity heatmap, head shells, emitters, targets.
 * Plain 2-D canvas, no libraries.
 */

// Inferno-like perceptual colormap, 9 control points, linearly interpolated.
const COLORMAP = [
  [0, 0, 4], [22, 11, 57], [66, 10, 104], [106, 23, 110],
  [147, 38, 103], [188, 55, 84], [221, 81, 58], [243, 120, 25],
  [252, 165, 10], [246, 215, 70], [252, 255, 164],
];

export function colormap(t) {
  const x = Math.max(0, Math.min(1, t)) * (COLORMAP.length - 1);
  const i = Math.min(COLORMAP.length - 2, Math.floor(x));
  const f = x - i;
  const a = COLORMAP[i], b = COLORMAP[i + 1];
  return [
    (a[0] + f * (b[0] - a[0])) | 0,
    (a[1] + f * (b[1] - a[1])) | 0,
    (a[2] + f * (b[2] - a[2])) | 0,
  ];
}

const OUTSIDE = [16, 18, 24];

/**
 * Paint the intensity field into an offscreen ImageData at slice resolution,
 * then blit it scaled to the canvas.
 */
export function renderField(ctx, canvas, payload, opts = {}) {
  const {
    logScale = true, dynamicRangeDb = 50, showEmitters = true,
    showShells = true, showTargets = true, showHotspots = true,
  } = opts;

  const { intensity, mask, nu, nv } = payload.field;
  const W = canvas.width, H = canvas.height;

  // Normalise against the peak inside the brain, not inside the whole head,
  // so a hot skull does not wash out the picture of the focus.
  let peak = 0;
  for (let i = 0; i < intensity.length; i++) {
    if (payload.brainMask[i] && intensity[i] > peak) peak = intensity[i];
  }
  if (peak <= 0) {
    // Also try the whole head, so an all-scalp field is still visible.
    for (let i = 0; i < intensity.length; i++) {
      if (mask[i] && intensity[i] > peak) peak = intensity[i];
    }
  }

  const img = new ImageData(nu, nv);
  const data = img.data;
  const floor = 10 ** (-dynamicRangeDb / 10);

  for (let i = 0; i < intensity.length; i++) {
    const o = 4 * i;
    if (!mask[i]) {
      data[o] = OUTSIDE[0]; data[o + 1] = OUTSIDE[1]; data[o + 2] = OUTSIDE[2]; data[o + 3] = 255;
      continue;
    }
    let t = 0;
    if (peak > 0) {
      const rel = intensity[i] / peak;
      t = logScale
        ? (rel <= floor ? 0 : 1 + Math.log10(rel) / (dynamicRangeDb / 10))
        : rel;
    }
    const [r, g, b] = colormap(t);
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  }

  // Blit with nearest-neighbour off so the field looks smooth.
  const off = document.createElement('canvas');
  off.width = nu; off.height = nv;
  off.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, W, H);
  // v axis points up in physics, down in canvas coordinates.
  ctx.save();
  ctx.translate(0, H);
  ctx.scale(1, -1);
  ctx.drawImage(off, 0, 0, W, H);
  ctx.restore();

  const geo = makeTransform(payload, W, H);
  if (showShells) drawShells(ctx, payload, geo);
  if (showEmitters) drawEmitters(ctx, payload, geo);
  if (showHotspots) drawHotspots(ctx, payload, geo);
  if (showTargets) drawTargets(ctx, payload, geo);
  drawScaleBar(ctx, payload, geo, W, H);
  return { peak, geo };
}

/**
 * Mapping between slice coordinates (mm, relative to the slice origin) and
 * canvas pixels.
 */
export function makeTransform(payload, W, H) {
  const s = payload.slice;
  return {
    W, H,
    extentU: s.extentU,
    extentV: s.extentV,
    // mm -> px
    toPx: (su, sv) => [
      ((su + s.extentU / 2) / s.extentU) * W,
      H - ((sv + s.extentV / 2) / s.extentV) * H,
    ],
    // px -> mm
    toMm: (px, py) => [
      (px / W) * s.extentU - s.extentU / 2,
      ((H - py) / H) * s.extentV - s.extentV / 2,
    ],
    pxPerMm: W / s.extentU,
  };
}

/** Project a 3-D point into slice (u, v) millimetre coordinates. */
export function projectToSlice(slice, p) {
  const d = { x: p.x - slice.origin.x, y: p.y - slice.origin.y, z: p.z - slice.origin.z };
  const u = d.x * slice.axisU.x + d.y * slice.axisU.y + d.z * slice.axisU.z;
  const v = d.x * slice.axisV.x + d.y * slice.axisV.y + d.z * slice.axisV.z;
  // Distance out of the slice plane.
  const nrm = {
    x: slice.axisU.y * slice.axisV.z - slice.axisU.z * slice.axisV.y,
    y: slice.axisU.z * slice.axisV.x - slice.axisU.x * slice.axisV.z,
    z: slice.axisU.x * slice.axisV.y - slice.axisU.y * slice.axisV.x,
  };
  const out = d.x * nrm.x + d.y * nrm.y + d.z * nrm.z;
  return { u, v, out };
}

/** Inverse: slice (u,v) mm -> 3-D point. */
export function unprojectFromSlice(slice, u, v) {
  return {
    x: slice.origin.x + u * slice.axisU.x + v * slice.axisV.x,
    y: slice.origin.y + u * slice.axisU.y + v * slice.axisV.y,
    z: slice.origin.z + u * slice.axisU.z + v * slice.axisV.z,
  };
}

const SHELL_STYLE = {
  scalp: 'rgba(255,255,255,0.30)',
  skull: 'rgba(200,220,255,0.26)',
  csf: 'rgba(120,200,255,0.20)',
  greyMatter: 'rgba(160,255,200,0.28)',
  whiteMatter: 'rgba(255,230,160,0.16)',
};

function drawShells(ctx, payload, geo) {
  // The slice is a plane at distance h from the head centre, so each spherical
  // shell of radius R appears as a circle of radius sqrt(R^2 - h^2).
  const o = payload.slice.origin;
  const nrm = sliceNormal(payload.slice);
  const h = o.x * nrm.x + o.y * nrm.y + o.z * nrm.z;
  // Centre of the head projected into the slice.
  const centre = projectToSlice(payload.slice, { x: 0, y: 0, z: 0 });

  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const sh of payload.shells) {
    const rr = sh.outerRadius * sh.outerRadius - h * h;
    if (rr <= 0) continue;
    const r = Math.sqrt(rr) * geo.pxPerMm;
    const [cx, cy] = geo.toPx(centre.u, centre.v);
    ctx.strokeStyle = SHELL_STYLE[sh.layer] ?? 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

export function sliceNormal(slice) {
  return {
    x: slice.axisU.y * slice.axisV.z - slice.axisU.z * slice.axisV.y,
    y: slice.axisU.z * slice.axisV.x - slice.axisU.x * slice.axisV.z,
    z: slice.axisU.x * slice.axisV.y - slice.axisU.y * slice.axisV.x,
  };
}

function drawEmitters(ctx, payload, geo) {
  const maxAmp = payload.table.reduce((m, r) => Math.max(m, r.relativeAmplitude), 0) || 1;
  for (let i = 0; i < payload.emitters.length; i++) {
    const e = payload.emitters[i];
    const p = projectToSlice(payload.slice, e);
    // Only draw elements reasonably close to the slice plane.
    const near = Math.abs(p.out) < 14;
    if (!near) continue;
    const [x, y] = geo.toPx(p.u, p.v);
    if (x < -20 || y < -20 || x > geo.W + 20 || y > geo.H + 20) continue;
    const row = payload.table[i];
    const amp = row.relativeAmplitude / maxAmp;
    // Hue encodes drive phase, brightness encodes amplitude.
    const hue = row.phaseDeg;
    const fade = 1 - Math.min(1, Math.abs(p.out) / 14) * 0.65;
    ctx.fillStyle = `hsla(${hue}, 85%, ${35 + 30 * amp}%, ${0.35 + 0.6 * fade})`;
    ctx.beginPath();
    ctx.arc(x, y, 2.2 + 2.4 * amp, 0, 2 * Math.PI);
    ctx.fill();
  }
}

function drawTargets(ctx, payload, geo) {
  for (const t of payload.targets) {
    const p = projectToSlice(payload.slice, t);
    const [x, y] = geo.toPx(p.u, p.v);
    const inPlane = Math.abs(p.out) < 1.5;
    ctx.strokeStyle = inPlane ? '#7dffd4' : 'rgba(125,255,212,0.45)';
    ctx.lineWidth = 1.6;
    const R = 11;
    ctx.beginPath();
    ctx.moveTo(x - R, y); ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y); ctx.lineTo(x + R, y);
    ctx.moveTo(x, y - R); ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4); ctx.lineTo(x, y + R);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

function drawHotspots(ctx, payload, geo) {
  if (!payload.hotspots?.spots) return;
  const s = payload.slice;
  const du = s.extentU / (s.nu - 1 || 1);
  const dv = s.extentV / (s.nv - 1 || 1);
  ctx.strokeStyle = 'rgba(255,90,90,0.9)';
  ctx.lineWidth = 1.2;
  // Skip the first (that is the intended focus).
  for (let i = 1; i < payload.hotspots.spots.length; i++) {
    const sp = payload.hotspots.spots[i];
    const su = -s.extentU / 2 + sp.u * du;
    const sv = -s.extentV / 2 + sp.v * dv;
    const [x, y] = geo.toPx(su, sv);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

function drawScaleBar(ctx, payload, geo, W, H) {
  // Pick a round length close to a fifth of the frame.
  const targetMm = payload.slice.extentU / 5;
  const steps = [1, 2, 5, 10, 20, 50, 100];
  const mm = steps.reduce((a, b) => (Math.abs(b - targetMm) < Math.abs(a - targetMm) ? b : a));
  const px = mm * geo.pxPerMm;
  const x0 = 16, y0 = H - 18;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0);
  ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4);
  ctx.moveTo(x0 + px, y0 - 4); ctx.lineTo(x0 + px, y0 + 4);
  ctx.stroke();
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(`${mm} mm`, x0 + px + 7, y0 + 4);
}

/** Colourbar strip for the legend. */
export function renderColorbar(canvas, { logScale, dynamicRangeDb }) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  for (let x = 0; x < W; x++) {
    const [r, g, b] = colormap(x / (W - 1));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, 0, 1, H);
  }
}

/**
 * 1-D intensity profile through the focus, drawn as a line plot.
 * Reading a cross-section is how you actually judge a focus; a heatmap alone
 * hides the sidelobe floor.
 */
export function renderProfile(canvas, profile, opts = {}) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const { dynamicRangeDb = 50, label = '' } = opts;
  ctx.clearRect(0, 0, W, H);
  if (!profile || !profile.values.length) return;

  let peak = 0;
  for (const v of profile.values) if (v > peak) peak = v;
  if (peak <= 0) return;

  // Grid at 10 dB intervals.
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let db = 0; db <= dynamicRangeDb; db += 10) {
    const y = (db / dynamicRangeDb) * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    if (db > 0) ctx.fillText(`-${db}`, 2, y - 2);
  }
  // Centre line.
  ctx.strokeStyle = 'rgba(125,255,212,0.3)';
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();

  ctx.strokeStyle = '#f7a60a';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < profile.values.length; i++) {
    const rel = profile.values[i] / peak;
    const db = rel > 0 ? -10 * Math.log10(rel) : dynamicRangeDb;
    const y = Math.min(H, (db / dynamicRangeDb) * H);
    const x = (i / (profile.values.length - 1)) * W;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  if (label) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(label, W - 80, H - 4);
  }
}
