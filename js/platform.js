// Platform layer — web (browser / PWA) edition. Keeps the same exported
// surface as the TV builds' platform.js so the shared modules port verbatim,
// but everything resolves to standard web APIs.

export const PLATFORM = "web";

// Keep the screen awake with the W3C Screen Wake Lock API where available
// (Chromium, Safari 16.4+, Firefox 126+; secure context required). The lock
// is silently released when the tab is hidden, so re-acquire on return.
let wakeLock = null;

export function keepScreenAlive(onStatus) {
  if (!("wakeLock" in navigator)) {
    if (onStatus) onStatus("web: no Wake Lock API");
    return false;
  }
  const acquire = async () => {
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      if (onStatus) onStatus("web wake lock held");
      wakeLock.addEventListener("release", () => {
        if (onStatus) onStatus("web wake lock released");
      });
    } catch (err) {
      // Denied (battery saver, permissions policy) — the fire burns on.
      if (onStatus) onStatus(`web wake lock refused: ${err.name}`);
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") acquire();
  });
  acquire();
  return true;
}

// TV-remote color keys need registration only on Tizen; browsers just work.
export function registerRemoteKeys() {}

// A browser tab can't script-close itself unless it opened itself; the
// browser chrome is the exit. No-op keeps main.js portable.
export function exitApp() {}

// Overscan is a TV-panel problem; browsers render edge to edge.
export function applySafeArea() {}

// No back/exit key on the web — Escape belongs to the browser (it already
// exits fullscreen), and Backspace belongs to the page.
export function isBackKey() {
  return false;
}
