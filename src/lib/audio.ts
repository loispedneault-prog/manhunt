// All sounds are synthesized (no files to load) and voice clips are WAV so iPhone and Android both play them.

let ctx: AudioContext | null = null

function setSession(type: 'playback' | 'play-and-record') {
  try {
    const s = (navigator as any).audioSession
    if (s) s.type = type // iOS 17+: ignore the silent switch for playback
  } catch {
    /* not supported */
  }
}

export function audioCtx(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext
    ctx = new AC()
  }
  return ctx
}

/** Must run inside a user gesture once (iOS/Android autoplay rules). */
export function unlockAudio() {
  setSession('playback')
  const c = audioCtx()
  if (c.state !== 'running') c.resume().catch(() => {})
  const b = c.createBuffer(1, 1, 22050)
  const s = c.createBufferSource()
  s.buffer = b
  s.connect(c.destination)
  s.start(0)
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, endFreq?: number) {
  const c = audioCtx()
  if (c.state !== 'running') return
  const t = c.currentTime + start
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(c.destination)
  o.start(t)
  o.stop(t + dur + 0.05)
}

export const sfx = {
  ping() {
    tone(90, 0, 0.6, 'sine', 0.6, 40)
    tone(1400, 0.05, 0.25, 'square', 0.08)
    tone(1400, 0.35, 0.25, 'square', 0.06)
  },
  heartbeat() {
    tone(60, 0, 0.18, 'sine', 0.7, 40)
    tone(55, 0.22, 0.2, 'sine', 0.5, 35)
  },
  siren() {
    tone(700, 0, 0.45, 'sawtooth', 0.12, 1100)
    tone(1100, 0.45, 0.45, 'sawtooth', 0.12, 700)
  },
  alarm() {
    for (let i = 0; i < 6; i++) tone(i % 2 ? 880 : 660, i * 0.22, 0.2, 'square', 0.2)
  },
  capture() {
    tone(200, 0, 0.5, 'sawtooth', 0.25, 50)
    tone(120, 0.1, 0.6, 'square', 0.15, 40)
  },
  good() {
    tone(520, 0, 0.12, 'square', 0.12)
    tone(780, 0.12, 0.2, 'square', 0.12)
  },
  click() {
    tone(1200, 0, 0.04, 'square', 0.05)
  },
  radio() {
    tone(1800, 0, 0.06, 'square', 0.06)
    tone(1200, 0.07, 0.06, 'square', 0.06)
  },
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* iOS has no vibration API */
  }
}

// ---------- Walkie-talkie recording (PCM -> 16 kHz WAV) ----------

const RATE = 16000

export interface Recording {
  stop(): Promise<{ blob: Blob; durationMs: number } | null>
  cancel(): void
}

export async function startRecording(): Promise<Recording> {
  setSession('play-and-record')
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  })
  const c = audioCtx()
  if (c.state !== 'running') await c.resume().catch(() => {})
  const src = c.createMediaStreamSource(stream)
  const proc = c.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  const startedAt = performance.now()
  proc.onaudioprocess = e => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
  }
  // Output through a muted gain so the processor runs without echoing the mic.
  const mute = c.createGain()
  mute.gain.value = 0
  src.connect(proc)
  proc.connect(mute).connect(c.destination)

  const cleanup = () => {
    try {
      proc.disconnect()
      src.disconnect()
      mute.disconnect()
    } catch {
      /* already disconnected */
    }
    stream.getTracks().forEach(t => t.stop())
    setSession('playback')
  }

  return {
    async stop() {
      await new Promise(r => setTimeout(r, 150)) // keep the tail of the last word
      cleanup()
      const durationMs = performance.now() - startedAt
      if (durationMs < 400 || !chunks.length) return null
      return { blob: encodeWav(chunks, c.sampleRate), durationMs }
    },
    cancel: cleanup,
  }
}

function encodeWav(chunks: Float32Array[], inRate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const merged = new Float32Array(total)
  let o = 0
  for (const c of chunks) {
    merged.set(c, o)
    o += c.length
  }
  const ratio = inRate / RATE
  const outLen = Math.floor(merged.length / ratio)
  const pcm = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    // average the source samples covered by this output sample (cheap low-pass)
    const a = Math.floor(i * ratio)
    const b = Math.min(merged.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = a; j < b; j++) sum += merged[j]
    const v = Math.max(-1, Math.min(1, (sum / Math.max(1, b - a)) * 1.6))
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2)
  const dv = new DataView(buf)
  const w = (off: number, s: string) => [...s].forEach((ch, i) => dv.setUint8(off + i, ch.charCodeAt(0)))
  w(0, 'RIFF')
  dv.setUint32(4, 36 + pcm.length * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, RATE, true)
  dv.setUint32(28, RATE * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  w(36, 'data')
  dv.setUint32(40, pcm.length * 2, true)
  new Int16Array(buf, 44).set(pcm)
  return new Blob([buf], { type: 'audio/wav' })
}

// ---------- Playback queue ----------

const queue: string[] = []
let playing = false

export function playVoice(url: string) {
  queue.push(url)
  if (!playing) void drain()
}

async function drain() {
  playing = true
  while (queue.length) {
    const url = queue.shift()!
    try {
      const res = await fetch(url)
      const data = await res.arrayBuffer()
      const c = audioCtx()
      if (c.state !== 'running') await c.resume().catch(() => {})
      const buf = await c.decodeAudioData(data)
      sfx.radio()
      await new Promise<void>(resolve => {
        const s = c.createBufferSource()
        const g = c.createGain()
        g.gain.value = 1.4
        s.buffer = buf
        s.connect(g).connect(c.destination)
        s.onended = () => resolve()
        s.start(c.currentTime + 0.15)
        setTimeout(resolve, buf.duration * 1000 + 1500) // never block the queue
      })
    } catch (e) {
      console.error('voice', e)
    }
  }
  playing = false
}
