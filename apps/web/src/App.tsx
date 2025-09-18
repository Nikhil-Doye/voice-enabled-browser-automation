import React, { useEffect, useRef, useState } from "react";

type Line = { text: string; final: boolean; kind?: "info" | "warn" | "error" };

// ------------ Audio helpers (unchanged core) ------------
function floatTo16BitPCM(float32: Float32Array) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = float32[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function resampleTo16k(
  input: Float32Array,
  inputSampleRate: number
): Float32Array {
  if (inputSampleRate === 16000) return input;
  const ratio = inputSampleRate / 16000;
  const newLen = Math.floor(input.length / ratio);
  const resampled = new Float32Array(newLen);
  let idx = 0;
  for (let i = 0; i < newLen; i++) {
    resampled[i] = input[Math.floor(idx)];
    idx += ratio;
  }
  return resampled;
}

/** Create an AudioWorkletNode that posts mono Float32 frames to main thread */
async function createMicWorklet(
  ctx: AudioContext,
  stream: MediaStream
): Promise<AudioWorkletNode> {
  const workletCode = `
    class PCM16Tap extends AudioWorkletProcessor {
      constructor (options) {
        super(options);
        this.sourceSampleRate = options.processorOptions?.sourceSampleRate ?? sampleRate;
        this.targetSampleRate = options.processorOptions?.targetSampleRate ?? 16000;
      }
      process (inputs) {
        const input = inputs[0];
        if (input && input[0]) {
          const ch = input[0];
          const data = new Float32Array(ch.length);
          data.set(ch);
          this.port.postMessage(data, [data.buffer]);
        }
        return true;
      }
    }
    registerProcessor('pcm16-tap', PCM16Tap);
  `;
  const blob = new Blob([workletCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const node = new AudioWorkletNode(ctx, "pcm16-tap", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
    processorOptions: {
      sourceSampleRate: ctx.sampleRate,
      targetSampleRate: 16000,
    },
  });

  const src = ctx.createMediaStreamSource(stream);
  src.connect(node);
  node.connect(ctx.destination); // keep the graph alive (silent)

  return node;
}

// ------------ Tiny inline icons (no external packages) ------------
function IconMic({ muted }: { muted?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 1a3 3 0 0 0-3 3v7a3 3 0 1 0 6 0V4a3 3 0 0 0-3-3Z" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
      <path d="M12 19v4" />
      <path d="M8 23h8" />
      {muted ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}
function IconBroom() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M15 3l6 6M8 10l6 6M4 20l6-6" />
      <path d="M3 21c3-3 7-1 10-4l-6-6C4 14 6 18 3 21Z" />
    </svg>
  );
}
function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 ${
        connected
          ? "bg-green-100 text-green-700 ring-green-200"
          : "bg-gray-100 text-gray-600 ring-gray-200"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          connected ? "bg-green-500" : "bg-gray-400"
        }`}
      />
      {connected ? "connected" : "disconnected"}
    </span>
  );
}

export function App() {
  const [connected, setConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [level, setLevel] = useState(0); // simple RMS meter 0..1

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const keepaliveTimer = useRef<number | null>(null);

  // batching aggregator (bundle small worklet frames into ~60ms packets)
  const aggRef = useRef<{
    buf: Float32Array;
    lastSend: number;
    desiredMs: number;
  }>({
    buf: new Float32Array(0),
    lastSend: performance.now(),
    desiredMs: 60,
  });

  useEffect(() => () => stop(), []);

  function pushInfo(text: string, kind: Line["kind"] = "info") {
    setLines((prev) => [{ text, final: true, kind }, ...prev].slice(0, 200));
  }
  function pushPartial(text: string) {
    setLines((prev) => {
      const next = [...prev];
      if (next.length && !next[0].final && !next[0].kind)
        next[0] = { text, final: false };
      else next.unshift({ text, final: false });
      return next.slice(0, 200);
    });
  }
  function pushFinal(text: string) {
    setLines((prev) => {
      const next = [...prev];
      if (next.length && !next[0].final && !next[0].kind)
        next[0] = { text, final: true };
      else next.unshift({ text, final: true });
      return next.slice(0, 200);
    });
  }

  async function start() {
    const wsUrl =
      (import.meta.env.VITE_VOICE_WS_URL as string) ??
      "ws://127.0.0.1:7071/stream";
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);

        if (
          msg.type === "transcript_partial" ||
          msg.type === "transcript_final"
        ) {
          const alt = msg.payload?.channel?.alternatives?.[0];
          const text = (alt?.transcript ?? "").trim();
          if (text) {
            if (msg.type === "transcript_partial") pushPartial(text);
            else pushFinal(text);
          }
          return;
        }

        if (
          msg.type === "info" ||
          msg.type === "warn" ||
          msg.type === "error"
        ) {
          const payload =
            typeof msg.payload === "string"
              ? msg.payload
              : JSON.stringify(msg.payload);
          pushInfo(payload, msg.type);
          return;
        }

        // fallback dump
        pushInfo(typeof msg === "string" ? msg : JSON.stringify(msg), "info");
      } catch {
        pushInfo(String(ev.data), "info");
      }
    };
    wsRef.current = ws;

    // mic capture
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext(); // device rate (often 48k)
    if (ctx.state === "suspended") await ctx.resume();

    const worklet = await createMicWorklet(ctx, stream);

    // batch frames from worklet, resample→PCM16→send every ~60ms and compute RMS level
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const input = e.data;

      // update a simple audio level meter (RMS with slight decay)
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      setLevel((prev) => Math.max(rms, prev * 0.85));

      const agg = aggRef.current;
      const merged = new Float32Array(agg.buf.length + input.length);
      merged.set(agg.buf);
      merged.set(input, agg.buf.length);
      agg.buf = merged;

      const elapsed = performance.now() - agg.lastSend;
      if (elapsed >= agg.desiredMs) {
        const resampled = resampleTo16k(agg.buf, ctx.sampleRate);
        const pcm16 = floatTo16BitPCM(resampled);
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(pcm16.buffer);
        }
        agg.buf = new Float32Array(0);
        agg.lastSend = performance.now();
      }
    };

    // light keep-alive (send ~100ms silence every 2s)
    keepaliveTimer.current = window.setInterval(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const silence = new Int16Array(1600); // 100ms @ 16k
      wsRef.current.send(silence.buffer);
    }, 2000);

    audioCtxRef.current = ctx;
    workletRef.current = worklet;
    setIsRecording(true);
    pushInfo("microphone_started");
  }

  function stop() {
    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;

    if (keepaliveTimer.current) {
      clearInterval(keepaliveTimer.current);
      keepaliveTimer.current = null;
    }

    try {
      workletRef.current?.disconnect();
    } catch {}
    workletRef.current = null;

    try {
      audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;

    // reset aggregator
    aggRef.current = {
      buf: new Float32Array(0),
      lastSend: performance.now(),
      desiredMs: 60,
    };

    setIsRecording(false);
    setConnected(false);
    pushInfo("microphone_stopped");
  }

  function clearTranscript() {
    setLines([]);
  }

  // ---- UI ----
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50 text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b bg-white/70 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-indigo-600 text-white grid place-items-center shadow-sm">
              VA
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-5">
                Voice Web Agent
              </h1>
              <p className="text-xs text-slate-500">
                Live transcription with Deepgram
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge connected={connected} />
            <button
              onClick={isRecording ? stop : start}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium shadow-sm ring-1 transition
              ${
                isRecording
                  ? "bg-rose-600 text-white ring-rose-700 hover:bg-rose-700"
                  : "bg-indigo-600 text-white ring-indigo-700 hover:bg-indigo-700"
              }`}
              title={isRecording ? "Stop microphone" : "Start microphone"}
            >
              <IconMic muted={!isRecording} />
              {isRecording ? "Stop" : "Start"}
            </button>
            <button
              onClick={clearTranscript}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-white hover:bg-slate-50 ring-1 ring-slate-200 text-slate-700"
              title="Clear transcript"
            >
              <IconBroom />
              Clear
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-4 py-6 grid md:grid-cols-3 gap-6">
        {/* Transcript panel */}
        <section className="md:col-span-2 rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-4 py-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Transcript</h2>
            <span className="text-xs text-slate-500">
              finals in bold, partials dimmed
            </span>
          </div>
          <div className="p-4 h-[60vh] overflow-auto space-y-2">
            {lines.length === 0 ? (
              <div className="h-full grid place-items-center text-slate-500 italic">
                No transcripts yet…
              </div>
            ) : (
              lines.map((l, i) => (
                <div
                  key={i}
                  className={`rounded-lg px-3 py-2 ring-1 ${
                    l.kind === "error"
                      ? "bg-red-50 ring-red-100 text-red-700"
                      : l.kind === "warn"
                      ? "bg-amber-50 ring-amber-100 text-amber-800"
                      : "bg-white ring-slate-200 text-slate-800"
                  }`}
                  style={{ opacity: !l.kind && !l.final ? 0.7 : 1 }}
                >
                  <span
                    className={`${
                      l.final && !l.kind ? "font-semibold" : "font-normal"
                    }`}
                  >
                    {l.kind ? `[${l.kind}] ${l.text}` : l.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Right column: mic meter & tips */}
        <aside className="rounded-2xl border bg-white shadow-sm p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">
            Microphone
          </h3>
          <div className="mb-4">
            <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden ring-1 ring-slate-200">
              <div
                className="h-full bg-indigo-500 transition-[width] duration-75"
                style={{ width: `${Math.min(100, Math.round(level * 200))}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-slate-500">Input level</div>
          </div>
          <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3 text-xs text-slate-600 space-y-1">
            <div>
              WS: <code>ws://127.0.0.1:7071/stream</code>
            </div>
            <div>
              Format: <code>PCM16 • 16 kHz • mono</code>
            </div>
            <div>
              Model: <code>{import.meta.env.VITE_DG_MODEL ?? "nova-3"}</code>
            </div>
          </div>
          <div className="mt-4 text-xs text-slate-500">
            Tip: partial lines update in place; final lines are bolded. Use
            “Clear” to reset the panel.
          </div>
        </aside>
      </main>
    </div>
  );
}
