// CRT post-processing. Pipeline:
//
//   burn-in: a long-exposure accumulator (BURN_PERIOD_MS time constant)
//           integrates the frame IN PLACE — real phosphor wear, where the
//           most-hit areas (frame, plaque, ember bed, the fire's habitual
//           shape) carry the strongest afterimage and rarely-lit areas carry
//           none. Softened by a half-res bilinear bounce (phosphor spread)
//           and screen-blended at 0.32 (0.45 monochrome). This supersedes
//           the earlier offset ghost-lattice, which cast afterimages into
//           areas the tube never lit.
//   mono:   +10% mix toward the palette text color (monochrome palettes).
//   grid:   scanlines (×0.647 even rows, +0.047 white odd rows), column
//           separators (×0.835 every 3rd col), and a uv-space smoothstep
//           vignette — baked once into the #grid overlay, which sits above
//           the panels.
//
// Canvas "screen" at globalAlpha=op equals the GL shader's
//   color = 1 − (1−base)·(1−glow·op).
// The grid bakes "scene*M + A" into one alpha overlay: alpha = 1−M, gray = A/alpha.

import { TIMER_MS } from "./constants.js";

// Burn-in tuning (redesigned 2026-08-05, superseding the offset ghost
// lattice): REAL phosphor wear. A long-exposure accumulator integrates the
// frame IN PLACE, so the afterimage appears exactly where the tube gets hit —
// the frame/plaque and the fire's habitual shape burn in hardest, and areas
// that are rarely lit stay dark. No offset copies.
const BURN_PERIOD_MS = 20000; // exposure time constant of the accumulator
const BURN_ALPHA = 1 - Math.exp(-TIMER_MS / BURN_PERIOD_MS);
const SOFT_SCALE = 0.5;       // afterimage soften: downscale/upscale halo (~2px)

function smoothstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class Crt {
  constructor(fireCanvas, crtCanvas, gridCanvas) {
    this.fire = fireCanvas;
    this.crt = crtCanvas;
    this.ctx = crtCanvas.getContext("2d");
    this.grid = gridCanvas;
    this.gridCtx = gridCanvas.getContext("2d");

    this.enabled = false;
    this.monochrome = false;
    this.monoTint = [255, 255, 255];

    this.blur = document.createElement("canvas");
    this.blurCtx = this.blur.getContext("2d");
    this.bw = 1;
    this.bh = 1;

    // Long-exposure accumulator — the phosphor's memory of what it has shown.
    this.history = document.createElement("canvas");
    this.historyCtx = this.history.getContext("2d");
    this.primed = false;
  }

  setEnabled(on) {
    this.enabled = on;
    this.crt.hidden = !on;
    this.grid.hidden = !on;
    if (on) {
      this.primed = false;   // reprime so the shadows don't fade in from stale/black
      this.render();
    }
  }

  setMonochrome(on, tintRGB) {
    this.monochrome = on;
    this.monoTint = tintRGB;
  }

  resize(W, H) {
    this.crt.width = W;
    this.crt.height = H;
    this.grid.width = W;
    this.grid.height = H;
    this.bw = Math.max(1, Math.round(W * SOFT_SCALE));
    this.bh = Math.max(1, Math.round(H * SOFT_SCALE));
    this.blur.width = this.bw;
    this.blur.height = this.bh;
    this.history.width = W;
    this.history.height = H;
    this.primed = false;
    this.buildGrid(W, H);
    if (this.enabled) this.render();
  }

  // Scanlines + pixel separation + the GL shader's uv-space smoothstep
  // vignette (r = |uv−0.5|·1.414; stops 0.45→0, 0.75→60/255, 1.0→+140/255).
  buildGrid(W, H) {
    const img = this.gridCtx.createImageData(W, H);
    const d = img.data;
    const scanEvenMul = 0.647;          // black a90 over even rows
    const scanOddMul  = 1 - 0.047;      // white a12 over odd rows...
    const scanOddAdd  = 0.047;          // ...adds white
    const sepColMul   = 0.835;          // black a42 every 3rd column
    let i = 0;
    for (let y = 0; y < H; y++) {
      const even = (y & 1) === 0;
      const uy = y / H - 0.5;
      for (let x = 0; x < W; x++) {
        const ux = x / W - 0.5;
        const r = Math.sqrt(ux * ux + uy * uy) * 1.414;
        const a = smoothstep(0.45, 0.75, r) * (60 / 255)
                + smoothstep(0.75, 1.00, r) * (140 / 255);
        const vigMul = 1 - Math.min(1, Math.max(0, a));

        let M = even ? scanEvenMul : scanOddMul;
        let A = even ? 0 : scanOddAdd;
        if (x % 3 === 0) { M *= sepColMul; A *= sepColMul; }
        M *= vigMul;
        A *= vigMul;

        const alpha = 1 - M;
        const gray = alpha > 0 ? Math.min(1, Math.max(0, A / alpha)) : 0;
        d[i++] = (gray * 255) | 0;
        d[i++] = (gray * 255) | 0;
        d[i++] = (gray * 255) | 0;
        d[i++] = (alpha * 255) | 0;
      }
    }
    this.gridCtx.putImageData(img, 0, 0);
  }

  render() {
    const ctx = this.ctx;
    const W = this.crt.width;
    const H = this.crt.height;
    const op = this.monochrome ? 0.45 : 0.32;

    // Base: the crisp fire frame.
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(this.fire, 0, 0, W, H);

    // Fold the current frame into the long-exposure accumulator. The first
    // frame after enable/resize primes the buffer outright so the burn-in
    // doesn't fade up from black.
    const h = this.historyCtx;
    h.globalCompositeOperation = "source-over";
    h.globalAlpha = this.primed ? BURN_ALPHA : 1;
    h.drawImage(this.fire, 0, 0, W, H);
    h.globalAlpha = 1;
    this.primed = true;

    // Soften the accumulated exposure slightly (phosphor spread) — a
    // half-res bounce with bilinear sampling, no offsets: the afterimage
    // stays exactly where the tube was actually hit.
    const b = this.blurCtx;
    b.globalCompositeOperation = "source-over";
    b.globalAlpha = 1;
    b.imageSmoothingEnabled = true;
    b.drawImage(this.history, 0, 0, this.bw, this.bh);

    // Screen-blend the burn-in over the fire (bilinear upscale). Constantly
    // lit pixels (frame, plaque, ember bed, flame core) carry the strongest
    // afterimage; rarely lit pixels carry almost none.
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = op;
    ctx.drawImage(this.blur, 0, 0, W, H);

    // Monochrome tint.
    if (this.monochrome) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = `rgb(${this.monoTint[0]},${this.monoTint[1]},${this.monoTint[2]})`;
      ctx.fillRect(0, 0, W, H);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}
