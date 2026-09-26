// Animated boot POST (PLAN-1.1.0.md feature 17) — the BIOS screen the app
// shows before the fire, replacing the flat 5-second hold on a fully baked
// image.
//
// SPLIT OF RESPONSIBILITY, and why it is this way:
//
//   app/splash.png  is the BACKDROP only — the "FIRESIDE BIOS vX.Y.Z (C) ..."
//                   line, the wordmark, the EST. 1986 rule and the ember
//                   strip. It is markup (<img>), so it paints before a single
//                   line of JS runs. Two traps make that non-negotiable: the
//                   DOS font is `font-display: block` and init() awaits
//                   document.fonts.ready, so DOM text drawn early renders in
//                   fallback or not at all; and a purely JS-drawn POST would
//                   leave the screen black until the module graph loads.
//   this module     draws the POST lines and the closing line LIVE, over the
//                   backdrop, on a 1920x1080 stage scaled to fit so its text
//                   lands on the same pixel grid the art was baked on.
//
// Because the carol count and the premium verdict are now live, they can no
// longer drift from the code: scripts/render-splash-version.mjs went from
// stamping two lines to stamping one (the BIOS line), and blanks the bands
// this module writes into.
//
// THE WHOLE POST IS 30 s, LAUNCH TO FIRE. The animated part runs ~7.6 s and
// the rest is the prompt waiting to be struck; TOTAL_MS is measured from
// navigation start, so the wait absorbs whatever the beats above cost.
//
// THE POST ITSELF IS THE SAME LENGTH FOR EVERY USER, WHATEVER THEY PAID. The
// dot
// counts are what make that true: a SUCCESS on step 3 costs 1 dot and buys a
// dot each on steps 4 and 5, a NOT INSTALLED costs 3 dots and skips both. 3 + 0 + 0
// == 1 + 1 + 1, so a paying customer and a free one wait exactly as long, and
// nobody can time the boot to learn the verdict early. Keep that identity if
// you retune the dot counts; it holds whatever DOT_MS is.
//
// It ran in ~4.9 s first, chosen to stay inside the 5 s hold it replaced, and
// read as a progress bar rather than a machine checking itself (user,
// 2026-09-19). The 5 s figure was the plan's own prudence, not a store rule —
// the research behind feature 17 found no documented launch-screen or
// startup-time requirement on any of the six platforms — so it was spent.
// Any-key skip, which IS load-bearing, is untouched.
//
// Back must keep working throughout — a Back that does nothing is the exact
// 1.0.2 Vega certification failure and the Samsung Return Key Policy
// rejection. main.js registers onKeyDown and window.onPlatformBack before it
// calls in here, and this module only ADDS listeners, so that stays true.

import { POST_TEX_LABEL, POST_TEX_FOUND, POST_TEX_MISSING, KK_MODULE_NAME } from "./constants.js";
import { SONGS } from "./songs.js";

// Label + space + dot leader + space, padded out to this column, so every
// status word starts in the same place. Same figure the baked art used and
// the same one paywall.js's leader() uses for the DOS windows.
const DOT_COLUMN = 28;

// The memory count's ceiling, in K. 640K because of course it is.
const EMBERS_K = 640;

// Timings, all ms. HOLD_MS is measured from navigation start, not from the
// moment we are called, so a slow font load eats into the hold instead of
// being added to it.
const HOLD_MS   = 1300;   // backdrop alone: version + copyright, nothing else
const CURSOR_MS = 550;    // cursor blinks on an empty line before line 1
const DOT_MS    = 230;    // one dot ticks in
const SETTLE_MS = 150;    // leader snaps full, status word prints
const RAM_MS    = 1200;   // 0K -> 640K
const FINAL_MS  = 750;    // the closing line holds, then its dots count in
const TOTAL_MS  = 30000;  // the whole POST, launch to fire, if nobody strikes

// Status words, bracketed and colored by what they say, so the screen tells
// its story at a glance: a free user sees a yellow <NOT INSTALLED> with two
// yellow <SKIP>s stacked under it, and the HUD nag they are about to meet is
// saying the same thing. Green is a thing that happened, red a thing that
// failed, yellow a warning — a thing that was never attempted.
//
// THE COLORS ARE THE IBM EGA/VGA TEXT PALETTE, not picks of our own. A 1986
// PC had sixteen colors in text mode and these are four of them by their
// canonical RGB, so the POST is period-correct rather than merely period-
// flavored: bright white (15) for the brackets, light green (10), light red
// (12), and yellow (14) — which is THE warning attribute of the era, the one
// a BIOS or a DOS TUI printed a caution in, where brown (6) is just a dim
// amber. The body gray the labels and leaders use, rgb(160,160,150) sampled
// off the art, is already within a hair of light gray (7) = #AAAAAA, so the
// whole screen reads as one adapter's output.
const WHITE  = "#FFFFFF";   // EGA 15, bright white
const GREEN  = "#55FF55";   // EGA 10, light green
const RED    = "#FF5555";   // EGA 12, light red
const YELLOW = "#FFFF55";   // EGA 14, yellow — the warning attribute

const STATUS_COLOR = {
  OK:      GREEN,
  SUCCESS: GREEN,
  READY:   GREEN,
  [POST_TEX_FOUND]: GREEN,
  // NOT INSTALLED is yellow, not red (2026-09-23), for two reasons that agree:
  // a red line during a 30 s boot reads to store QA as a functional defect to
  // log (the 2026-09-21 review), and an empty co-processor socket is exactly
  // the thing a real BIOS reported as a warning — the part was never fitted,
  // nothing failed. The two SKIP lines under it are the same color for the
  // same reason, so the free boot reads as one yellow story and the HUD nag
  // (NAG_TEXT) finishes the sentence.
  [POST_TEX_MISSING]: YELLOW,
  SKIP:    YELLOW,
  FAILURE: RED,
};

// `<WORD>`: white brackets, colored word. An unknown word still gets its
// brackets and prints in the body color, so a new status can never come out
// looking like part of the leader.
function statusHtml(word) {
  const color = STATUS_COLOR[word];
  const open  = '<span style="color:' + WHITE + '">&lt;</span>';
  const close = '<span style="color:' + WHITE + '">&gt;</span>';
  const body  = color ? '<span style="color:' + color + '">' + word + "</span>" : word;
  return open + body + close;
}

const CURSOR = '<span class="splash-cursor">█</span>';

// The closing line, centered under the wordmark where the art used to bake
// "STOKING THE FIRE ...". It cannot say "stoking": the 1.1.0 marketing
// directive reserves "stoke" for the click-the-grid feature (CLAUDE.md).
// It reads as a BIOS check that passes — the dots count in and the line
// lands on HOT, the way every POST line lands on its status word.
const FINAL_TEXT = "PREHEATING THE COALS";
const FINAL_DOTS = 3;
const FINAL_HOT  = "HOT";

// The line holds bare for FINAL_MS exactly as it always did, and only then do
// its three dots tick in — three, two, one, fire — at the same cadence every
// POST line's dots use, with one more beat after the last one so it is
// actually seen. This is added to the end of the boot, not carved out of it.

// The dots that have not ticked in yet — and HOT before it lands — are still
// drawn, just hidden: the line is centered, so leaving them out would let it
// creep left and back as they arrive. visibility keeps their width, which is
// the whole point.
function finalHtml(shown, hot) {
  return FINAL_TEXT + " " + ".".repeat(shown)
       + '<span style="visibility:hidden">' + ".".repeat(FINAL_DOTS - shown) + "</span>"
       + '<span class="splash-hot"' + (hot ? "" : ' style="visibility:hidden"') + "> "
       + FINAL_HOT + "</span>";
}

// The prompt the boot ends on, one row under the closing line. IBM PC DOS
// 2.x/3.x PAUSE printed "Strike a key when ready . . ." — MS-DOS did not
// switch to "Press any key" until 4.x — so the 1986 wording is the accurate
// one here, and "strike" happens to be what you do to a match. The spaced
// ellipsis is DOS's own, not a typo.
//
// WHY THE BOOT WAITS HERE AT ALL: the POST says live things now (the carol
// count, the premium verdict, which features loaded), and at ~7.6 s it was
// gone before anyone could read them. So the last beat shows this and stops,
// and any key or click ignites. TOTAL_MS is the backstop — a TV left alone
// must still reach the fire, so the wait ends 30 s after launch. Back keeps
// working throughout, exactly as during the POST: these listeners only ADD,
// and main.js's onKeyDown still sees the key.
const PROMPT_TEXT = "STRIKE ANY KEY TO IGNITE . . .";

export function runBootSplash(opts) {
  const splash = document.getElementById("splash");
  const stage  = document.getElementById("splash-stage");
  const post   = document.getElementById("splash-post");
  const final  = document.getElementById("splash-final");
  const prompt = document.getElementById("splash-prompt");
  const onDone = opts.onDone;

  // No splash in the DOM (or a stripped-down host page): nothing to animate.
  if (!splash || !stage || !post || !final) {
    onDone();
    return;
  }

  // --- the 1920x1080 stage ------------------------------------------------
  // The backdrop used to be an object-fit: contain <img>, which centers and
  // scales itself but gives the overlay no way to follow. Same geometry, done
  // explicitly: a fixed-size stage scaled by the contain factor, with the art
  // and the text as siblings inside it.
  function fit() {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.setProperty("--splash-scale", String(s));
  }
  fit();
  window.addEventListener("resize", fit);

  // --- line model ---------------------------------------------------------
  // One entry per POST line, appended as it starts. `dots` is how many have
  // ticked in so far; `value` stays empty until the line settles, at which
  // point the leader fills to DOT_COLUMN in one go.
  const lines = [];
  let cursorLine = -1;   // which line the cursor trails; -1 = its own blank row

  function render() {
    let html = "";
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      const pad = Math.max(2, DOT_COLUMN - L.label.length);
      const shown = L.value ? pad : Math.min(L.dots, pad);
      // `blur` is a leading character count, not a flag: only the digits
      // smear during the memory count, not the word beside them.
      html += L.blur
        ? '<span class="splash-count">' + L.label.slice(0, L.blur) + "</span>" + L.label.slice(L.blur)
        : L.label;
      html += " " + ".".repeat(shown);
      if (L.value) html += " " + statusHtml(L.value);
      if (i === cursorLine) html += CURSOR;
      html += "\n";
    }
    if (cursorLine === -1) html += CURSOR;
    post.innerHTML = html;
  }

  // --- cancellable clock --------------------------------------------------
  // Every wait in the sequence goes through sleep(). After cancel() the
  // pending timer is cleared and no new sleep ever resolves, so the async
  // chain simply stops where it is — there is no abort flag to check after
  // each await, and no half-applied step.
  let cancelled = false;
  let timer = null;
  function sleep(ms) {
    return new Promise(function (resolve) {
      if (cancelled) return;
      timer = setTimeout(resolve, ms);
    });
  }
  function cancel() {
    cancelled = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  // --- steps --------------------------------------------------------------
  // Tick `dots` dots in one at a time, then fill the leader and print the
  // status word. `dots` of 0 means the step did no work at all and the value
  // lands immediately — which is the whole reason SKIP is worth 0 dots.
  async function step(label, dots, value) {
    const L = { label: label, dots: 0, value: "", blur: 0,
                end: { value: value } };
    lines.push(L);
    cursorLine = lines.length - 1;
    render();
    for (let i = 0; i < dots; i++) {
      await sleep(DOT_MS);
      L.dots++;
      render();
    }
    await sleep(SETTLE_MS);
    L.value = value;
    render();
    return L;
  }

  // The memory count: the number spins up from 0K under a blur with the
  // cursor sitting beside it, then lands on 640K sharp and settles like any
  // other line. The label is right-padded to a fixed 3 digits so "embers"
  // never moves while the digits churn.
  async function countEmbers() {
    const label = function (k) { return String(k).padStart(3, " ") + "K embers"; };
    const L = { label: label(0), dots: 0, value: "", blur: 4,
                end: { value: "OK", label: label(EMBERS_K) } };
    lines.push(L);
    cursorLine = lines.length - 1;
    render();
    const start = now();
    for (;;) {
      await sleep(25);
      const t = Math.min(1, (now() - start) / RAM_MS);
      // Counted in 8K steps: fast enough to smear, coarse enough to read as
      // a machine walking banks rather than a decorative odometer.
      L.label = label(Math.round((t * EMBERS_K) / 8) * 8);
      render();
      if (t >= 1) break;
    }
    // Sharpen on the landing frame, not on the settle: the number is meant to
    // come into focus at 640K and only then get its leader.
    L.blur = 0;
    render();
    await sleep(SETTLE_MS);
    L.value = "OK";
    render();
  }

  // Step 3 resolves the entitlement answer the rest of the screen depends on.
  // main.js fires isEntitled() at the top of boot, so by the time we get here
  // it has had HOLD_MS + the first two steps to land — no guess at t=0 is
  // needed, which is exactly why the animated POST works where a premium
  // splash variant could not (webOS wipes its cache on every version bump,
  // and tvOS keeps none at all).
  //
  // The promise is raced against the first dot rather than awaited outright:
  // a known-entitled answer stops there, and anything else — not entitled,
  // or not back yet — runs the full three dots and takes whatever has
  // arrived by then. Slow stores therefore cost the screen nothing.
  async function detectPremium(entitled) {
    // The co-processor line, as an XT BIOS printed its 8087 check: the label
    // is the spec, the verdict is the part found in the socket.
    const label = POST_TEX_LABEL;
    // Pessimistic until the store says otherwise: if a skip lands before the
    // answer does, NOT INSTALLED is what this line was going to say anyway.
    const L = { label: label, dots: 0, value: "", blur: 0,
                end: { value: POST_TEX_MISSING } };
    lines.push(L);
    cursorLine = lines.length - 1;
    render();

    let answer = null;
    entitled.then(function (v) {
      answer = v;
      if (v === true) L.end = { value: POST_TEX_FOUND };
    }, function () { /* never rejects today; NOT INSTALLED is the right fallback */ });

    await sleep(DOT_MS);
    L.dots = 1;
    render();
    if (answer !== true) {
      await sleep(DOT_MS);
      L.dots = 2;
      render();
      await sleep(DOT_MS);
      L.dots = 3;
      render();
    }
    await sleep(SETTLE_MS);
    const ok = answer === true;
    L.value = ok ? POST_TEX_FOUND : POST_TEX_MISSING;
    render();
    return ok;
  }

  async function sequence() {
    // Backdrop alone for the hold, then the cursor on its own line.
    await sleep(Math.max(0, HOLD_MS - now()));
    render();
    await sleep(CURSOR_MS);

    await step("Initializing hearth", 3, "OK");
    await countEmbers();
    const ok = await detectPremium(opts.entitled);
    // The two premium features, named the way the rest of the app names them
    // (KK_MODULE_NAME is the HUD's product-name spelling, not the button's).
    await step("Loading " + KK_MODULE_NAME + " audio", ok ? 1 : 0, ok ? "OK" : "SKIP");
    await step("Configuring CRT adapter",              ok ? 1 : 0, ok ? "OK" : "SKIP");
    await step("Initializing APU (4ch)", 1, "OK");
    await step(SONGS.length + "-carol system", 0, "READY");

    cursorLine = lines.length - 1;
    render();
    final.innerHTML = finalHtml(0, false);
    await sleep(FINAL_MS);
    for (let d = 1; d <= FINAL_DOTS; d++) {
      await sleep(DOT_MS);
      final.innerHTML = finalHtml(d, false);
    }
    await sleep(DOT_MS);
    final.innerHTML = finalHtml(FINAL_DOTS, true);   // ... HOT
    await sleep(DOT_MS);
    showPrompt();
    // TOTAL_MS is measured from navigation start, like HOLD_MS, so the whole
    // POST is 30 s to the fire however long the machine took to get here.
    await sleep(Math.max(0, TOTAL_MS - now()));
    finish();
  }

  function showPrompt() {
    if (!prompt) return;
    prompt.textContent = PROMPT_TEXT;
    prompt.classList.add("on");   // starts the blink lit, at this moment
  }

  // --- teardown -----------------------------------------------------------
  let finished = false;
  function finish() {
    if (finished) return;      // idempotent: the timer and a keypress can race
    finished = true;
    cancel();
    window.removeEventListener("keydown", onSkip, true);
    window.removeEventListener("pointerdown", onSkip, true);
    window.removeEventListener("resize", fit);
    splash.remove();
    onDone();
  }

  // Any key or click skips. It jumps to the END state — the completed screen,
  // premium verdict included — rather than aborting mid-POST, so nothing
  // downstream ever sees a half-run boot. The listeners do not preventDefault
  // or stop propagation: the key must still reach main.js's onKeyDown, which
  // is what keeps Back alive during the splash.
  function onSkip(e) {
    if (e.repeat) return;      // "any key" — a held button's repeats don't count
    cancel();
    paintEnd();
    finish();
  }
  function paintEnd() {
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (L.value) continue;
      L.blur = 0;
      if (L.end.label) L.label = L.end.label;
      L.value = L.end.value;
    }
    cursorLine = lines.length - 1;
    render();
    final.innerHTML = finalHtml(FINAL_DOTS, true);
  }

  window.addEventListener("keydown", onSkip, true);
  window.addEventListener("pointerdown", onSkip, true);

  sequence();
}

// performance.now() is ms since navigation start, so HOLD_MS can be spent
// from page load rather than from whenever the module graph finished.
function now() {
  return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
}
