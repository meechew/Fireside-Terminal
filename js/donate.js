// Donation pop-up, shown on exit intent. Browsers refuse to render custom UI
// inside the real close/beforeunload dialog, so the standard approximation is
// exit *intent*: the pointer leaving through the top of the viewport, headed
// for the tab strip / close button. Shown at most once per page load.
//
// Colors follow the active palette (same convention as the side panels:
// button bg = palette text color, button text = palette background). The six
// donation QR codes ring the box — PayPal TL, Venmo top-center, Bitcoin TR,
// Ripple BL, Square bottom-center, Ethereum BR — re-tinted at show time:
// modules in the PLEASE DONATE hot color on a black tile.
//
// Preview while styling: open the page with ?donate=1.

let shown = false;
let overlay = null;

const QRS = [
  { src: "qr/paypal.png", label: "PAYPAL", corner: "tl" },
  { src: "qr/venmo.png", label: "VENMO", corner: "tc" },
  { src: "qr/btc.png", label: "BITCOIN", corner: "tr" },
  { src: "qr/xrp.png", label: "RIPPLE", corner: "bl" },
  // keepGreen: the Colorful River wordmark in its center stays Pine Static
  // #22E893 instead of being palette-tinted (center region only — the green
  // finder centers tint like everything else).
  { src: "qr/square.png", label: "SQUARE", corner: "bc", keepGreen: true },
  { src: "qr/eth.png", label: "ETHEREUM", corner: "br" },
];

// Repaint a QR image onto a black tile with the modules in the same hot
// palette color as the PLEASE DONATE message (p.table[215] — a bright band
// on every palette, monochrome included). Inverted-contrast QRs scan fine on
// modern phone cameras.
function themeQR(canvas, img, p, keepGreen) {
  const w = img.width, h = img.height;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(p.table[215]);
  const ink = m ? [+m[1], +m[2], +m[3]] : [255, 160, 0];
  for (let i = 0, px = 0; i < d.length; i += 4, px++) {
    const x = px % w, y = (px / w) | 0;
    const a = d[i + 3] / 255;               // flatten alpha onto white
    const r = d[i] * a + 255 * (1 - a);
    const g = d[i + 1] * a + 255 * (1 - a);
    const b = d[i + 2] * a + 255 * (1 - a);
    // brand-green passthrough (Square's Colorful River wordmark): green
    // reads fine on the black tile, so leave it untinted rather than
    // flattening it into a mid-brightness ink blob. Center region only —
    // the finder centers are the same green in the source but must tint
    // with the rest of the code.
    const central = Math.abs(x - w / 2) < w * 0.14 && Math.abs(y - h / 2) < h * 0.14;
    if (keepGreen && central && g > r + 60 && g > b + 35) {
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      continue;
    }
    const lum = (r * 299 + g * 587 + b * 114) / 255000;
    const t = Math.min(1, (1 - lum) * 1.55); // darkness → ink amount
    d[i] = ink[0] * t;
    d[i + 1] = ink[1] * t;
    d[i + 2] = ink[2] * t;
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
    img.onload = () => themeQR(canvas, img, p, q.keepGreen);
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
