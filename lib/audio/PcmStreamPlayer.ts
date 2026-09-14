import { AudioContext, type AudioBufferQueueSourceNode } from 'react-native-audio-api'

/** Held back before starting, so a slow first packet does not stutter the opening word. */
const PREBUFFER_SECONDS = 0.3
/** Network chunks are merged up to this length to keep calls into native code infrequent. */
const BATCH_SECONDS = 0.1

const toSample = (low: number, high: number) => {
    const value = low | (high << 8)
    return (value >= 0x8000 ? value - 0x10000 : value) / 32768
}

/**
 * Plays mono PCM16 while a streaming TTS response is still arriving.
 *
 * Every batch goes onto one queue source node. Creating a source node per network
 * chunk floods the bridge on Android and crashes playback after a few seconds.
 * If the queue runs dry mid-stream the node plays silence and resumes when more
 * audio is enqueued, so a slow network causes a gap rather than an early stop.
 */
export class PcmStreamPlayer {
    readonly done: Promise<void>

    private readonly context: AudioContext
    private readonly source: AudioBufferQueueSourceNode
    private readonly sampleRate: number
    private readonly batchSamples: number
    private readonly prebufferSamples: number
    private pending: Float32Array
    private pendingLength = 0
    /** A 16-bit sample can be split across two network chunks. */
    private carry: number | null = null
    private queued = 0
    private queuedSamples = 0
    private started = false
    private ended = false
    private finished = false
    private resolveDone: () => void = () => {}

    constructor(sampleRate: number, playbackRate = 1) {
        this.sampleRate = sampleRate
        this.batchSamples = Math.round(sampleRate * BATCH_SECONDS)
        this.prebufferSamples = Math.round(sampleRate * PREBUFFER_SECONDS)
        this.pending = new Float32Array(this.batchSamples * 2)
        this.done = new Promise((resolve) => {
            this.resolveDone = resolve
        })

        // Matching the stream's rate avoids relying on per-buffer resampling.
        this.context = new AudioContext({ sampleRate: sampleRate })
        // Pitch correction only costs CPU when the rate actually changes.
        this.source = this.context.createBufferQueueSource({ pitchCorrection: playbackRate !== 1 })
        this.source.playbackRate.value = playbackRate
        this.source.connect(this.context.destination)
        this.source.onBufferEnded = () => {
            this.queued--
            if (this.ended && this.queued <= 0) this.finish()
        }
    }

    /** Appends raw little-endian PCM16 bytes as they arrive. */
    push(bytes: Uint8Array) {
        if (this.ended || this.finished || bytes.length === 0) return

        let index = 0
        if (this.carry !== null) {
            this.append(toSample(this.carry, bytes[0]))
            this.carry = null
            index = 1
        }
        for (; index + 1 < bytes.length; index += 2) {
            this.append(toSample(bytes[index], bytes[index + 1]))
        }
        if (index < bytes.length) this.carry = bytes[index]

        if (this.pendingLength >= this.batchSamples) this.flush()
    }

    /** No more audio is coming; `done` resolves once what is queued has played. */
    end() {
        if (this.ended || this.finished) return
        this.ended = true
        this.flush()
        if (this.queued === 0) {
            this.finish()
            return
        }
        // A reply shorter than the prebuffer never reached the start threshold.
        if (!this.started) this.start()
    }

    /** Stops immediately, discarding anything still queued. */
    stop() {
        if (this.finished) return
        this.ended = true
        try {
            this.source.clearBuffers()
            if (this.started) this.source.stop()
        } catch {
            // Already stopped; nothing left to release.
        }
        this.finish()
    }

    private append(sample: number) {
        if (this.pendingLength === this.pending.length) {
            const grown = new Float32Array(this.pending.length * 2)
            grown.set(this.pending)
            this.pending = grown
        }
        this.pending[this.pendingLength++] = sample
    }

    private flush() {
        if (this.pendingLength === 0) return
        const buffer = this.context.createBuffer(1, this.pendingLength, this.sampleRate)
        buffer.copyToChannel(this.pending.slice(0, this.pendingLength), 0)
        this.source.enqueueBuffer(buffer)
        this.queued++
        this.queuedSamples += this.pendingLength
        this.pendingLength = 0
        if (!this.started && this.queuedSamples >= this.prebufferSamples) this.start()
    }

    private start() {
        this.started = true
        // The library defaults offset to -1 and then rejects that same value, so pass 0.
        this.source.start(0, 0)
    }

    private finish() {
        if (this.finished) return
        this.finished = true
        this.source.onBufferEnded = null
        this.context.close().catch(() => {
            // The context may already be closed; there is nothing more to clean up.
        })
        this.resolveDone()
    }
}
