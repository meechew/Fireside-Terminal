// Donation pop-up, shown on exit intent. Browsers refuse to render custom UI
// inside the real close/beforeunload dialog, so the standard approximation is
// exit *intent*: the pointer leaving through the top of the viewport, headed
// for the tab strip / close button. Shown at most once per page load.
//
// Content is a placeholder for now — donation details land here later.

let shown = false;
let overlay = null;

function build() {
  overlay = document.createElement("div");
  overlay.id = "donate";
  overlay.innerHTML = `
    <div id="donate-box" role="dialog" aria-modal="true" aria-label="Donate">
      <div id="donate-title">*** FIRESIDE TERMINAL ***</div>
      <div id="donate-msg">PLEASE DONATE</div>
      <button id="donate-close">[ CLOSE ]</button>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector("#donate-close").onclick = close;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.contains(overlay)) close();
  });
  overlay.querySelector("#donate-close").focus();
}

function show() {
  if (shown) return;
  shown = true;
  build();
}

export function initDonation() {
  // Pointer leaves the viewport through the top edge with no element taking
  // over (relatedTarget null) — classic exit-intent signal.
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget && e.clientY <= 0) show();
  });
}
