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

const fontSpec = (px) => `${px}px "${FONT_NAME}", monospace`;

const fire = new Fire();
const audio = new AudioEngine();

let paletteIndex = 0;
let crtEnabled = false;
let layout = null;

const fireCanvas = document.getElementById("fire");
const fireCtx = fireCanvas.getContext("2d");
const leftPanel = document.getElementById("left");
const rightPanel = document.getElementById("right");
const crt = new Crt(fireCanvas, document.getElementById("crt"), document.getElementById("grid"));

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

// Pick the largest font size whose bordered box fits the screen and stays
// between the side panels, then compute the full layout (mirrors BurningLog +
// AppLayout geometry exactly so panels track the fire box).
function computeLayout(W, H) {
  const innerW = COLS + 1;            // 81
  const borderW = COLS + 3;           // 83
  const innerRows = ROWS + 4;         // 36 (fire + logs + embers + hearth base)
  const totalRows = 1 + innerRows + 1 + 1; // 39 (title lives in the bottom border)

  const base = measure(fireCtx, 100);
  const availH = H * 0.96;
  const availW = W - 2 * PANEL_W - 40; // keep the box between the panels
  const byH = availH / totalRows / (base.ch / 100);
  const byW = availW / borderW / (base.cw / 100);
  const fontPx = Math.max(8, Math.floor(Math.min(byH, byW)));

  const { cw, ch, ascent } = measure(fireCtx, fontPx);

  const borderX = Math.floor((W - borderW * cw) / 2);
  const borderY = Math.floor((H - totalRows * ch) / 2);
  const fireX = borderX + 2 * cw;
  const fireY = borderY + ch;
  const rightBorderX = borderX + (innerW + 1) * cw;
  const bottomBorderY = fireY + innerRows * ch;

  // Panels (AppLayout.cpp): vertically aligned to the inner rows, centered in
  // the left/right margins around the bordered box.
  const borderRight = borderX + (COLS + 2) * cw;
  const panelTop = borderY + ch;
  const panelH = innerRows * ch;
  const leftX = Math.floor(borderX / 2 - PANEL_W / 2);
  const rightX = Math.floor((borderRight + W) / 2 - PANEL_W / 2);

  return {
    fontPx, font: fontSpec(fontPx), cw, ch, ascent,
    borderX, borderY, fireX, fireY, rightBorderX, bottomBorderY,
    innerW, innerRows, borderW,
    panelTop, panelH, leftX, rightX,
  };
}

// --- Panels ----------------------------------------------------------------
const LEFT_LABELS = ["O2 +", "O2 -", "FUEL +", "FUEL -", "PC SPEAKER", "KILLER KARD", "SOUND OFF", "CRT OFF"];
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
  leftButtons[0].onclick = () => fire.incrementOxygen();
  leftButtons[1].onclick = () => fire.decrementOxygen();
  leftButtons[2].onclick = () => fire.incrementFuel();
  leftButtons[3].onclick = () => fire.decrementFuel();
  leftButtons[4].onclick = () => audio.setMode(Mode.PcSpeaker);
  leftButtons[5].onclick = () => audio.setMode(Mode.KillerKard);
  leftButtons[6].onclick = () => audio.setMode(Mode.Off);
  crtButton.onclick = () => toggleCrt();

  // Right palette selectors
  rightButtons.forEach((b, i) => { b.onclick = () => selectPalette(i); });
}

function positionPanels() {
  for (const [panel, x] of [[leftPanel, layout.leftX], [rightPanel, layout.rightX]]) {
    panel.style.left = `${x}px`;
    panel.style.top = `${layout.panelTop}px`;
    panel.style.width = `${PANEL_W}px`;
    panel.style.height = `${layout.panelH}px`;
  }
}

// Mirrors AppLayout::applyButtonStyle — button bg = palette text color, button
// text = palette background color.
function applyButtonStyle() {
  const p = palette();
  const css = `${layout.fontPx}px "${FONT_NAME}", monospace`;
  for (const b of [...leftButtons, ...rightButtons]) {
    b.style.backgroundColor = p.text;
    b.style.color = p.background;
    b.style.font = css;
  }
}

// --- Actions ---------------------------------------------------------------
function selectPalette(i) {
  if (i < 0 || i >= PALETTES.length) return;
  paletteIndex = i;
  applyButtonStyle();
  crt.setMonochrome(palette().monochrome, palette().textRGB);
  console.log("[Palette]", palette().name);
}

function toggleCrt() {
  crtEnabled = !crtEnabled;
  crt.setEnabled(crtEnabled);
  crtButton.textContent = crtEnabled ? "CRT ON" : "CRT OFF";
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
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

// --- Loop ------------------------------------------------------------------
function relayout() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  fireCanvas.width = W;
  fireCanvas.height = H;
  layout = computeLayout(W, H);
  crt.resize(W, H);
  positionPanels();
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
  applySafeArea();
  crt.setMonochrome(palette().monochrome, palette().textRGB);

  console.log("[Platform]", PLATFORM);
  registerRemoteKeys();
  keepScreenAlive((s) => console.log("[ScreenSaver]", s));

  relayout();
  window.addEventListener("resize", relayout);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("dblclick", toggleFullscreen);
  initIdleCursor();
  initDonation();

  // Boot splash — hold the BIOS screen for a beat, then reveal the fire.
  // Any key or click skips it.
  const splash = document.getElementById("splash");
  if (splash) {
    const dismiss = () => splash.remove();
    setTimeout(dismiss, 5000);
    window.addEventListener("keydown", dismiss, { once: true });
    window.addEventListener("pointerdown", dismiss, { once: true });
  }

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
