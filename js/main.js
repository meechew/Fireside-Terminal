// Bootstrap: load font, lay out the bordered fire box + side panels (mirroring
// AppLayout.cpp geometry), wire controls/keys, and run the fire loop.
//
// Web edition — adds PWA service-worker registration, an idle cursor hide,
// a fullscreen toggle, and the exit-intent donation pop-up.

import { COLS, ROWS, TIMER_MS, FONT_NAME, PANEL_W } from "./constants.js";
import { PALETTES } from "./palettes.js";
import { Fire } from "./fire.js";
import { Crt } from "./crt.js";
import { AudioEngine, Mode } from "./audio.js";
import { PLATFORM, keepScreenAlive, registerRemoteKeys, exitApp, isBackKey, applySafeArea } from "./platform.js";
import { initDonation } from "./donate.js";
import { runBootSplash } from "./boot.js";
import { createHud } from "./hud.js";

const fontSpec = (px) => `${px}px "${FONT_NAME}", monospace`;

const fire = new Fire();
const audio = new AudioEngine();

// Exit intent is a POINTER gesture -- the cursor leaving through the top of
// the viewport -- so on a touch device the donation pop-up had no way in at
// all. Rather than invent a mobile nag that interrupts, the pop-up gets a
// door: the HUD's lower-right slot, which in this free edition is empty
// forever (it exists for the premium nag the TV builds run, and there is no
// premium here). It already yields the row if it would collide with the
// now-playing readout, and the 1 Hz blink is already on the element.
//
// It is shown on EVERY pointer type, not just coarse ones. It was gated to
// coarse at first, on the reasoning that a mouse already has exit intent --
// but `(pointer: coarse)` is read once at load, so anything that changes
// afterwards is missed, and the gate mostly succeeded at hiding the control
// from the person developing it. A passive corner readout is also not the
// kind of "nag" that decision was about: it interrupts nothing.
const DONATE_NAG_TEXT = "DONATE HERE!";
// Always lit, per the brief -- NOT hud.js's setNag() duty cycle, which shows
// the premium nag for 10 s per NOW PLAYING, at most 5 min apart. That cadence exists to keep
// a blinking corner from etching an LG OLED panel, and a permanent blink
// gives that protection up. Since this one is always on the anti-burn-in
// drift matters MORE, not less, so it is kept: same +-3 px / +-1 px jitter
// hud.js uses, just on its own slow timer instead of once per duty cycle.
const DONATE_DRIFT_MS = 30000;
const DONATE_DRIFT_X  = 3;
const DONATE_DRIFT_Y  = 1;
let openDonation = () => {};
let donateNagOn = false;

const jitter = (n) => Math.floor(Math.random() * (2 * n + 1)) - n;

function driftDonateNag() {
  if (!donateNagOn) return;
  hud.nag.style.transform =
    `translate(${jitter(DONATE_DRIFT_X)}px, ${jitter(DONATE_DRIFT_Y)}px)`;
}

let paletteIndex = 0;
let crtEnabled = false;
let layout = null;

const fireCanvas = document.getElementById("fire");
const fireCtx = fireCanvas.getContext("2d");
const leftPanel = document.getElementById("left");
const rightPanel = document.getElementById("right");
// No { nag }: this edition is free, so there is no premium blink and nothing
// of the kind has ever been burned into its tube. It still gets the
// now-playing burn (PLAN-1.1.0.md feature 14).
const crt = new Crt(fireCanvas, document.getElementById("crt"), document.getElementById("grid"));
let hud = null;

const palette = () => PALETTES[paletteIndex];

// --- Font metrics ----------------------------------------------------------
function measure(ctx, px) {
  ctx.font = fontSpec(px);
  const m = ctx.measureText("Mg");
  const ascentRaw = m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || px * 0.8;
  const descentRaw = m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || px * 0.2;
  return {
    cw: Math.max(1, Math.round(ctx.measureText("-").width)),
    ch: Math.max(1, Math.ceil(ascentRaw + descentRaw)),
    ascent: Math.round(ascentRaw),
  };
}

// --- Layout ----------------------------------------------------------------
// Two geometries, one contract.
//
// LANDSCAPE is the TV layout: the bordered box between two vertical button
// rails, mirroring AppLayout.cpp so the panels track the fire box.
//
// PORTRAIT (PLAN-1.1.0.md feature 10) stacks instead -- frame on top,
// full-width controls underneath. It exists because 83 columns plus two
// 225 px rails simply do not fit across a viewport held upright, and the old
// single geometry did not degrade, it inverted: `W - 2*PANEL_W - 40` went
// NEGATIVE on a 375 px phone, the font slammed into its floor, the right rail
// was laid out entirely off-screen (measured x = 577) and the left one sat on
// top of the fire clipping its own labels.
//
// Scaling the whole TV layout down to fit was the cheaper option and it is
// the wrong one here: 375/1920 is 0.195, which letterboxes the entire UI into
// a 211 px strip of 3.5 px text. The 80x32 grid is TEXTURE -- it still reads
// as fire at 4 px a cell -- but labels are TEXT, so portrait decouples the
// two and sizes panel type on its own (PORTRAIT_BTN_PX, below).
const PORTRAIT_MAX_W  = 860;  // upright and narrower than this -> stacked
const PORTRAIT_MARGIN = 8;
const CONTROL_COLS    = 2;    // pairs the list up: FUEL / O2 / sound / premium
const BTN_MIN_H       = 44;   // touch-target floor
const BTN_GAP         = 6;
const STRIP_H         = 48;   // the palette row
const PORTRAIT_BTN_PX = 15;   // panel text -- NOT layout.fontPx
// The palette row shows all eight AT ONCE -- no scrolling. The cells split
// the width evenly and the type sizes itself to what a cell can hold: the
// largest size at which the LONGEST name still fits whole, capped at the
// control font and floored at STRIP_FONT_MIN.
//
// Above about 589 px -- upright tablets -- nothing truncates. That figure was
// worked out when DIGITAL RAIN (12 characters) was the longest name; since
// ABYSS took its slot back (2026-09-25) the longest is ALEJANDRA (9), so the
// real threshold is lower. On a phone the floor still wins and the longest
// names (ALEJANDRA, PHOSPHOR) are the ones that ellipsize. That is the
// deliberate trade: eight
// palettes you can see and reach beat eight whole words parked off-screen
// behind a scroll gesture nobody knows is there. Every name is still unique
// in its first four characters, so a clipped one is never ambiguous.
//
// The three geometry values are duplicated in css/style.css (`body.portrait
// #right`) because the browser lays the cells out and this only predicts the
// result. Change them together or the type stops matching its cell.
const STRIP_GAP      = BTN_GAP;          // the control grid's own gap and gutters,
const STRIP_PAD_X    = PORTRAIT_MARGIN;  // so the two blocks line up edge to edge
const STRIP_CELL_PAD = 2;     // each cell's gutters
const STRIP_FONT_MIN = 11;
// Landscape floor: however little room the rails leave, the frame never gets
// squeezed below this, which is what keeps the width budget positive.
const MIN_BOX_W  = 320;
const FONT_FLOOR = 6;
// Below this a rail has no room for .panel's 12 px gutters and the longest
// labels ("KILLER KARD", "ALEJANDRA") clip; `body.tight-rails` drops them
// to 4 px. It shifts the HUD row 8 px out of register with the buttons, since
// hud.js hardcodes the 12 -- invisible, and not worth forking a shared file
// over at a width no shipping phone reports even on its side.
const RAIL_TIGHT_W = 100;

const isPortrait = (W, H) => H > W && W < PORTRAIT_MAX_W;

// env(safe-area-inset-*) is reachable from CSS only, so read it through a
// probe: portrait puts buttons against the bottom edge, where the home
// indicator lives, and the frame up under the notch.
function safeInsets() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;" +
    "top:env(safe-area-inset-top,0px);bottom:env(safe-area-inset-bottom,0px)";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const out = { top: parseFloat(cs.top) || 0, bottom: parseFloat(cs.bottom) || 0 };
  probe.remove();
  return out;
}

// Largest font whose frame fits the width and height budgets. cw is rounded
// to a whole pixel, so the size the ratios pick can still overflow by a few
// columns' worth -- hence the step-down against the real measured width.
function fitFont(borderW, rowBudget, availW, availH, limitW) {
  const base = measure(fireCtx, 100);
  const byW = availW / borderW / (base.cw / 100);
  const byH = availH / rowBudget / (base.ch / 100);
  let px = Math.max(FONT_FLOOR, Math.floor(Math.min(byW, byH)));
  while (px > FONT_FLOOR && measure(fireCtx, px).cw * borderW > limitW) px--;
  return px;
}

function computeLayout(W, H) {
  const innerW = COLS + 1;            // 81
  const borderW = COLS + 3;           // 83
  const innerRows = ROWS + 4;         // 36 (fire + logs + embers + hearth base)
  const totalRows = 1 + innerRows + 1 + 1; // 39 (title lives in the bottom border)
  const portrait = isPortrait(W, H);
  // The HUD row sits one row BELOW the frame (constants.js hudRowTop), so in
  // portrait the vertical budget is the frame plus that row plus one spare.
  const HUD_ROWS = 2;

  const inset = safeInsets();
  let fontPx, railW = PANEL_W, frameTop = 0, frameBudgetH = 0;
  let blockTop = 0, controlsH = 0, stripPx = 0;

  if (portrait) {
    const rows = Math.ceil(LEFT_LABELS.length / CONTROL_COLS);
    controlsH = rows * BTN_MIN_H + (rows - 1) * BTN_GAP;
    const blockH = controlsH + BTN_GAP + STRIP_H;
    const availW = W - 2 * PORTRAIT_MARGIN;
    frameTop     = inset.top + PORTRAIT_MARGIN;
    frameBudgetH = H - inset.top - inset.bottom - blockH - PORTRAIT_MARGIN * 3;
    blockTop     = H - inset.bottom - PORTRAIT_MARGIN - blockH;
    fontPx = fitFont(borderW, totalRows + HUD_ROWS, availW, frameBudgetH, availW);

    const cells   = PALETTES.length;
    const cellW   = (W - 2 * STRIP_PAD_X - (cells - 1) * STRIP_GAP) / cells;
    const nameMax = PALETTES.reduce((n, p) => Math.max(n, p.name.length), 1);
    const cwPerPx = measure(fireCtx, 100).cw / 100;
    stripPx = Math.max(STRIP_FONT_MIN, Math.min(PORTRAIT_BTN_PX,
      Math.floor((cellW - 2 * STRIP_CELL_PAD) / nameMax / cwPerPx)));
  } else {
    railW = Math.max(0, Math.min(PANEL_W, Math.floor((W - MIN_BOX_W - 40) / 2)));
    frameBudgetH = H * 0.96;
    const availW = W - 2 * railW - 40;   // keep the box between the panels
    // The step-down limit is the wider W - 2*railW - 8: if rounding pushes the
    // frame past the 40 px gutter it may eat into it rather than drop a whole
    // font size, which at these sizes costs a quarter of the box width.
    fontPx = fitFont(borderW, totalRows, availW, frameBudgetH, W - 2 * railW - 8);
  }

  const { cw, ch, ascent } = measure(fireCtx, fontPx);

  const borderX = Math.floor((W - borderW * cw) / 2);
  const borderY = portrait
    ? frameTop + Math.max(0, Math.floor((frameBudgetH - (totalRows + HUD_ROWS) * ch) / 2))
    : Math.floor((H - totalRows * ch) / 2);
  const fireX = borderX + 2 * cw;
  const fireY = borderY + ch;
  const rightBorderX = borderX + (innerW + 1) * cw;
  const bottomBorderY = fireY + innerRows * ch;
  const borderRight = borderX + (COLS + 2) * cw;

  // Panel boxes. Landscape (AppLayout.cpp): vertically aligned to the inner
  // rows, centered in the left/right margins around the bordered box.
  // Portrait: full-bleed under the frame, controls grid then palette strip.
  const railY = borderY + ch;
  const railH = innerRows * ch;
  const leftBox = portrait
    ? { x: 0, y: blockTop, w: W, h: controlsH }
    : { x: Math.floor(borderX / 2 - railW / 2), y: railY, w: railW, h: railH };
  const rightBox = portrait
    ? { x: 0, y: blockTop + controlsH + BTN_GAP, w: W, h: STRIP_H }
    : { x: Math.floor((borderRight + W) / 2 - railW / 2), y: railY, w: railW, h: railH };

  // HUD/burn-in anchors -- deliberately NOT the panel boxes above. hud.js and
  // crt.js read the readout row as `leftX + 12` and `rightX + PANEL_W - 12`,
  // and both files are byte-identical to app/'s, so the contract is honored in
  // both geometries rather than forking the shared modules. Landscape at full
  // rail width reproduces the old values exactly; portrait anchors the row
  // just inside the frame, since there are no rails beside it any more.
  const leftX  = portrait ? borderX : leftBox.x;
  const rightX = portrait ? borderX + borderW * cw - PANEL_W
                          : rightBox.x + railW - PANEL_W;

  return {
    portrait, fontPx, font: fontSpec(fontPx), cw, ch, ascent,
    borderX, borderY, fireX, fireY, rightBorderX, bottomBorderY,
    innerW, innerRows, borderW,
    leftBox, rightBox, leftX, rightX,
    // Panel text is sized independently of the fire font in portrait: the
    // grid may shrink to texture, a label may not.
    buttonPx: portrait ? PORTRAIT_BTN_PX : fontPx,
    stripPx: portrait ? stripPx : fontPx,
    tightRails: !portrait && railW < RAIL_TIGHT_W,
  };
}

// --- Panels ----------------------------------------------------------------
// Panel order matches tvOS (PLAN-1.1.0.md features 2 + 11): FUEL leads the
// flame pair, SOUND OFF leads the sound group, and the premium pair
// (KILLER KARD, CRT) sits together at the bottom.
const LEFT_LABELS = ["FUEL +", "FUEL -", "O2 +", "O2 -", "SOUND OFF", "PC SPEAKER", "KILLER KARD", "CRT FILTER"];
let leftButtons = [];
let rightButtons = [];
let crtButton = null;

function buildPanels() {
  leftPanel.innerHTML = "";
  rightPanel.innerHTML = "";
  leftButtons = LEFT_LABELS.map((label) => {
    const b = document.createElement("button");
    b.textContent = label;
    leftPanel.appendChild(b);
    return b;
  });
  crtButton = leftButtons[7];
  rightButtons = PALETTES.map((p) => {
    const b = document.createElement("button");
    b.textContent = p.name;
    rightPanel.appendChild(b);
    return b;
  });

  // Left controls
  leftButtons[0].onclick = () => fire.incrementFuel();
  leftButtons[1].onclick = () => fire.decrementFuel();
  leftButtons[2].onclick = () => fire.incrementOxygen();
  leftButtons[3].onclick = () => fire.decrementOxygen();
  leftButtons[4].onclick = () => audio.setMode(Mode.Off);
  leftButtons[5].onclick = () => audio.setMode(Mode.PcSpeaker);
  leftButtons[6].onclick = () => audio.setMode(Mode.KillerKard);
  crtButton.onclick = () => toggleCrt();

  // Right palette selectors
  rightButtons.forEach((b, i) => { b.onclick = () => selectPalette(i); });
}

function positionPanels() {
  // The stacked/rails split is half geometry (here) and half flow direction
  // (css/style.css `body.portrait`), so the class and the boxes have to be
  // set together or the grid lands on rail coordinates.
  document.body.classList.toggle("portrait", layout.portrait);
  document.body.classList.toggle("tight-rails", layout.tightRails);
  for (const [panel, box] of [[leftPanel, layout.leftBox], [rightPanel, layout.rightBox]]) {
    panel.style.left = `${box.x}px`;
    panel.style.top = `${box.y}px`;
    panel.style.width = `${box.w}px`;
    panel.style.height = `${box.h}px`;
  }
}

// Mirrors AppLayout::applyButtonStyle — button bg = palette text color, button
// text = palette background color.
function applyButtonStyle() {
  const p = palette();
  // Two sizes in portrait: the controls get a comfortable fixed size, the
  // palette cells get whatever their eighth of the width will carry. In
  // landscape both are the fire font and this is the old single pass.
  const ctrl  = `${layout.buttonPx}px "${FONT_NAME}", monospace`;
  const strip = `${layout.stripPx}px "${FONT_NAME}", monospace`;
  for (const [list, css] of [[leftButtons, ctrl], [rightButtons, strip]]) {
    for (const b of list) {
      // --key-face / --key-ink, which style.css's held and latched rules
      // swap (app/js/main.js's applyButtonStyle, the exemplar's look).
      b.style.setProperty("--key-face", p.text);
      b.style.setProperty("--key-ink", p.background);
      b.style.font = css;
    }
  }
  if (hud) hud.applyPalette(p);
}

// --- Actions ---------------------------------------------------------------
// Apply a palette without any side effect on the rotation — the shared path
// used by both a user press and the auto-rotation.
function applyPalette(i) {
  paletteIndex = i;
  applyButtonStyle();
  crt.setMonochrome(palette().monochrome, palette().textRGB);
  console.log("[Palette]", palette().name);
}

function selectPalette(i) {
  if (i < 0 || i >= PALETTES.length) return;
  stopThemeRotation();   // the user is taking control of the theme
  applyPalette(i);
}
// --- Theme rotation ----------------------------------------------------------
// Until the user picks a theme, cycle the palette on its own so the app shows
// off the whole set unattended (PLAN-1.1.0.md feature 5). Armed when the boot
// splash clears, so the first advance never lands during the splash.
//
// The rotation walks the FULL list, premium themes included — it is a showcase,
// so it applies palettes directly and never consults the paywall gate. Only a
// deliberate palette press stops it; O2/fuel, sound and CRT input all leave it
// running. No persistence: every launch starts rotating again.
const ROTATE_MS = 30000;
let rotateTimer = null;

function startThemeRotation() {
  if (rotateTimer !== null) return;
  rotateTimer = setInterval(() => applyPalette((paletteIndex + 1) % PALETTES.length), ROTATE_MS);
}

function stopThemeRotation() {
  if (rotateTimer === null) return;
  clearInterval(rotateTimer);
  rotateTimer = null;
}

function toggleCrt() {
  crtEnabled = !crtEnabled;
  crt.setEnabled(crtEnabled);
  // A latching key: the label stays CRT FILTER and the key stays hollow
  // while the filter is on (style.css .latched), as the exemplar's does.
  crtButton.classList.toggle("latched", crtEnabled);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

// --- Stoke the fire --------------------------------------------------------
// Click/tap inside the fire grid drops a hot blob that flares and rises with
// the next tick (PLAN-1.1.0.md #1). The canvas backing store is sized to the
// window while the CSS box is pinned to 1920x1080, so the hit has to be
// scaled through the element's rendered rect rather than read from clientX.
function onFirePointerDown(e) {
  if (!layout) return;
  const rect = fireCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const px = (e.clientX - rect.left) * (fireCanvas.width / rect.width);
  const py = (e.clientY - rect.top) * (fireCanvas.height / rect.height);
  const col = Math.floor((px - layout.fireX) / layout.cw);
  const row = Math.floor((py - layout.fireY) / layout.ch);
  // stoke() rejects anything outside the fire grid, so clicks on the border,
  // the log art, and the ember bed fall through harmlessly.
  fire.stoke(col, row);
}

// --- Keyboard --------------------------------------------------------------
// Same bindings as the TV builds' desktop mirrors:
//   N — switch to PC Speaker; if already active, next song
//   K — Killer Kard fire synth
//   M — sound off
//   C — toggle CRT filter
//   P — play/pause toggle
//   F — toggle fullscreen
// Arrow keys drive 5-way navigation across the two button panels.
let navPanel = 0;  // 0 = left, 1 = right
let navIndex = 0;
// Mode the Play/Pause toggle resumes into after a pause.
let lastSoundMode = Mode.KillerKard;

function focusNav() {
  const list = navPanel === 0 ? leftButtons : rightButtons;
  navIndex = Math.max(0, Math.min(navIndex, list.length - 1));
  list[navIndex].focus();
}

function onKeyDown(e) {
  const k = e.keyCode;
  if (isBackKey(e)) {
    exitApp();
    return;
  }
  if (k === 406 || k === 78 || e.key === "n" || e.key === "N" || e.key === "ColorF3Blue") {
    if (audio.mode !== Mode.PcSpeaker) audio.setMode(Mode.PcSpeaker);
    else audio.nextSong();
    return;
  }
  if (k === 405 || e.key === "k" || e.key === "K" || e.key === "ColorF2Yellow") {
    audio.setMode(Mode.KillerKard);
    return;
  }
  if (k === 404 || e.key === "m" || e.key === "M" || e.key === "ColorF1Green") {
    audio.setMode(Mode.Off);
    return;
  }
  if (k === 403 || e.key === "c" || e.key === "C" || e.key === "ColorF0Red") {
    toggleCrt();
    return;
  }
  if (e.key === "f" || e.key === "F") {
    toggleFullscreen();
    return;
  }
  if (e.key === "p" || e.key === "P" || e.key === "MediaPlayPause") {
    if (audio.mode === Mode.Off) audio.setMode(lastSoundMode);
    else { lastSoundMode = audio.mode; audio.setMode(Mode.Off); }
    return;
  }
  if (k >= 37 && k <= 40) {                     // Left/Up/Right/Down
    const focused = document.activeElement;
    const inPanels = leftButtons.includes(focused) || rightButtons.includes(focused);
    if (inPanels) {
      // Re-derive position from the actually-focused button (pointer clicks
      // move focus without updating nav state).
      navPanel = leftButtons.includes(focused) ? 0 : 1;
      navIndex = (navPanel === 0 ? leftButtons : rightButtons).indexOf(focused);
      if (k === 38) navIndex--;                 // Up
      else if (k === 40) navIndex++;            // Down
      else navPanel = k === 37 ? 0 : 1;         // Left / Right
    }
    // First arrow press (or focus lost): land on the current nav slot.
    focusNav();
    e.preventDefault();
  }
}

// --- Idle cursor -----------------------------------------------------------
// The TV builds hide the cursor outright; on the web it hides after 3 s of
// stillness and returns on the first movement, like a video player.
function initIdleCursor() {
  let timer = null;
  const hide = () => document.body.classList.add("idle");
  const wake = () => {
    document.body.classList.remove("idle");
    clearTimeout(timer);
    timer = setTimeout(hide, 3000);
  };
  window.addEventListener("pointermove", wake);
  window.addEventListener("pointerdown", wake);
  wake();
}

// hud.position() sizes BOTH readouts off the fire font, which in portrait is
// the 8 px texture size. That is right for the ambient now-playing line and
// wrong for something you are meant to hit with a thumb, so the donate nag
// re-applies its own size after every position() and grows its own row to
// keep a usable target. Landscape desktop is untouched: there the fire font
// is already the larger of the two. Runs after position(), never inside
// hud.js -- that file is byte-identical to app/'s and stays that way.
function styleDonateNag() {
  if (!hud || !donateNagOn) return;
  const px   = Math.max(layout.fontPx, PORTRAIT_BTN_PX);
  const rowH = Math.max(layout.ch, px + 14);   // padding the line, not the box
  hud.nag.style.fontSize = `${px}px`;
  hud.nag.style.lineHeight = `${rowH}px`;
  hud.nag.style.height = `${rowH}px`;
  hud.nag.style.visibility = "visible";   // re-assert every relayout
  hud.reflowNag();   // re-check the collision guard at the new width
}

// --- Loop ------------------------------------------------------------------
function relayout() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  fireCanvas.width = W;
  fireCanvas.height = H;
  layout = computeLayout(W, H);
  crt.resize(W, H, layout);
  positionPanels();
  if (hud) {
    hud.position(layout, W);
    styleDonateNag();
  }
  applyButtonStyle();
  fire.render(fireCtx, palette(), layout);
  if (crtEnabled) crt.render();
}

async function init() {
  try {
    await document.fonts.load(fontSpec(32));
    await document.fonts.ready;
  } catch (err) {
    console.warn("[Font] load failed, using fallback metrics:", err);
  }

  buildPanels();
  hud = createHud();
  audio.onSongState((state) => hud.songState(state));
  applySafeArea();
  crt.setMonochrome(palette().monochrome, palette().textRGB);

  console.log("[Platform]", PLATFORM);
  registerRemoteKeys();
  keepScreenAlive((s) => console.log("[ScreenSaver]", s));

  relayout();
  window.addEventListener("resize", relayout);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("dblclick", toggleFullscreen);
  fireCanvas.addEventListener("pointerdown", onFirePointerDown);
  initIdleCursor();
  openDonation = initDonation(palette);
  hud.nag.textContent = DONATE_NAG_TEXT;
  hud.nag.classList.add("donate");
  hud.nag.setAttribute("role", "button");
  hud.nag.setAttribute("tabindex", "0");
  hud.nag.setAttribute("aria-label", "Donate");
  hud.nag.onclick = () => openDonation();
  // Enter/Space on a focused div-with-role=button is not free the way it is
  // on a real <button>; the element is hud.js's, so the keys are added here.
  hud.nag.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDonation(); }
  };
  donateNagOn = true;
  // Visible from here on. createHud() starts it hidden and nothing else ever
  // touches its visibility, because setNag() -- the only thing that would --
  // is deliberately never called on this edition.
  hud.nag.style.visibility = "visible";
  styleDonateNag();
  driftDonateNag();
  setInterval(driftDonateNag, DONATE_DRIFT_MS);

  // Boot splash — run the BIOS POST, then reveal the fire. Any key or click
  // skips it; boot.js owns both listeners and neither swallows the event, so
  // the key still reaches onKeyDown above. This edition ships no payment
  // system, so the premium step is handed a settled `true` and succeeds
  // without asking anyone.
  runBootSplash({
    entitled: Promise.resolve(true),
    onDone: () => { startThemeRotation(); },
  });

  // PWA: register the service worker for offline + install support.
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("[SW] registration failed:", err);
    });
  }

  setInterval(() => {
    fire.step();
    fire.render(fireCtx, palette(), layout);
    if (crtEnabled) crt.render();
  }, TIMER_MS);
}

init();
