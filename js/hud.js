// The two corner readouts below the fire frame (PLAN-1.1.0.md feature 14).
//
//   lower left   transient, `wood`: "LOADING ... <NAME>" while a module swaps,
//                then "NOW PLAYING ... <NAME>" for HUD_HOLD_MS, then gone.
//                Driven entirely by the audio engine's onSongState() — either
//                engine, same surface.
//   lower right  "TEX NOT INSTALLED" in `hot`, only while the premium
//                gate is live and unowned. It comes up with every NOW
//                PLAYING — as if the missing module were found while the
//                song loaded, so every skip nags — and on its own if
//                NAG_MAX_GAP_MS passes with no song.
//
// Both sit on the row immediately BELOW the fire frame, aligned to the outer
// edge of the button columns. Not on the bottom-border row itself: that row
// is the frame's own ═══ rule and title plaque, spanning most of the screen
// width, so a readout there would run underneath it. The band under the frame
// is empty (the panels stop at the frame's bottom too) and is the only place
// at the bottom of the screen wide enough for these.
//
// DOM rather than canvas text on purpose: it keeps text layout out of the
// 8 Hz render loop entirely, lets the blink be pure CSS, and matches how
// every other piece of chrome in this app is already built.
//
// Why the nag is not simply left blinking: this is a 50-minute ambience
// screen whose flagship target is an LG OLED. A permanently blinking element
// in a fixed corner is how you etch a real customer's panel, so it runs on a
// duty cycle and drifts a couple of pixels each time it returns. It is still
// unmistakably a nag; it just cannot burn itself in.
//
// No optional chaining or modern syntax: this module also loads on Tizen 5.5
// / Chromium M69.

import { PANEL_W, NAG_TEXT, LOADING_TEXT, PLAYING_TEXT, ERROR_TEXT, HUD_HOLD_MS,
         hudRowTop } from "./constants.js";

const NAG_BLINK_MS   = 10000;   // visible, blinking at 1 Hz
const NAG_MAX_GAP_MS = 300000;  // ...with every NOW PLAYING, and never >5 min apart
const DRIFT_X = 3;             // px of anti-burn-in jitter per cycle
const DRIFT_Y = 1;

const randSigned = (n) => Math.floor(Math.random() * (2 * n + 1)) - n;

export class Hud {
  constructor(readoutEl, nagEl) {
    this.readout = readoutEl;
    this.nag = nagEl;
    this.layout = null;
    this.palette = null;
    this.holdTimer = null;
    this.nagTimer = null;
    this.nagArmed = false;    // the duty cycle is running
    this.nagWanted = false;   // ...and the gate says it should be
  }

  // --- Geometry -------------------------------------------------------------
  // One text row on the bottom-border baseline. The panels end exactly at
  // bottomBorderY (panelTop + panelH === bottomBorderY), and both corners are
  // outside the frame's x-range, so nothing collides with the fire box.
  position(L, W) {
    this.layout = L;
    const font = `${L.fontPx}px "Less Perfect DOS VGA", monospace`;
    // line-height === ch puts the baseline at top + ascent, because ch is
    // itself ceil(fontAscent + fontDescent) at this size — so half-leading is
    // zero and the DOM lands on the same baseline rule the canvas uses
    // (fireY + row*ch + ascent). The etch in crt.js depends on that.
    for (const el of [this.readout, this.nag]) {
      el.style.font = font;
      el.style.lineHeight = `${L.ch}px`;
      el.style.height = `${L.ch}px`;
      el.style.top = `${hudRowTop(L)}px`;
    }
    // Left: the left button's own edge (.panel carries padding: 0 12px).
    this.readout.style.left = `${L.leftX + 12}px`;
    // Right: mirrored onto the right button's edge, growing leftward.
    this.nag.style.right = `${W - (L.rightX + PANEL_W - 12)}px`;
    this.reflowNag();
  }

  // Degenerate-geometry guard. The two readouts share this row, growing
  // toward each other from opposite edges; at 1080p the nag ends ~600 px
  // clear of the longest carol title the readout can hold, so they cannot
  // meet. On a layout where they would, the nag yields a row — the readout
  // is the transient, informative one and keeps the good seat.
  reflowNag() {
    const L = this.layout;
    if (!L) return;
    this.nag.style.top = `${hudRowTop(L)}px`;
    const box = this.nag.getBoundingClientRect();
    if (box.width && box.left < L.leftX + 12) {
      this.nag.style.top = `${hudRowTop(L) + L.ch}px`;
    }
  }

  applyPalette(p) {
    this.palette = p;
    this.nag.style.color = p.hot;
    // Opaque, in the palette's own background: these boxes sit over the CRT
    // etch, and a live line showing its own burn through the gaps in its
    // glyphs reads as corrupted text ("LOADINGYING ..."), not as a ghost.
    // Masking it is also how the panels already composite over the fire, and
    // the row is over plain background anyway so the box is invisible. The
    // burn returns the moment the line hides — and, for the nag, on every
    // dark half of its blink, because opacity fades the box with the text.
    this.readout.style.backgroundColor = p.background;
    this.nag.style.backgroundColor = p.background;
    // The readout is wood unless it is currently reporting a failure, which
    // is the one thing in this corner that is not ambience.
    this.readout.style.color = this.readout.dataset.tone === "hot" ? p.hot : p.wood;
  }

  // --- Lower left -----------------------------------------------------------
  show(text, tone, holdMs) {
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.readout.textContent = text;
    this.readout.dataset.tone = tone;
    this.readout.style.color = tone === "hot" ? this.palette.hot : this.palette.wood;
    this.readout.style.visibility = "visible";
    if (holdMs) this.holdTimer = setTimeout(() => this.hide(), holdMs);
  }

  hide() {
    clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.readout.style.visibility = "hidden";
    this.readout.textContent = "";
    this.readout.dataset.tone = "wood";   // don't let a past error re-tint on repaint
  }

  // The audio engines' single entry point. LOADING has no hold — it stays up
  // until the module actually starts, however long that takes (on Samsung
  // that is a real CDN fetch, not the worklet's 0.25 s of theatre).
  songState(s) {
    if (!s || !this.palette) return;
    if (s.phase === "loading")      this.show(`${LOADING_TEXT} ${s.name}`, "wood", 0);
    else if (s.phase === "playing") {
      this.show(`${PLAYING_TEXT} ${s.name}`, "wood", HUD_HOLD_MS);
      this.nagShow();
    }
    else if (s.phase === "error")   this.show(ERROR_TEXT, "hot", HUD_HOLD_MS);
    else                            this.hide();   // "off"
  }

  // --- Lower right ----------------------------------------------------------
  // `wanted` is the premium gate's own verdict; never a second copy of the
  // entitlement check. Called again when a purchase or restore lands, so the
  // nag clears without a relaunch.
  setNag(wanted) {
    this.nagWanted = wanted;
    if (!wanted) {
      clearTimeout(this.nagTimer);
      this.nagTimer = null;
      this.nagArmed = false;
      this.nag.style.visibility = "hidden";
      return;
    }
    if (!this.nagArmed) {
      this.nagArmed = true;
      this.nagShow();
    }
  }

  // Also the NOW PLAYING hook, so it restarts the window (and with it the
  // 5-minute clock) rather than stacking one. A skip that lands mid-window
  // keeps the offset it has — a jump there would read as a glitch.
  nagShow() {
    if (!this.nagArmed || !this.nagWanted) return;
    clearTimeout(this.nagTimer);
    if (this.nag.style.visibility !== "visible") {
      this.nag.style.transform = `translate(${randSigned(DRIFT_X)}px, ${randSigned(DRIFT_Y)}px)`;
      this.nag.style.visibility = "visible";
    }
    this.nagTimer = setTimeout(() => this.nagHide(), NAG_BLINK_MS);
  }

  // Measured start to start: the next showing is due NAG_MAX_GAP_MS after
  // this one began, unless a song brings it sooner.
  nagHide() {
    this.nag.style.visibility = "hidden";
    this.nagTimer = setTimeout(() => this.nagShow(), NAG_MAX_GAP_MS - NAG_BLINK_MS);
  }
}

// Builds the two elements and returns a wired Hud. The blink is the
// @keyframes hud-blink rule in style.css, so it costs no JS at all — and
// keeps this module free of the DOS-chrome modules, which the PWA does not
// ship.
export function createHud() {
  const mk = (id, extra) => {
    const el = document.createElement("div");
    el.id = id;
    el.className = "hud";
    el.style.cssText = extra;
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    return el;
  };
  const readout = mk("hud-readout", "text-align:left;");
  const nag = mk("hud-nag", "text-align:right;animation:hud-blink 1s step-end infinite;");
  nag.textContent = NAG_TEXT;
  return new Hud(readout, nag);
}
