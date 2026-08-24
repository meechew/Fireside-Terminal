// Donation pop-up, shown on exit intent. Browsers refuse to render custom UI
// inside the real close/beforeunload dialog, so the standard approximation is
// exit *intent*: the pointer leaving through the top of the viewport, headed
// for the tab strip / close button. Shown at most once per page load.
//
// Colors follow the active palette (same convention as the side panels:
// button bg = palette text color, button text = palette background). The four
// donation QR codes sit in the corners, re-tinted to the palette at show time:
// dark modules become a darkened palette-text color on a light tile, which
// keeps the theme hue without dropping below scannable contrast.
//
// Preview while styling: open the page with ?donate=1.

let shown = false;
let overlay = null;

const QRS = [
  { src: "qr/btc.png", label: "BITCOIN", corner: "tl" },
  { src: "qr/eth.png", label: "ETHEREUM", corner: "tr" },
  { src: "qr/xrp.png", label: "XRP", corner: "bl" },
  { src: "qr/paypal.png", label: "PAYPAL", corner: "br" },
];

// Repaint a QR image in palette colors. Maps pixel darkness onto a ramp from
// a light tile color (near-white, faintly tinted toward the palette text) to
// a dark ink (palette text hue, scaled down so modules stay dark enough to
// scan on every palette, including bright monochromes like B/W).
function themeQR(canvas, img, p) {
  const w = img.width, h = img.height;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const [tr, tg, tb] = p.textRGB;
  const mx = Math.max(tr, tg, tb, 1);
  const ink = [tr * 90 / mx, tg * 90 / mx, tb * 90 / mx];
  const tile = [255 - (255 - tr) * 0.07, 255 - (255 - tg) * 0.07, 255 - (255 - tb) * 0.07];
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;               // flatten alpha onto white
    const r = d[i] * a + 255 * (1 - a);
    const g = d[i + 1] * a + 255 * (1 - a);
    const b = d[i + 2] * a + 255 * (1 - a);
    const lum = (r * 299 + g * 587 + b * 114) / 255000;
    const t = Math.min(1, (1 - lum) * 1.55); // darkness → ink amount
    d[i] = tile[0] + (ink[0] - tile[0]) * t;
    d[i + 1] = tile[1] + (ink[1] - tile[1]) * t;
    d[i + 2] = tile[2] + (ink[2] - tile[2]) * t;
    d[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
}

function build(p) {
  overlay = document.createElement("div");
  overlay.id = "donate";
  overlay.innerHTML = `
    <div id="donate-box" role="dialog" aria-modal="true" aria-label="Donate">
      <div id="donate-title">*** FIRESIDE TERMINAL ***</div>
      <div id="donate-msg">PLEASE DONATE</div>
      <button id="donate-close">[ CLOSE ]</button>
    </div>`;

  for (const q of QRS) {
    const card = document.createElement("div");
    card.className = `donate-qr ${q.corner}`;
    const canvas = document.createElement("canvas");
    const label = document.createElement("span");
    label.textContent = q.label;
    card.append(canvas, label);
    overlay.appendChild(card);
    const img = new Image();
    img.onload = () => themeQR(canvas, img, p);
    img.src = q.src;
  }

  document.body.appendChild(overlay);

  // Theme from the current palette. The message burns in a hot color off the
  // heat table (a bright band on every palette, monochrome included).
  const [br, bg, bb] = p.backgroundRGB;
  overlay.style.background = `rgba(${br},${bg},${bb},0.85)`;
  overlay.style.color = p.text;
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
