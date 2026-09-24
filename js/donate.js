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
// Every card is also a CONTROL, not just a picture of one. A QR code is
// unscannable on the screen you are holding, so on a phone the codes were
// decoration; now the card carries the same payload the code does:
//
//   PayPal / Venmo / Square  an <a> to the payment page, new tab so the fire
//                            keeps burning behind it.
//   BTC / XRP / ETH          a <button> that COPIES the address, then tries
//                            the wallet URI. Copy first and unconditionally,
//                            because an unregistered scheme is a silent
//                            no-op and the clipboard is then the only thing
//                            the user is left holding. The "COPIED" flash is
//                            therefore seen only by whoever was NOT handed
//                            off to a wallet app -- which is exactly who
//                            needs to be told something happened.
//
// The desktop QR still works: the code is inside the link, so you can scan
// it with a second device or click it with the one you are on.
//
// On the COMPACT layout (the same media query css/style.css uses to flow the
// cards into a grid under the box — phones, and short windows) the cards
// show the payment SYMBOL instead of the code (user decision 2026-09-23): a
// QR code on the screen you are holding is a picture of a control you
// cannot use, and six of them at 110 px are a wall of noise over a fire. The
// symbols are the very center marks render-donation-qr.mjs stamps into the
// codes (qr/logo-*.png), drawn in the palette's hot color off their alpha —
// so the compact grid is the codes with everything but their hearts removed.
// Two of them are TWO-TONE (user decision 2026-09-23): PayPal's two blues and
// Ethereum's two facet grays print as full ink and half ink, so the marks
// keep their shape instead of flattening into a blob. Square's symbol is the
// Colorful River mark itself (qr/logo-square.png, rendered from the brand's
// mark-noscan.svg as a brightness mask), since Square's payment page is
// Colorful River's own — the same reason the Square code's center carries
// the wordmark rather than Square's logo.
//
// URL hooks: ?donate=1 forces the pop-up open (preview while styling);
// ?nonag=1 suppresses it entirely. If both are given, nonag wins. Parameter
// only — deliberately no localStorage, so a shared link can carry the
// suppression without silently persisting it on the visitor's device
// (PLAN-1.1.0.md feature 8).

let shown = false;
let overlay = null;

// !! The href/address values below are the SAME payloads that are encoded
// !! into the QR art, and they live in two places: here, and the CODES table
// !! in scripts/render-donation-qr.mjs which bakes the .png files. Change one
// !! without the other and the card's link quietly sends money somewhere the
// !! printed code does not -- the kind of bug no render and no screenshot can
// !! show you. Change them together, then re-run that script.
const QRS = [
  { src: "qr/paypal.png", logo: "qr/logo-paypal.png", twoTone: true, label: "PAYPAL", corner: "tl",
    href: "https://www.paypal.com/qrcodes/managed/5b446fc1-5b9f-4deb-a914-06ea00cfd78f?utm_source=payandgetpaid" },
  { src: "qr/venmo.png", logo: "qr/logo-venmo.png", label: "VENMO", corner: "tc",
    href: "https://www.paypal.com/qrcodes/venmocs/a89e5a64-2567-49c5-97c9-9329b4074170?created=1788025730" },
  { src: "qr/btc.png", logo: "qr/logo-btc.png", label: "BITCOIN", corner: "tr",
    address: "bc1q844jg2hfww6qvmrfjs2sxxmx9lngfmgfmwgzr4",
    uri: "bitcoin:bc1q844jg2hfww6qvmrfjs2sxxmx9lngfmgfmwgzr4" },       // BIP-21, widely handled
  { src: "qr/xrp.png", logo: "qr/logo-xrp.png", label: "RIPPLE", corner: "bl",
    address: "r3omv4BfWA22Zpd7f68rgAB4vhx5fRpoNW",
    // XRP has no scheme with anything like BIP-21's reach; `ripple:` is the
    // historical one and several wallets still claim it. Attempting it costs
    // nothing when nothing answers, and the copy has already happened.
    uri: "ripple:r3omv4BfWA22Zpd7f68rgAB4vhx5fRpoNW" },
  // keepGreen: the Colorful River wordmark in its center stays Pine Static
  // #22E893 instead of being palette-tinted (center region only — the green
  // finder centers tint like everything else).
  // fit: the badge is round and carries its own margin, so it fills the tile
  // where a bare glyph sits inside 70% of it.
  { src: "qr/square.png", logo: "qr/logo-square.png", fit: 0.96, label: "SQUARE", corner: "bc", keepGreen: true,
    href: "https://square.link/u/93jpZrrb?src=webqr" },
  { src: "qr/eth.png", logo: "qr/logo-eth.png", twoTone: true, label: "ETHEREUM", corner: "br",
    address: "0x97B41A5F7F614a304Dc4E8a43fff4cBb0f5332E8",
    uri: "ethereum:0x97B41A5F7F614a304Dc4E8a43fff4cBb0f5332E8" },      // EIP-681
];

// navigator.clipboard needs a secure context, which a LAN http:// preview is
// not, so keep the execCommand path: this is the one action in the pop-up
// that has to work or the crypto cards are worthless.
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (err) {
    return false;
  }
}

// One flash at a time: hide the previous card's before claiming the timer,
// or clearTimeout strands it visible forever.
let flashEl = null;
let flashTimer = null;
function flash(el, text) {
  clearTimeout(flashTimer);
  if (flashEl && flashEl !== el) flashEl.style.visibility = "hidden";
  flashEl = el;
  el.textContent = text;
  el.style.visibility = "visible";
  flashTimer = setTimeout(() => { el.style.visibility = "hidden"; }, 2500);
}

async function copyAddress(q, el) {
  const ok = await copyText(q.address);
  // Copy failed (no clipboard at all): put the address on screen so it can
  // still be read off by hand rather than leaving a dead button.
  flash(el, ok ? "COPIED" : q.address);
  if (q.uri) location.href = q.uri;
}

// Repaint a QR image onto a black tile with the modules in the same hot
// palette color as the PLEASE DONATE message (`p.hot` — each theme's declared
// alert color, bright on every palette, monochrome included). Inverted-
// contrast QRs scan fine on modern phone cameras.
function themeQR(canvas, img, p, keepGreen) {
  const w = img.width, h = img.height;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  const ink = p.hotRGB;
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

// The compact layout, exactly as css/style.css's @media flows the cards into
// a grid: the two have to agree or a card gets a symbol in a corner slot
// sized for a code. Read at build time, like the palette.
const COMPACT = "(max-width: 800px), (max-height: 560px)";
const SYMBOL_PX = 128;   // the symbol tile; CSS scales it like the code canvas

// Paint a center-mark PNG as a symbol in the palette's hot color on a
// transparent tile — no black square behind it, so the grid reads as six
// marks on the fire, not six tiles. Fitted into 70% of the tile whatever the
// source's aspect (PayPal is tall, Venmo's V short).
//
// The ink is the source's alpha MINUS its white: the Bitcoin and Ripple marks
// are dark coins with the glyph knocked out in white, so an alpha-only mask
// would print two solid discs. White (and near-white) pixels become holes,
// which is what they were on the coin; everything else that is opaque is
// ink, however it was colored. With `twoTone`, the ink splits at mid-gray:
// the darker tone prints full, the lighter at TONE_LIGHT — PayPal's navy P
// over its sky-blue one, Ethereum's dark facets against its light ones.
// A source that is already a black-with-alpha mask (the Colorful River mark)
// passes straight through: black is solid, and its alpha is the picture.
const TONE_SPLIT = 0.40;
const TONE_LIGHT = 0.50;
function themeLogo(canvas, img, p, twoTone, fit) {
  canvas.width = SYMBOL_PX;
  canvas.height = SYMBOL_PX;
  const ctx = canvas.getContext("2d");
  const box = SYMBOL_PX * (fit || 0.70);
  const k = Math.min(box / img.width, box / img.height);
  const w = img.width * k, h = img.height * k;
  ctx.clearRect(0, 0, SYMBOL_PX, SYMBOL_PX);
  ctx.drawImage(img, (SYMBOL_PX - w) / 2, (SYMBOL_PX - h) / 2, w, h);
  const id = ctx.getImageData(0, 0, SYMBOL_PX, SYMBOL_PX);
  const d = id.data;
  const ink = p.hotRGB;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    const lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 255000;
    // 1 for anything darker than ~80% gray, fading to 0 at white.
    let solid = Math.min(1, Math.max(0, (0.92 - lum) / 0.12));
    if (twoTone && lum > TONE_SPLIT) solid *= TONE_LIGHT;
    d[i] = ink[0];
    d[i + 1] = ink[1];
    d[i + 2] = ink[2];
    d[i + 3] = Math.round(255 * a * solid);
  }
  ctx.putImageData(id, 0, 0);
}

function build(p) {
  const compact = window.matchMedia(COMPACT).matches;
  overlay = document.createElement("div");
  overlay.classList.toggle("compact", compact);
  overlay.id = "donate";
  overlay.innerHTML = `
    <div id="donate-box" role="dialog" aria-modal="true" aria-label="Donate">
      <div id="donate-title">*** FIRESIDE TERMINAL ***</div>
      <div id="donate-msg">PLEASE DONATE</div>
      <button id="donate-close">[ CLOSE ]</button>
    </div>`;

  for (const q of QRS) {
    // <a> for a destination, <button> for an action -- the semantics have to
    // match what the tap does, or the keyboard and screen readers get it
    // wrong however the thing is styled.
    const card = document.createElement(q.href ? "a" : "button");
    card.className = `donate-qr ${q.corner}`;
    if (q.href) {
      card.href = q.href;
      card.target = "_blank";
      card.rel = "noopener noreferrer";   // never hand the opener to a payment page
      card.setAttribute("aria-label", `Donate with ${q.label}`);
    } else {
      card.type = "button";
      card.setAttribute("aria-label", `Copy ${q.label} address`);
    }
    const canvas = document.createElement("canvas");
    const label = document.createElement("span");
    label.textContent = q.label;
    const note = document.createElement("span");
    note.className = "donate-flash";
    note.style.color = p.hot;
    note.style.visibility = "hidden";
    card.append(canvas, label, note);
    if (!q.href) card.onclick = () => copyAddress(q, note);
    overlay.appendChild(card);
    const img = new Image();
    img.onload = () => (compact ? themeLogo(canvas, img, p, q.twoTone, q.fit)
                                : themeQR(canvas, img, p, q.keepGreen));
    img.src = compact ? q.logo : q.src;
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
  overlay.querySelector("#donate-msg").style.color = p.hot;
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
  const params = new URLSearchParams(location.search);

  // Opt out entirely. Checked before anything is wired up, so no listener is
  // registered at all — and it beats ?donate=1 when both are present.
  if (params.has("nonag")) return () => {};

  // `force` is a deliberate request (the HUD's DONATE HERE!), which is not
  // the same event as the automatic nag: the once-per-load guard exists so
  // exit intent cannot pester, and it must not also stop someone who is
  // asking for the thing on purpose.
  const show = (force) => {
    if (overlay && document.body.contains(overlay)) return;
    if (shown && !force) return;
    shown = true;
    build(getPalette());
  };

  // Pointer leaves the viewport through the top edge with no element taking
  // over (relatedTarget null) — classic exit-intent signal. Never fires on a
  // touch device; that is what the HUD affordance is for (js/main.js).
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget && e.clientY <= 0) show();
  });

  if (params.has("donate")) show();
  return () => show(true);
}
