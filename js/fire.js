// Ported 1:1 from src/Core/BurningLog.cpp — Doom-style ASCII fire on an
// 80x32 heat grid, rendered as monospace text with the bordered "log" frame.

import { COLS, ROWS, TITLE, OXY_DEFAULT, FUEL_DEFAULT, PARAM_MIN, PARAM_MAX } from "./constants.js";

// Heat (0-255) -> ASCII density character, matching kHeatChar.
const HEAT_CHAR = (() => {
  const t = new Array(256);
  for (let i = 0; i < 256; i++) {
    if      (i < 20)  t[i] = " ";
    else if (i < 50)  t[i] = ".";
    else if (i < 80)  t[i] = "'";
    else if (i < 105) t[i] = ":";
    else if (i < 130) t[i] = ";";
    else if (i < 150) t[i] = "+";
    else if (i < 170) t[i] = "*";
    else if (i < 190) t[i] = "x";
    else if (i < 210) t[i] = "X";
    else if (i < 225) t[i] = "#";
    else if (i < 240) t[i] = "&";
    else if (i < 250) t[i] = "%";
    else              t[i] = "@";
  }
  return t;
})();

const randInt = (n) => Math.floor(Math.random() * n); // [0, n), mirrors QRandomGenerator::bounded

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Log art: one split log stacked on two, bark ≡ with (@ @) end grain, over a
// glowing ember bed. Both rows are exactly cols-1 (79) characters.
const LOG_TOP =
  " ".repeat(19) + "(@" + "≡".repeat(37) + "@)" + " ".repeat(19);
const LOG_BOTTOM =
  "  " + "(@" + "≡".repeat(33) + "@)" + " " + "(@" + "≡".repeat(32) + "@)" + "   ";

export class Fire {
  constructor() {
    this.cols = COLS;
    this.rows = ROWS;
    this.oxygen = OXY_DEFAULT;
    this.fuel = FUEL_DEFAULT;
    this.heat = new Uint8Array(this.cols * this.rows);
    // Seed the bottom row to max so the fire starts immediately.
    for (let x = 0; x < this.cols; x++) this.heat[(this.rows - 1) * this.cols + x] = 255;
    this.embers = this.buildEmbers();
  }

  // Ember bed under the logs: denser toward the middle; mostly ░/▒ coals in
  // the deep-red band of the heat ramp, with a few hotter ∙/· sparks. Heat
  // values index the palette's stepped color table at render time, so every
  // theme gets embers in its own ramp colors.
  buildEmbers() {
    const w = this.cols - 1;
    const embers = new Array(w).fill(null);
    for (let x = 0; x < w; x++) {
      const mid = 1 - Math.abs(x - (w - 1) / 2) / ((w - 1) / 2);
      if (Math.random() < 0.85 * (0.25 + 0.75 * mid)) embers[x] = this.rollEmber();
    }
    return embers;
  }

  rollEmber() {
    const r = Math.random();
    if (r < 0.85) return { glyph: r < 0.55 ? "░" : "▒", heat: 85 + randInt(50) };
    return { glyph: r < 0.95 ? "∙" : "·", heat: 145 + randInt(20) };
  }

  incrementOxygen() { this.oxygen = Math.min(this.oxygen + 1, PARAM_MAX); }
  decrementOxygen() { this.oxygen = Math.max(this.oxygen - 1, PARAM_MIN); }
  incrementFuel()   { this.fuel   = Math.min(this.fuel + 1, PARAM_MAX); }
  decrementFuel()   { this.fuel   = Math.max(this.fuel - 1, PARAM_MIN); }

  // Stoke the fire (PLAN-1.1.0.md feature 1): drop a hot blob at the cell the
  // pointer hit. No new state and no timer — the next step() carries the blob
  // upward with everything else, so it flares and rises like a real spark.
  // Heat is only ever raised, so a stoke can't dim a cell that's already
  // hotter. Column cols-1 is excluded because render() never draws it.
  stoke(col, row) {
    const { cols, rows, heat } = this;
    if (col < 0 || col > cols - 2 || row < 0 || row > rows - 1) return;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = col + dx;
        const y = row + dy;
        if (x < 0 || x > cols - 2 || y < 0 || y > rows - 1) continue;
        // Plus-shaped falloff: hottest at the click, cooler on the diagonals.
        const dist = Math.abs(dx) + Math.abs(dy);
        const value = dist === 0 ? 255 : dist === 1 ? 190 : 120;
        const i = y * cols + x;
        if (heat[i] < value) heat[i] = value;
      }
    }
  }

  // One fire frame: re-seed the bottom row, propagate upward with drift + cooling.
  step() {
    const { cols, rows, heat } = this;

    for (let x = 0; x < cols; x++) {
      const decay = randInt(256 - this.oxygen);
      heat[(rows - 1) * cols + x] = Math.max(0, 255 - decay);
    }

    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < cols; x++) {
        const drift = randInt(256 - this.fuel);
        const srcX = (((x - drift + 1) % cols) + cols) % cols;
        const below = heat[(y + 1) * cols + srcX];
        heat[y * cols + x] = Math.max(0, below - drift);
      }
    }

    // Ember flicker — a few coals wander in heat each frame; occasionally a
    // glyph re-rolls so the bed shimmers without changing its silhouette.
    for (let i = 0; i < 8; i++) {
      const e = this.embers[randInt(this.embers.length)];
      if (!e) continue;
      const spark = e.glyph === "∙" || e.glyph === "·";
      e.heat = clamp(e.heat + randInt(17) - 8, spark ? 145 : 85, spark ? 165 : 135);
      if (randInt(100) < 3) {
        e.glyph = spark ? (e.glyph === "∙" ? "·" : "∙")
                        : (e.glyph === "░" ? "▒" : "░");
      }
    }
  }

  // Render border + fire + log art + title. `L` is the layout from main.js.
  render(ctx, palette, L) {
    const { cw, ch, ascent, borderX, borderY, fireX, fireY,
            rightBorderX, bottomBorderY, innerW, innerRows } = L;
    const { cols, rows, heat } = this;
    const text = palette.text;

    // Background
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    ctx.font = L.font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // --- Top border (CP437 double-line frame) ---
    ctx.fillStyle = text;
    ctx.fillText("╔", borderX, borderY + ascent);
    for (let i = 1; i <= innerW; i++) ctx.fillText("═", borderX + i * cw, borderY + ascent);
    ctx.fillText("╗", rightBorderX, borderY + ascent);

    // --- Side borders ---
    for (let row = 0; row < innerRows; row++) {
      const y = fireY + row * ch + ascent;
      ctx.fillText("║", borderX, y);
      ctx.fillText("║", rightBorderX, y);
    }

    // --- Bottom border, with the title set into the frame as a plaque ---
    const plaque = "╡ " + TITLE + " ╞";
    const side = Math.floor((innerW - plaque.length) / 2);
    const bottom = "═".repeat(side) + plaque + "═".repeat(innerW - side - plaque.length);
    ctx.fillText("╚", borderX, bottomBorderY + ascent);
    for (let i = 0; i < innerW; i++) ctx.fillText(bottom[i], borderX + (i + 1) * cw, bottomBorderY + ascent);
    ctx.fillText("╝", rightBorderX, bottomBorderY + ascent);

    // --- Fire grid (char-by-char, integer positions; matches cols-1 native bound) ---
    const table = palette.table;
    let lastColor = null;
    for (let y = 0; y < rows; y++) {
      const baseY = fireY + y * ch + ascent;
      for (let x = 0; x < cols - 1; x++) {
        const h = heat[y * cols + x];
        const glyph = HEAT_CHAR[h];
        if (glyph === " ") continue;
        const color = table[h];
        if (color !== lastColor) { ctx.fillStyle = color; lastColor = color; }
        ctx.fillText(glyph, fireX + x * cw, baseY);
      }
    }

    // --- Log art: wood-colored split logs over glowing embers ---
    const logY = fireY + rows * ch;
    const drawLog = (row, str) => {
      const y = logY + row * ch + ascent;
      for (let i = 0; i < str.length; i++) {
        if (str[i] !== " ") ctx.fillText(str[i], fireX + i * cw, y);
      }
    };
    ctx.fillStyle = palette.wood;
    drawLog(0, LOG_TOP);
    drawLog(1, LOG_BOTTOM);

    const emberY = logY + 2 * ch + ascent;
    lastColor = null;
    for (let x = 0; x < this.embers.length; x++) {
      const e = this.embers[x];
      if (!e) continue;
      const color = table[e.heat];
      if (color !== lastColor) { ctx.fillStyle = color; lastColor = color; }
      ctx.fillText(e.glyph, fireX + x * cw, emberY);
    }

    // Hearth base — a solid masonry ledge the coals rest on, in the frame
    // color so it reads as part of the fireplace surround.
    ctx.fillStyle = text;
    drawLog(3, "▀".repeat(this.embers.length));
  }
}
