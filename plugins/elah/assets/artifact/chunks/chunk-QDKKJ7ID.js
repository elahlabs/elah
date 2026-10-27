import{a as o}from"./chunk-CRWIVIKN.js";var c=`
const N = ${512}
const H = ${128}
const BINS = N / 2 + 1
const ZERO = new Float32Array(H)
const WARMUP_FRAMES = 40

class SpectralDenoiser {
  constructor(amount, rate) {
    this.amount = Math.min(1, Math.max(0, amount))
    this.alpha = 1 + 3 * this.amount
    this.floor = Math.pow(10, -(6 + 14 * this.amount) / 20)
    this.rise = Math.pow(10, 3 / 10 / (rate / H))
    this.win = new Float32Array(N)
    for (let i = 0; i < N; i++) this.win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
    this.cos = new Float32Array(N / 2)
    this.sin = new Float32Array(N / 2)
    for (let i = 0; i < N / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / N)
      this.sin[i] = Math.sin((2 * Math.PI * i) / N)
    }
    this.rev = new Uint16Array(N)
    const bits = Math.round(Math.log2(N))
    for (let i = 0; i < N; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
    this.re = new Float32Array(N)
    this.im = new Float32Array(N)
    this.channels = []
  }

  state(c) {
    let s = this.channels[c]
    if (!s) {
      s = {
        input: new Float32Array(N),
        out: new Float32Array(N),
        smooth: new Float32Array(BINS),
        noise: new Float32Array(BINS),
        gain: new Float32Array(BINS).fill(1),
        frames: 0,
      }
      this.channels[c] = s
    }
    return s
  }

  fft(re, im, inverse) {
    const rev = this.rev
    for (let i = 0; i < N; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t
        t = im[i]; im[i] = im[j]; im[j] = t
      }
    }
    const sign = inverse ? 1 : -1
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1
      const step = N / size
      for (let start = 0; start < N; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step]
          const wi = sign * this.sin[k * step]
          const a = start + k
          const b = a + half
          const xr = re[b] * wr - im[b] * wi
          const xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
        }
      }
    }
  }

  processBlock(c, input, output) {
    const s = this.state(c)
    const re = this.re
    const im = this.im
    const win = this.win
    s.input.copyWithin(0, H)
    s.input.set(input, N - H)
    for (let i = 0; i < N; i++) {
      re[i] = s.input[i] * win[i]
      im[i] = 0
    }
    this.fft(re, im, false)
    if (this.amount > 0) {
      for (let k = 0; k < BINS; k++) {
        const p = re[k] * re[k] + im[k] * im[k]
        const sm = s.frames === 0 ? p : 0.8 * s.smooth[k] + 0.2 * p
        s.smooth[k] = sm
        // Noise floor: follows much quieter frames down quickly, averages
        // frames that look like noise, and only creeps up under louder
        // (speech) frames.
        let n = s.noise[k]
        // The first frames hold the zeros the analysis buffer started with;
        // the floor is seeded once it is full, then learnt fast for ~0.1 s.
        if (s.frames < N / H) n = sm
        else if (s.frames < WARMUP_FRAMES) n = 0.9 * n + 0.1 * sm
        else if (sm < 0.5 * n) n = 0.9 * n + 0.1 * sm
        else if (sm < 4 * n) n = 0.97 * n + 0.03 * sm
        else n *= this.rise
        s.noise[k] = n
        let g = sm > 0 ? 1 - (this.alpha * n) / sm : 1
        if (g < this.floor) g = this.floor
        if (g > 1) g = 1
        const prev = s.gain[k]
        g = g > prev ? 0.5 * prev + 0.5 * g : 0.8 * prev + 0.2 * g
        s.gain[k] = g
        re[k] *= g
        im[k] *= g
        if (k > 0 && k < N / 2) {
          re[N - k] *= g
          im[N - k] *= g
        }
      }
    }
    this.fft(re, im, true)
    const out = s.out
    for (let i = 0; i < N; i++) out[i] += (re[i] / N) * win[i] * 0.5
    output.set(out.subarray(0, H))
    out.copyWithin(0, H)
    out.fill(0, N - H)
    s.frames++
  }
}

class ElahDenoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const amount = options && options.processorOptions ? options.processorOptions.amount : 0.5
    this.denoiser = new SpectralDenoiser(typeof amount === 'number' ? amount : 0.5, sampleRate)
    this.idle = 0
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!output) return true
    const live = input && input.length > 0
    this.idle = live ? 0 : this.idle + 1
    for (let c = 0; c < output.length; c++) {
      const src = live ? input[c] || input[0] : ZERO
      if (src.length === H) this.denoiser.processBlock(c, src, output[c])
      else output[c].set(src.subarray(0, output[c].length))
    }
    // Keep running while connected, then long enough to flush the tail.
    return this.idle <= N / H
  }
}

registerProcessor('${o}', ElahDenoiseProcessor)
`,r=new WeakMap;function p(e){let t=r.get(e);if(t)return t;let s=e.audioWorklet;if(!s||typeof URL>"u"||typeof Blob>"u")t=Promise.resolve(!1);else{let i=URL.createObjectURL(new Blob([c],{type:"application/javascript"}));t=s.addModule(i).then(()=>!0,n=>(console.warn("[audio] noise reduction is unavailable:",n),!1)).finally(()=>URL.revokeObjectURL(i))}return r.set(e,t),t}export{p as a};
