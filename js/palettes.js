// Ported 1:1 from src/Frontend/ColorPalette.cpp.
//
// IMPORTANT: colorForHeat is a STEPPED lookup, not interpolation. buildTable
// walks the ramp and, for heat h, picks the color of the FIRST stop whose
// threshold is > h (falling back to the last stop). This produces the
// characteristic ~11-band fire, so we replicate it exactly.

function rgb(r, g, b) {
  return `rgb(${r},${g},${b})`;
}

// ramp: array of [threshold, [r,g,b]] sorted ascending by threshold.
// Returns a 256-entry array of CSS color strings.
function buildTable(ramp) {
  const table = new Array(256);
  const last = ramp[ramp.length - 1][1];
  for (let h = 0; h < 256; h++) {
    let c = last;
    for (const [threshold, color] of ramp) {
      if (h < threshold) { c = color; break; }
    }
    table[h] = rgb(c[0], c[1], c[2]);
  }
  return table;
}

function makePalette({ name, ramp, text, wood, background = [0, 0, 0], monochrome = false }) {
  return {
    name,
    monochrome,
    text: rgb(text[0], text[1], text[2]),
    textRGB: text,
    wood: rgb(wood[0], wood[1], wood[2]),
    background: rgb(background[0], background[1], background[2]),
    backgroundRGB: background,
    table: buildTable(ramp),
  };
}

// Classic fire ramp shared by DEFAULT and CLASSIC.
const FIRE_RAMP = [
  [20,  [0,   0,   0]],
  [50,  [80,  0,   0]],
  [80,  [139, 0,   0]],
  [110, [200, 30,  0]],
  [140, [255, 69,  0]],
  [170, [255, 120, 0]],
  [195, [255, 165, 0]],
  [220, [255, 200, 0]],
  [240, [255, 235, 0]],
  [250, [255, 255, 100]],
  [256, [255, 255, 255]],
];

// Digital-rain green (user-approved 2026-08-04) — kept OUT of the rotation;
// swap it in for "1978" to go full Matrix. Mirrors makeDigitalRain() native.
export const DIGITAL_RAIN = makePalette({
  name: "DIGITAL RAIN",
  text: [0, 255, 65],
  wood: [0, 140, 60],
  monochrome: true,
  ramp: [
    [20,  [0,   0,   0]],
    [50,  [0,   25,  10]],
    [80,  [0,   55,  25]],
    [110, [0,   90,  35]],
    [140, [0,   180, 55]],
    [170, [0,   255, 65]],
    [195, [110, 255, 140]],
    [220, [180, 255, 200]],
    [240, [225, 255, 235]],
    [250, [245, 255, 248]],
    [256, [255, 255, 255]],
  ],
});

// Order matches the native palette list in main.cpp / the right-panel selector.
export const PALETTES = [
  makePalette({ name: "DEFAULT", ramp: FIRE_RAMP, text: [180, 120, 60], wood: [146, 92, 46] }),
  makePalette({ name: "CLASSIC", ramp: FIRE_RAMP, text: [229, 229, 229], wood: [146, 92, 46] }),
  makePalette({
    name: "B/W",
    text: [229, 229, 229],
    wood: [150, 150, 150],
    monochrome: true,
    ramp: [
      [20,  [0,   0,   0]],
      [50,  [50,  50,  50]],
      [80,  [80,  80,  80]],
      [110, [110, 110, 110]],
      [140, [140, 140, 140]],
      [170, [170, 170, 170]],
      [195, [195, 195, 195]],
      [220, [220, 220, 220]],
      [240, [240, 240, 240]],
      [250, [250, 250, 250]],
      [256, [255, 255, 255]],
    ],
  }),
  makePalette({
    name: "ABYSS",
    text: [45, 190, 175],
    wood: [110, 145, 135],
    ramp: [
      [20,  [0,   0,   0]],
      [50,  [10,  20,  55]],
      [80,  [15,  45,  105]],
      [110, [20,  80,  150]],
      [140, [25,  130, 160]],
      [170, [35,  175, 165]],
      [195, [80,  210, 170]],
      [220, [130, 235, 200]],
      [240, [180, 245, 225]],
      [250, [215, 250, 240]],
      [256, [240, 255, 252]],
    ],
  }),
  makePalette({
    name: "PRISM",
    text: [255, 60, 170],
    wood: [200, 50, 135],
    ramp: [
      [20,  [0,   0,   0]],
      [50,  [80,  0,   140]],
      [80,  [0,   60,  220]],
      [110, [0,   200, 230]],
      [140, [40,  230, 80]],
      [170, [255, 240, 0]],
      [195, [255, 150, 0]],
      [220, [255, 50,  50]],
      [240, [255, 60,  170]],
      [250, [255, 120, 210]],
      [256, [255, 200, 230]],
    ],
  }),
  makePalette({
    name: "ALEJANDRA",
    text: [180, 90, 255],
    wood: [170, 30, 130],
    ramp: [
      [20,  [0,   0,   0]],
      [50,  [20,  0,   40]],
      [80,  [60,  0,   100]],
      [110, [130, 0,   110]],
      [140, [210, 0,   110]],
      [170, [255, 20,  120]],
      [195, [255, 0,   200]],
      [220, [180, 40,  255]],
      [240, [0,   160, 255]],
      [250, [0,   230, 255]],
      [256, [180, 245, 255]],
    ],
  }),
  makePalette({
    name: "1978",   // P1 phosphor / VT100 (released 1978)
    text: [0, 210, 0],
    wood: [0, 140, 0],
    monochrome: true,
    ramp: [
      [20,  [0,   0,   0]],
      [50,  [0,   20,  0]],
      [80,  [0,   60,  0]],
      [110, [0,   105, 0]],
      [140, [0,   155, 0]],
      [170, [0,   210, 0]],
      [195, [10,  245, 5]],
      [220, [30,  255, 20]],
      [240, [90,  255, 65]],
      [250, [160, 255, 135]],
      [256, [215, 255, 200]],
    ],
  }),
  makePalette({
    name: "AMBER",
    text: [255, 160, 0],
    wood: [190, 105, 0],
    monochrome: true,
    ramp: [
      [20,  [0,   0,   0]],
      [50,  [25,  10,  0]],
      [80,  [80,  32,  0]],
      [110, [150, 65,  0]],
      [140, [210, 110, 0]],
      [170, [255, 160, 0]],
      [195, [255, 190, 10]],
      [220, [255, 215, 50]],
      [240, [255, 238, 120]],
      [250, [255, 250, 185]],
      [256, [255, 255, 220]],
    ],
  }),
];
