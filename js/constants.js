// Ported from src/Constants/Constants.hpp — single source of truth for
// layout and timing. Audio constants live with the audio modules.

export const COLS      = 80;
export const ROWS      = 32;
export const TIMER_MS  = 125;          // fire tick (~8 FPS), matches kTimer
export const GLOW_MS   = 125;          // CRT composite rebuild, matches kGlowIntervalMs
export const FONT_NAME = "Less Perfect DOS VGA";
export const PANEL_W   = 225;          // px width of each side control panel
export const TITLE     = "FIRESIDE TERMINAL";

// Fire parameters
export const OXY_DEFAULT  = 230;
export const FUEL_DEFAULT = 225;
export const PARAM_MIN    = 0;
export const PARAM_MAX    = 255;

// What the app calls the thing you buy (user decision 2026-09-23). The free
// user is running an IBM XT with its 8087 socket empty, and the app nags them
// to install the 80T87 THERMAL EXPANSION — the math co-processor pun. Three
// words, one job each, so the screens speak with one voice:
//   THERMAL EXPANSION  the phenomenon the machine reports (POST label,
//                      socket status, gate text)
//   TEX                its short name — the spec, the driver and the part
//                      alike: the POST parenthetical, the TEX.SYS the placard
//                      "installs", the nag, the socket probe. (It was split
//                      with TXM for the hardware until 2026-09-24; one
//                      abbreviation reads better than two near-twins.)
//   80T87              the model, printed only where a detection RESULT is
// The 80T88 is the machine's own CPU (the placard's free column, and the
// splash art's "Main Log Processor" line, baked by render-splash-version.mjs).
// No SX/DX tiers: the XT had none. Mirrors the same block in
// src/Constants/Constants.hpp (kTex* / kPostTex* / kNagText ...); change them
// together, or the blink, the POST and the paywall stop speaking with one
// voice.
export const TEX_MODEL         = "80T87";
export const TEX_CPU           = "80T88";
export const TEX_DRIVER        = "TEX.SYS";
export const TEX_OVERLAY       = "T87.OVL";
// The paywall's info boxes for its two column heads — the real chips each
// one is modeled on. A click on a head opens its box and a second click
// closes it (never hover: most of these machines have a remote, not a
// mouse). Mirrors kTexCpuTip / kTexModelTip in src/Constants/Constants.hpp.
export const TEX_CPU_TIP =
  "80T88 - modeled on the Intel 8088 (1979),\n" +
  "the CPU inside the original IBM PC. It did\n" +
  "all of its own math in software, one step\n" +
  "at a time. Your fire runs on it alone.";
export const TEX_MODEL_TIP =
  "80T87 - modeled on the Intel 8087 (1980),\n" +
  "the math coprocessor made to sit in the empty\n" +
  "socket beside the 8088. The 8088 could only\n" +
  "do whole-number math in hardware; anything\n" +
  "with a decimal point - fractions, square\n" +
  "roots, sines, logarithms - it ground out\n" +
  "slowly in software. The 8087 did that math\n" +
  "in its own circuits, up to 100 times faster,\n" +
  "while the 8088 got on with everything else.\n" +
  "Fitted here, it runs the premium features.";
export const POST_TEX_LABEL    = "THERMAL EXPANSION (TEX)";
export const POST_TEX_FOUND    = "80T87 DETECTED";   // green
export const POST_TEX_MISSING  = "NOT INSTALLED";    // yellow: never attempted
export const NAG_TEXT          = "TEX NOT INSTALLED";
export const PLACARD_PLAQUE    = "╡ TEX.SYS SETUP ╞";
export const SOCKET_EMPTY_TEXT = "SOCKET EMPTY";
export const SOCKET_FULL_TEXT  = "80T87 DETECTED";
export const GATE_TEXT         = "THIS FUNCTION REQUIRES AN 80T87 THERMAL EXPANSION.";
export const FINE_PRINT_TEXT   = "Socket accepts 80T87-series TEX. No reboot required.";
// These two MUST stay the same length. They occupy the same cells, and the
// CRT etch burns the PLAYING one permanently — so if LOADING were shorter,
// the burnt "NOW PLAYING ..." would show through beside it and read as
// corrupted text ("LOADINGYING ...") rather than as a ghost. Equal width
// keeps the live line registered over its own burn. Dot leaders are the
// right idiom for the padding anyway; the DOS chrome already uses them.
export const LOADING_TEXT  = "LOADING .......";
export const PLAYING_TEXT  = "NOW PLAYING ...";
export const ERROR_TEXT    = "TEX READ ERROR";
export const HUD_HOLD_MS   = 5000;     // how long NOW PLAYING stays up

// What the HUD calls the fire synth. Deliberately NOT the button's
// "KILLER KARD" — on the readout it reads as a product name, so it is set
// like one (user decision 2026-09-19). The button, the paywall feature
// table and the store copy keep their all-caps spelling.
//
// The AudioWorklet cannot import (it is a classic script), and the native
// ports keep their own copies, so this string is duplicated in:
//   app/js/audio/fireside-processor.js, web-ver/js/audio/fireside-processor.js,
//   src/Constants/Constants.hpp (kKillerKardName), tvos/Sources/ChipSynthBridge.mm
export const KK_MODULE_NAME = "KillerKard";

// The HUD row: immediately BELOW the frame's bottom border. Not the border
// row itself — that row is the frame's own rule and title plaque, spanning
// most of the screen width, so a readout there would run underneath it. The
// band below the frame is empty (the panels stop at the frame's bottom too).
// Shared by hud.js and by crt.js's etch, which must burn the same cells.
export const hudRowTop = (L) => L.bottomBorderY + L.ch;
