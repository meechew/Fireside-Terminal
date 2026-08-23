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
