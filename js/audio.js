// Audio engine facade (main thread). Mirrors SoundEngine: Off / PcSpeaker
// (NES carols) / KillerKard (fire synth). All synthesis runs in the
// fireside-processor AudioWorklet; this side just manages the context and
// relays mode/next-song messages. Songs are handed to the worklet at creation.

import { SONGS } from "./songs.js";

export const Mode = Object.freeze({ Off: "Off", PcSpeaker: "PcSpeaker", KillerKard: "KillerKard" });

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.mode = Mode.Off;
    this.ready = null;
  }

  // Lazily create the AudioContext + worklet on first use (a user gesture, so
  // resume() is always allowed).
  ensureStarted() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      if (!this.ctx.audioWorklet) {
        // Pre-2020 Tizen (Chromium < 66) has no AudioWorklet — run silent
        // rather than crash; the fire itself is unaffected.
        throw new Error("AudioWorklet unsupported on this engine — sound disabled");
      }
      await this.ctx.audioWorklet.addModule("js/audio/fireside-processor.js");
      this.node = new AudioWorkletNode(this.ctx, "fireside-processor", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { songs: SONGS },
      });
      this.node.port.onmessage = (e) => {
        if (e.data && e.data.type === "song") console.log("[NES] Now playing:", e.data.name);
      };
      this.node.connect(this.ctx.destination);
    })();
    return this.ready;
  }

  async setMode(mode) {
    this.mode = mode;
    try {
      await this.ensureStarted();
      if (mode === Mode.Off) {
        this.node.port.postMessage({ type: "mode", mode });
        if (this.ctx.state === "running") await this.ctx.suspend();
      } else {
        if (this.ctx.state !== "running") await this.ctx.resume();
        this.node.port.postMessage({ type: "mode", mode });
      }
    } catch (err) {
      console.error("[Audio] setMode failed:", err);
    }
  }

  nextSong() {
    if (this.node) this.node.port.postMessage({ type: "next" });
  }
}
