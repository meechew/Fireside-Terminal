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

// Stoke tuning -- mirrored by kStoke* in src/Core/FireEngine.cpp.
// A click throws a shower of sparks: STOKE_SPARKS particles fly out of the
// struck cell, ride their own buoyancy, and cool as they go, each writing
// heat into the grid as it passes. Lifetimes are staggered so the shower
// thins out rather than ending all at once.
// How hard a click lands depends on where it lands: the bottom of the fire
// and the log art throw a shower that nearly fills the box, the middle row
// barely puffs, and anything above the middle row does nothing at all --
// poking at smoke should not stoke a fire.
const STOKE_SPARKS_MIN = 6;     // particles thrown at the middle row
const STOKE_SPARKS_MAX = 90;    // ditto at the hearth -- nearly fills the box
const STOKE_REACH_MIN  = 0.75;  // launch-speed scale at the middle row
const STOKE_REACH_MAX  = 1.70;  // ditto at the hearth
const STOKE_ENDURE_MIN = 0.80;  // lifetime scale at the middle row
const STOKE_ENDURE_MAX = 1.45;  // ditto at the hearth
const STOKE_LIFE_MIN   = 10;    // shortest spark lifetime, in fire ticks
const STOKE_LIFE_MAX   = 22;    // longest ditto -- ~2.75 s at kTimer, before scaling
const STOKE_SPEED_MIN  = 0.45;  // launch speed, in rows per tick
const STOKE_SPEED_MAX  = 1.30;
const STOKE_LIFT       = 0.45;  // upward bias added to every launch
const STOKE_RISE       = 0.10;  // buoyancy gained per tick (hot air climbs)
const STOKE_DRAG       = 0.94;  // velocity kept per tick
const STOKE_JITTER     = 0.25;  // random sideways nudge per tick
const STOKE_PEAK       = 255;   // spark heat at birth
const STOKE_TAIL       = 70;    // spark heat just before it dies
const STOKE_HALO       = 0.55;  // heat written to a spark's side neighbors
const STOKE_FLASH      = 1.3;   // radius, in rows, of the burst at the click
const STOKE_MAX_SPARKS = 420;   // total particles in flight, all clicks
const STOKE_LOG_ROWS   = 4;     // log art + ember rows under the grid, all hearth
const STOKE_ASPECT     = 2.2;   // cell width:height, so motion reads isotropic

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
    this.sparks = [];    // live stoke particles; see stoke()
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

  // Stoke the fire (PLAN-1.1.0.md feature 1): a click bursts the struck cell
  // and throws a shower of sparks out of it. Only the particles are stored --
  // each step() moves them, writes their heat into the grid and cools them,
  // and the ordinary diffusion pass carries what they leave behind upward, so
  // the shower drifts and smears into the flames instead of sitting still.
  // Heat is only ever raised, so a spark can't dim a cell that's already
  // hotter. Column cols-1 is excluded because render() never draws it.
  //
  // The shower scales with how close to the fuel the click landed (see
  // strengthAt): the hearth erupts, the middle row barely puffs, and above the
  // middle row nothing happens.
  // Keep in step with FireEngine::stoke() in src/Core/FireEngine.cpp.
  stoke(col, row) {
    const { cols, rows } = this;
    // Clicks on the log art and ember bed below the grid count as the hearth,
    // which is why the row bound runs past rows-1: main.js hands over whatever
    // cell the pointer hit and the reach test lives here.
    if (col < 0 || col > cols - 2) return;
    if (row < 0 || row > rows - 1 + STOKE_LOG_ROWS) return;

    const t = this.strengthAt(row);
    if (t < 0) return;                       // above the middle row: no effect

    // A click on the wood is a click on the bottom of the fire.
    const originRow = Math.min(row, rows - 1);

    const count  = Math.round(STOKE_SPARKS_MIN + t * (STOKE_SPARKS_MAX - STOKE_SPARKS_MIN));
    const reach  = STOKE_REACH_MIN  + t * (STOKE_REACH_MAX  - STOKE_REACH_MIN);
    const endure = STOKE_ENDURE_MIN + t * (STOKE_ENDURE_MAX - STOKE_ENDURE_MIN);

    this.flash(col, originRow, reach);

    for (let i = 0; i < count; i++) {
      // Oldest sparks lose their slots, so a burst of clicks can't grow the
      // list without bound.
      if (this.sparks.length >= STOKE_MAX_SPARKS) this.sparks.shift();

      const ang = Math.random() * Math.PI * 2;
      const spd = (STOKE_SPEED_MIN + Math.random() * (STOKE_SPEED_MAX - STOKE_SPEED_MIN)) * reach;
      const life = STOKE_LIFE_MIN + randInt(STOKE_LIFE_MAX - STOKE_LIFE_MIN + 1);
      this.sparks.push({
        x: col,
        y: originRow,
        // Columns are about half as wide as rows are tall, so the horizontal
        // component is stretched to keep the spray circular on screen.
        vx: Math.cos(ang) * spd * STOKE_ASPECT,
        vy: Math.sin(ang) * spd - STOKE_LIFT,
        age: 0,
        life: Math.max(2, Math.round(life * endure)),
      });
    }
  }

  // Proximity to the fuel, as 0 at the middle row of the fire box rising to 1
  // at the hearth (the bottom grid row and the log art under it). Returns -1
  // for anything above the middle row, where a click does nothing: the fire is
  // stoked from below, and up there it's just smoke.
  strengthAt(row) {
    const mid = Math.floor(this.rows / 2);
    if (row < mid) return -1;
    const bottom = this.rows - 1;
    if (row >= bottom) return 1;
    return (row - mid) / (bottom - mid);
  }

  // The burst at the click itself: a small hot core so the click reads as
  // instant, before the first sparks have travelled anywhere.
  flash(col, row, reach) {
    const { cols, rows, heat } = this;
    const radius = STOKE_FLASH * reach;
    const xSpan = Math.ceil(radius * STOKE_ASPECT);
    const ySpan = Math.ceil(radius);
    for (let dy = -ySpan; dy <= ySpan; dy++) {
      const y = row + dy;
      if (y < 0 || y > rows - 1) continue;
      for (let dx = -xSpan; dx <= xSpan; dx++) {
        const x = col + dx;
        if (x < 0 || x > cols - 2) continue;
        const ax = dx / STOKE_ASPECT;
        const d = Math.sqrt(ax * ax + dy * dy);
        if (d > radius) continue;
        const value = Math.round(STOKE_PEAK * (1 - 0.45 * (d / radius)));
        const i = y * cols + x;
        if (heat[i] < value) heat[i] = value;
      }
    }
  }

  // Write one spark into the grid: a hot cell with a cooler smear either side,
  // which is what gives a lone particle enough width to read as an ember.
  paintSpark(s) {
    const { cols, rows, heat } = this;
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    if (y < 0 || y > rows - 1) return;
    const value = Math.max(STOKE_TAIL, Math.round(STOKE_PEAK * (1 - s.age / s.life)));
    const halo = Math.round(value * STOKE_HALO);
    for (let dx = -1; dx <= 1; dx++) {
      const cx = x + dx;
      if (cx < 0 || cx > cols - 2) continue;
      const v = dx === 0 ? value : halo;
      const i = y * cols + cx;
      if (heat[i] < v) heat[i] = v;
    }
  }

  // Advance every spark one tick: buoyancy, drag, a sideways nudge, then paint.
  // Sparks that outlive their life or leave the grid are dropped.
  stepSparks() {
    const { cols, rows } = this;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.vy -= STOKE_RISE;                                    // hot air climbs
      s.vx = s.vx * STOKE_DRAG + (Math.random() - 0.5) * STOKE_JITTER * STOKE_ASPECT;
      s.vy *= STOKE_DRAG;
      s.x += s.vx;
      s.y += s.vy;
      s.age++;
      if (s.age >= s.life || s.y < -1 || s.y > rows || s.x < -1 || s.x > cols) {
        this.sparks.splice(i, 1);
        continue;
      }
      this.paintSpark(s);
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

    this.stepSparks();

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
