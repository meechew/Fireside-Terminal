// AudioWorkletProcessor — port of src/Sound/AudioWorker.cpp (fillNes +
// buildGrainBank; fillKillerKard has since been reworked here web-first:
// stereo voices, wandering fire intensity, flare-ups). Self-contained
// (worklets can't import): song data arrives via processorOptions; control
// via port messages.
//
// Output is float [-1,1]. The native scaled to int16 then divided implicitly
// by the DAC; here we clamp to the same effective level.

const TWO_PI = 6.28318530717958647692;
const KREST  = -128;
const W = { PULSE12: 0, PULSE25: 1, PULSE50: 2, TRIANGLE: 3, NOISE: 4 };

const MAX_TRACKS     = 4;
const NUM_GRAINS     = 16;
const CRACKLE_VOICES = 8;

// Tuning constants (Constants.hpp)
const ATTACK_MS = 2, RELEASE_MS = 8;
const NES_AMP = 30000, LP_CUTOFF = 12000;
const LFO_FREQ = 0.07, LFO_DEPTH = 0.18;
const RUMBLE_LEVEL = 0.45, RUMBLE_LFO_FREQ = 0.13, RUMBLE_LFO_DEPTH = 0.45;
// Low chimney-roar resonator; DEEP_LEVEL is its RMS contribution (the
// resonator is impulse-energy normalized at startup).
const DEEP_FREQ = 62, DEEP_R = 0.9955, DEEP_LEVEL = 0.06;
const HISS_LEVEL = 0.02, CRACKLE_LEVEL = 0.75, CLICK_LEVEL = 0.85;

// KillerKard dynamics
const INTENSITY_MIN = 0.35, INTENSITY_MAX = 1.0; // wandering fire-intensity range
const SNAP_PROB     = 0.06;   // chance a pop is a loud snap (spawns after-clatter)
const FLARE_MEAN_S  = 18;     // average seconds between flare-up surges

const rnd = Math.random;            // QRandomGenerator::generateDouble()
const boundedZero = (n) => Math.floor(rnd() * n) === 0; // rng->bounded(n) == 0

class FiresideProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sr = sampleRate; // AudioWorkletGlobalScope global
    this.songs = (options && options.processorOptions && options.processorOptions.songs) || [];
    this.mode = "Off";

    // ---- NES state ----
    this.songIdx = 0;
    this.loopsPlayed = 0;
    this.framesPer16th = 0;
    this.songPos = 0;
    this.songLenFrames = 0;
    this.tracks = Array.from({ length: MAX_TRACKS }, () => this.newTrack());
    this.dcPrevIn = 0; this.dcPrevOut = 0; this.lpPrev = 0;
    this.lpAlpha = 1 - Math.exp(-TWO_PI * LP_CUTOFF / this.sr);
    this.attackFrames = Math.max(1, Math.round(this.sr * ATTACK_MS / 1000));
    this.releaseFrames = Math.max(1, Math.round(this.sr * RELEASE_MS / 1000));

    // ---- KillerKard state ----
    this.brown = 0; this.hiss = 0;
    this.lfoPhase = 0; this.rumbleLfoPhase = 0;
    this.burstPopsRemaining = 0; this.burstNextPopFrame = 0; this.refractoryFrames = 0;
    this.intensity = 0.6; this.intensityTarget = 0.6; this.intensityTimer = 0;
    this.flareEnv = 0; this.flareDecayK = 1;
    this.intensityK = 1 - Math.exp(-1 / (this.sr * 2)); // ~2 s one-pole toward target
    // Deep-rumble resonator (wide 2-pole bandpass around DEEP_FREQ Hz).
    // Normalize by impulse energy so a white [-1,1] input yields RMS
    // DEEP_LEVEL regardless of the pole radius.
    const dOmega = TWO_PI * DEEP_FREQ / this.sr;
    this.deepA1 = 2 * DEEP_R * Math.cos(dOmega); this.deepA2 = DEEP_R * DEEP_R;
    this.deepY1 = 0; this.deepY2 = 0;
    {
      let y1 = 0, y2 = 0, e = 0;
      for (let n = 0; n < this.sr * 4; n++) {
        const x = n === 0 ? 1 - this.deepA2 : 0;
        const y = this.deepA1 * y1 - this.deepA2 * y2 + x;
        y2 = y1; y1 = y; e += y * y;
      }
      this.deepGain = DEEP_LEVEL / Math.sqrt(e / 3);   // uniform white has var 1/3
    }
    this.crackles = Array.from({ length: CRACKLE_VOICES }, () => this.newVoice());
    this.buildGrainBank();

    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  newTrack() {
    return { noteIdx: 0, frameInNote: 0, noteFrames: 0, phase: 0, phaseInc: 0,
             finished: false, lfsr: 1, noisePeriod: 0, noiseTimer: 0 };
  }
  newVoice() {
    return { kind: 0, framesLeft: 0, amp: 0, decayK: 1, grainIdx: 0, grainPos: 0, grainRate: 1,
             bqA1: 0, bqA2: 0, bqY1: 0, bqY2: 0, attackFramesLeft: 0, attackInc: 0,
             flutterY1: 0, flutterY2: 0, flutterK: 0, flutterDepth: 0,
             gl: 0.7071, gr: 0.7071 };
  }

  onMessage(m) {
    if (!m) return;
    if (m.type === "mode") {
      if (this.mode === m.mode) return;
      this.mode = m.mode;
      if (m.mode === "PcSpeaker") this.startNes();
      else if (m.mode === "KillerKard") this.resetKK();
    } else if (m.type === "next") {
      if (this.mode === "PcSpeaker" && this.songs.length) this.advanceSong();
    }
  }

  // ---- NES bookkeeping ----
  startNes() {
    if (!this.songs.length) return;
    this.songIdx = Math.floor(rnd() * this.songs.length);
    this.dcPrevIn = 0; this.dcPrevOut = 0; this.lpPrev = 0;
    this.loadSong();
  }
  loadSong() {
    const s = this.songs[this.songIdx];
    this.framesPer16th = Math.floor(this.sr * 60 / (s.bpm * 4));
    let maxS = 0;
    for (const tk of s.tracks) {
      let c = 0;
      for (const n of tk.notes) c += n[1];
      if (c > maxS) maxS = c;
    }
    this.songLenFrames = maxS * this.framesPer16th;
    this.loopsPlayed = 0;
    this.resetTracks();
    this.port.postMessage({ type: "song", name: s.name });
  }
  resetTracks() {
    this.songPos = 0;
    for (let i = 0; i < MAX_TRACKS; i++) {
      const lf = this.tracks[i].lfsr || 1;
      this.tracks[i] = this.newTrack();
      this.tracks[i].lfsr = lf;
    }
  }
  advanceSong() {
    this.songIdx = (this.songIdx + 1) % this.songs.length;
    this.loadSong();
  }
  resetKK() {
    this.brown = 0; this.hiss = 0;
    this.lfoPhase = 0; this.rumbleLfoPhase = 0;
    this.burstPopsRemaining = 0; this.burstNextPopFrame = 0; this.refractoryFrames = 0;
    this.intensity = 0.6; this.intensityTarget = 0.6; this.intensityTimer = 0;
    this.flareEnv = 0; this.flareDecayK = 1;
    this.deepY1 = 0; this.deepY2 = 0;
    for (const c of this.crackles) c.framesLeft = 0;
  }

  // ---- NES APU fill ----
  fillNes(out, frames) {
    const song = this.songs[this.songIdx];
    if (!song) { out.fill(0); return; }
    const tracks = song.tracks;
    const tcount = Math.min(tracks.length, MAX_TRACKS);
    const sr = this.sr;
    const triLevel = (phase) => { const step = (phase * 32 | 0) & 31; return step < 16 ? 15 - step : step - 16; };

    for (let i = 0; i < frames; i++) {
      let pulse1 = 0, pulse2 = 0, tri = 0, noise = 0, pulseIdx = 0;

      for (let t = 0; t < tcount; t++) {
        const tk = tracks[t];
        const st = this.tracks[t];

        if (!st.finished && st.frameInNote >= st.noteFrames) {
          if (st.noteIdx >= tk.notes.length) {
            st.finished = true;
          } else {
            const n = tk.notes[st.noteIdx++];
            st.noteFrames = n[1] * this.framesPer16th;
            st.frameInNote = 0;
            st.phase = 0;
            if (n[0] === KREST) {
              st.phaseInc = 0; st.noisePeriod = 0;
            } else {
              const freq = 440 * Math.pow(2, n[0] / 12);
              st.phaseInc = freq / sr;
              st.noisePeriod = Math.max(1, Math.floor((sr / freq) / 8));
              st.noiseTimer = st.noisePeriod;
            }
          }
        }

        const active = !st.finished && (tk.wave === W.NOISE ? st.noisePeriod > 0 : st.phaseInc > 0);
        if (active) {
          let gate;
          if (tk.wave === W.NOISE) {
            const frac = st.noteFrames > 0 ? st.frameInNote / st.noteFrames : 1;
            gate = Math.exp(-4 * frac);
          } else {
            const atk = st.frameInNote < this.attackFrames ? st.frameInNote / this.attackFrames : 1;
            let rel = 1;
            if (st.frameInNote > st.noteFrames - this.releaseFrames) {
              rel = (st.noteFrames - st.frameInNote) / this.releaseFrames;
              if (rel < 0) rel = 0;
            }
            gate = Math.min(atk, rel);
            if (tk.decay > 0) {
              const tt = st.frameInNote / sr;
              gate *= Math.exp(-tk.decay * 4 * tt);
            }
          }

          const vol = tk.volume;
          switch (tk.wave) {
            case W.PULSE12:
            case W.PULSE25:
            case W.PULSE50: {
              const duty = tk.wave === W.PULSE12 ? 0.125 : tk.wave === W.PULSE25 ? 0.25 : 0.5;
              const v = (st.phase < duty ? vol : 0) * gate;
              if (pulseIdx++ === 0) pulse1 += v; else pulse2 += v;
              st.phase += st.phaseInc; if (st.phase >= 1) st.phase -= 1;
              break;
            }
            case W.TRIANGLE:
              tri += triLevel(st.phase) * gate;
              st.phase += st.phaseInc; if (st.phase >= 1) st.phase -= 1;
              break;
            case W.NOISE:
              if (--st.noiseTimer <= 0) {
                const fb = (st.lfsr ^ (st.lfsr >> 1)) & 1;
                st.lfsr = ((st.lfsr >> 1) | (fb << 14)) & 0x7fff;
                st.noiseTimer = st.noisePeriod;
              }
              noise += ((st.lfsr & 1) ? vol : 0) * gate;
              break;
          }
        } else if (tk.wave >= W.PULSE12 && tk.wave <= W.PULSE50) {
          pulseIdx++;
        }

        st.frameInNote++;
      }

      // APU nonlinear mixer (Blargg)
      const p = pulse1 + pulse2;
      const pulseOut = p > 0 ? 95.88 / (8128 / p + 100) : 0;
      const tnd = (tri > 0 || noise > 0) ? 159.79 / (1 / (tri / 8227 + noise / 12241) + 100) : 0;
      const mixed = pulseOut + tnd;

      // DC blocker
      const hp = mixed - this.dcPrevIn + 0.995 * this.dcPrevOut;
      this.dcPrevIn = mixed;
      this.dcPrevOut = hp;

      // Output low-pass
      this.lpPrev += this.lpAlpha * (hp - this.lpPrev);

      let s = this.lpPrev * NES_AMP;
      if (s > 32767) s = 32767; else if (s < -32767) s = -32767;
      out[i] = s / 32768;

      if (++this.songPos >= this.songLenFrames) {
        if (++this.loopsPlayed >= song.loops) this.advanceSong();
        else this.resetTracks();
      }
    }
  }

  // ---- KillerKard grain bank ----
  buildGrainBank() {
    const sr = this.sr;
    this.grains = [];
    for (let gi = 0; gi < NUM_GRAINS; gi++) {
      const durMs = 20 + Math.floor(rnd() * 50);
      const frames = Math.floor(sr * durMs / 1000);
      const g = new Float32Array(frames);

      const f1 = 800 + rnd() * 4700;
      const r1 = 0.55 + rnd() * 0.30;
      const a1_1 = 2 * r1 * Math.cos(TWO_PI * f1 / sr), a2_1 = r1 * r1;

      const detune = 1.04 + rnd() * 0.12;
      const f2 = (Math.floor(rnd() * 2) === 0) ? f1 * detune : f1 / detune;
      const r2 = 0.55 + rnd() * 0.30;
      const a1_2 = 2 * r2 * Math.cos(TWO_PI * f2 / sr), a2_2 = r2 * r2;

      const mix2 = 0.25 + rnd() * 0.40;
      const decayK = Math.exp(-6.9 / frames);
      const clickMs = 3 + Math.floor(rnd() * 5);
      const clickFrames = Math.min(frames, Math.floor(sr * clickMs / 1000));

      let y1_1 = 0, y2_1 = 0, y1_2 = 0, y2_2 = 0, env = 1, peak = 0;
      for (let n = 0; n < frames; n++) {
        const w = rnd() * 2 - 1;
        const in1 = w * (1 - a2_1);
        const yn1 = a1_1 * y1_1 - a2_1 * y2_1 + in1; y2_1 = y1_1; y1_1 = yn1;
        const in2 = w * (1 - a2_2);
        const yn2 = a1_2 * y1_2 - a2_2 * y2_2 + in2; y2_2 = y1_2; y1_2 = yn2;
        let s = (yn1 + yn2 * mix2) * env;
        if (n < clickFrames) s += w * env * CLICK_LEVEL;
        g[n] = s;
        const a = Math.abs(s); if (a > peak) peak = a;
        env *= decayK;
      }
      if (peak > 1e-6) { const sc = 1 / peak; for (let n = 0; n < frames; n++) g[n] *= sc; }
      this.grains.push(g);
    }
  }

  // ---- KillerKard fill ----
  // Stereo, intensity-driven fire. A slowly wandering intensity sets how hard
  // the fire burns — pop rate, pop loudness ceiling, rumble, hiss, and sizzle
  // rate all follow it — and rare flare-ups surge it for a few seconds with a
  // whoosh and a flurry of pops. Pops are mostly lone quiet ticks (geometric
  // cluster sizes), with rare loud snaps that clatter briefly afterwards.
  fillKillerKard(outL, outR, frames) {
    const sr = this.sr;
    const lfoInc = TWO_PI * LFO_FREQ / sr;
    const rumbleInc = TWO_PI * RUMBLE_LFO_FREQ / sr;
    const grains = this.grains;
    const voices = this.crackles;

    // Equal-power pan, kept off the extremes so nothing sits hard in one ear.
    const setPan = (c, lo, hi) => {
      const pan = lo + rnd() * (hi - lo);
      c.gl = Math.cos(pan * Math.PI / 2);
      c.gr = Math.sin(pan * Math.PI / 2);
    };

    const spawnPop = (c, eff) => {
      c.kind = 0;
      c.grainIdx = (rnd() * NUM_GRAINS) | 0;
      c.grainRate = 0.6 + rnd() * 1.0;
      c.grainPos = 0;
      const u = rnd();
      c.amp = rnd() < SNAP_PROB ? 0.85 + rnd() * 0.30          // rare sharp crack
                                : 0.10 + u * u * u * (0.50 + 0.35 * eff);
      c.decayK = 1; c.attackFramesLeft = 0; c.attackInc = 0; c.flutterDepth = 0;
      setPan(c, 0.15, 0.85);
      const grainLen = grains[c.grainIdx].length;
      c.framesLeft = Math.floor(grainLen / c.grainRate) + 1;
    };
    const spawnSizzle = (c, eff) => {
      c.kind = 1;
      const durMs = 80 + Math.floor(rnd() * 220);
      c.framesLeft = Math.floor(sr * durMs / 1000);
      c.amp = (0.18 + rnd() * 0.30) * (0.70 + 0.50 * eff);
      c.decayK = Math.exp(-6.9 / c.framesLeft);
      c.attackFramesLeft = 0; c.attackInc = 0;
      setPan(c, 0.25, 0.75);
      const f = 1000 + rnd() * 3000, omega = TWO_PI * f / sr, r = 0.75 + rnd() * 0.10;
      c.bqA1 = 2 * r * Math.cos(omega); c.bqA2 = r * r; c.bqY1 = 0; c.bqY2 = 0;
      const fF = 60 + rnd() * 140, oF = TWO_PI * fF / sr;
      c.flutterK = 2 * Math.cos(oF); c.flutterY1 = 0; c.flutterY2 = -Math.sin(oF);
      c.flutterDepth = 0.30 + rnd() * 0.30;
    };
    const spawnWhoosh = (c) => {
      c.kind = 2;
      const durMs = 400 + Math.floor(rnd() * 400);
      c.framesLeft = Math.floor(sr * durMs / 1000);
      const peak = 0.18 + rnd() * 0.20;
      c.amp = 0;
      c.decayK = Math.exp(-6.9 / c.framesLeft);
      c.flutterDepth = 0;
      setPan(c, 0.35, 0.65);
      const attackMs = 30 + Math.floor(rnd() * 50);
      c.attackFramesLeft = Math.floor(sr * attackMs / 1000);
      c.attackInc = peak / c.attackFramesLeft;
      const f = 200 + rnd() * 500, omega = TWO_PI * f / sr, r = 0.75 + rnd() * 0.10;
      c.bqA1 = 2 * r * Math.cos(omega); c.bqA2 = r * r; c.bqY1 = 0; c.bqY2 = 0;
    };
    const findFree = () => { for (const c of voices) if (c.framesLeft <= 0) return c; return null; };

    for (let i = 0; i < frames; i++) {
      const white = rnd() * 2 - 1;

      this.brown = Math.max(-0.5, Math.min(0.5, (this.brown + 0.02 * white) * 0.999));
      this.hiss = this.hiss * 0.4 + white * 0.6;

      // Fire intensity — wanders between embers and full blaze on a ~4–14 s
      // timescale, plus a decaying flare-up envelope on top.
      if (--this.intensityTimer <= 0) {
        this.intensityTarget = INTENSITY_MIN + rnd() * (INTENSITY_MAX - INTENSITY_MIN);
        this.intensityTimer = (sr * (4 + rnd() * 10)) | 0;
      }
      this.intensity += (this.intensityTarget - this.intensity) * this.intensityK;
      if (this.flareEnv > 0.001) this.flareEnv *= this.flareDecayK; else this.flareEnv = 0;
      if (this.flareEnv < 0.05 && boundedZero(sr * FLARE_MEAN_S)) {
        this.flareEnv = 0.35 + rnd() * 0.25;
        this.flareDecayK = Math.exp(-1 / (sr * (1.2 + rnd() * 1.6)));   // 1.2–2.8 s tail
        const w = findFree(); if (w) spawnWhoosh(w);
        this.burstPopsRemaining += 2 + ((rnd() * 3) | 0);               // flurry rides the surge
        if (this.burstNextPopFrame <= 0) this.burstNextPopFrame = 1;
      }
      const eff = Math.min(1.25, this.intensity + this.flareEnv);

      const rLfo = Math.sin(this.rumbleLfoPhase);
      this.rumbleLfoPhase += rumbleInc; if (this.rumbleLfoPhase >= TWO_PI) this.rumbleLfoPhase -= TWO_PI;
      const rumbleGain = (1 + RUMBLE_LFO_DEPTH * rLfo) * (0.70 + 0.55 * eff);

      // Deep chimney roar — white noise through the ~60 Hz resonator, riding
      // the same slow rumble LFO so the low end swells and recedes.
      const dY = this.deepA1 * this.deepY1 - this.deepA2 * this.deepY2
               + white * (1 - this.deepA2);
      this.deepY2 = this.deepY1; this.deepY1 = dY;

      const noiseFloor = this.brown * RUMBLE_LEVEL * rumbleGain
                       + dY * this.deepGain * rumbleGain
                       + this.hiss * HISS_LEVEL * (0.60 + 0.80 * eff);

      // Pop scheduler — singles dominate; the trigger rate follows intensity.
      if (this.burstPopsRemaining > 0) {
        if (--this.burstNextPopFrame <= 0) {
          const c = findFree(); if (c) spawnPop(c, eff);
          if (--this.burstPopsRemaining > 0)
            this.burstNextPopFrame = (sr * (0.015 + rnd() * 0.095)) | 0;
        }
      } else if (this.refractoryFrames > 0) {
        this.refractoryFrames--;
      } else if (boundedZero((sr / (0.8 + 3.4 * eff)) | 0)) {
        let n = 1;
        while (n < 5 && rnd() < 0.35) n++;                    // geometric cluster size
        const c = findFree();
        if (c) {
          spawnPop(c, eff);
          if (c.amp > 0.8 && n < 3) n = 3;                    // snaps clatter afterwards
        }
        this.burstPopsRemaining = n - 1;
        this.burstNextPopFrame = (sr * (0.015 + rnd() * 0.095)) | 0;
        // Quiet embers leave long gaps between pops; a blaze barely pauses.
        this.refractoryFrames = (sr * (0.05 + rnd() * 0.30) * (1.7 - eff)) | 0;
      }

      if (boundedZero((sr / (0.5 + 1.3 * eff)) | 0)) { const c = findFree(); if (c) spawnSizzle(c, eff); }
      if (boundedZero(sr * 12)) { const c = findFree(); if (c) spawnWhoosh(c); }

      let crackleL = 0, crackleR = 0;
      for (const c of voices) {
        if (c.framesLeft <= 0) continue;
        let voice;
        if (c.kind === 0) {
          const g = grains[c.grainIdx];
          const idx = c.grainPos | 0;
          const last = g.length - 1;
          if (idx >= last) { c.framesLeft = 0; continue; }
          const frac = c.grainPos - idx;
          voice = (g[idx] + (g[idx + 1] - g[idx]) * frac) * c.amp;
          c.grainPos += c.grainRate;
        } else {
          const cwhite = rnd() * 2 - 1;
          const input = cwhite * (1 - c.bqA2);
          const y = c.bqA1 * c.bqY1 - c.bqA2 * c.bqY2 + input;
          c.bqY2 = c.bqY1; c.bqY1 = y;
          voice = y * c.amp;
          if (c.flutterDepth > 0) {
            const lfo = c.flutterK * c.flutterY1 - c.flutterY2;
            c.flutterY2 = c.flutterY1; c.flutterY1 = lfo;
            voice *= 1 + c.flutterDepth * lfo;
          }
        }
        crackleL += voice * c.gl;
        crackleR += voice * c.gr;
        if (c.attackFramesLeft > 0) { c.amp += c.attackInc; c.attackFramesLeft--; }
        else { c.amp *= c.decayK; }
        c.framesLeft--;
      }

      const lfo = Math.sin(this.lfoPhase);
      this.lfoPhase += lfoInc; if (this.lfoPhase >= TWO_PI) this.lfoPhase -= TWO_PI;
      const breathe = 1 + LFO_DEPTH * lfo;

      let sL = (noiseFloor + crackleL * CRACKLE_LEVEL) * breathe;
      let sR = (noiseFloor + crackleR * CRACKLE_LEVEL) * breathe;
      if (sL > 1) sL = 1; else if (sL < -1) sL = -1;
      if (sR > 1) sR = 1; else if (sR < -1) sR = -1;
      outL[i] = sL;
      outR[i] = sR;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || !out.length) return true;
    const ch0 = out[0];
    const frames = ch0.length;

    if (this.mode === "KillerKard") {
      if (out.length > 1) {
        this.fillKillerKard(ch0, out[1], frames);
        for (let c = 2; c < out.length; c++) out[c].set(ch0);
      } else {
        // Mono sink: render stereo into a scratch right channel and downmix.
        if (!this.kkMono || this.kkMono.length < frames) this.kkMono = new Float32Array(frames);
        this.fillKillerKard(ch0, this.kkMono, frames);
        for (let i = 0; i < frames; i++) ch0[i] = (ch0[i] + this.kkMono[i]) * 0.5;
      }
      return true;
    }

    if (this.mode === "PcSpeaker") this.fillNes(ch0, frames);
    else ch0.fill(0);

    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true;
  }
}

registerProcessor("fireside-processor", FiresideProcessor);
