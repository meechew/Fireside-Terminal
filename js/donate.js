// Donation pop-up, shown on exit intent. Browsers refuse to render custom UI
// inside the real close/beforeunload dialog, so the standard approximation is
// exit *intent*: the pointer leaving through the top of the viewport, headed
// for the tab strip / close button. Shown at most once per page load.
//
// Colors follow the active palette (same convention as the side panels:
// button bg = palette text color, button text = palette background).
//
// Content is a placeholder for now — donation details land here later.
// Preview while styling: open the page with ?donate=1.

let shown = false;
let overlay = null;

function build(p) {
  overlay = document.createElement("div");
  overlay.id = "donate";
  overlay.innerHTML = `
    <div id="donate-box" role="dialog" aria-modal="true" aria-label="Donate">
      <div id="donate-title">*** FIRESIDE TERMINAL ***</div>
      <div id="donate-msg">PLEASE DONATE</div>
      <button id="donate-close">[ CLOSE ]</button>
    </div>`;
  document.body.appendChild(overlay);

  // Theme from the current palette. The message burns in a hot color off the
  // heat table (a bright band on every palette, monochrome included).
  const [br, bg, bb] = p.backgroundRGB;
  overlay.style.background = `rgba(${br},${bg},${bb},0.75)`;
  const box = overlay.querySelector("#donate-box");
  box.style.background = p.background;
  box.style.borderColor = p.text;
  box.style.color = p.text;
  overlay.querySelector("#donate-msg").style.color = p.table[215];
  const closeBtn = overlay.querySelector("#donate-close");
  closeBtn.style.background = p.text;
  closeBtn.style.color = p.background;

  const close = () => overlay.remove();
  closeBtn.onclick = close;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.contains(overlay)) close();
  });
  closeBtn.focus();
}

export function initDonation(getPalette) {
  const show = () => {
    if (shown) return;
    shown = true;
    build(getPalette());
  };

  // Pointer leaves the viewport through the top edge with no element taking
  // over (relatedTarget null) — classic exit-intent signal.
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget && e.clientY <= 0) show();
  });

  if (new URLSearchParams(location.search).has("donate")) show();
}
