# Fireside Terminal

A cozy ASCII fireplace for your screen — a retro terminal-style fire animation with CRT post-processing and NES-style renditions of public-domain Christmas carols.

**Live at [firesideterminal.online](https://firesideterminal.online)** — installable as a PWA (works offline).

## Controls

| Key | Action |
|---|---|
| `N` | PC Speaker (NES carols); press again to skip to the next song |
| `K` | Killer Kard fire-crackle synth |
| `M` | Sound off |
| `P` | Play / pause toggle |
| `C` | Toggle the CRT filter |
| `F` (or double-click) | Toggle fullscreen |
| Arrow keys | Navigate the control panels |

The side panels also work by mouse/touch: oxygen and fuel tweak the fire's shape, the right panel switches color palettes.

## Development

Static site — no build step. Serve the repo root and open it:

```sh
python3 -m http.server 8000
```

Deployed via GitHub Pages from the `master` branch root. When changing any cached file, bump `CACHE` in `sw.js` so installed clients pick up the new version.

## Documents

- [Privacy Policy](PRIVACY.md)
- [Terms of Use](TERMS.md)
