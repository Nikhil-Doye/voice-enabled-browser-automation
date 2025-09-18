import React, { useEffect, useRef, useState } from "react";

type Line = { text: string; final: boolean; kind?: "info" | "warn" | "error" };

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
          // copy to transferable buffer
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
  // keep graph alive (silent path)
  node.connect(ctx.destination);

  return node;
}

export function App() {
  const [connected, setConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const keepaliveTimer = useRef<number | null>(null);

  // batching aggregator (bundle small worklet frames into ~50–60ms packets)
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

    // batch frames from worklet, resample→PCM16→send every ~60ms
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const input = e.data;
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

  return (
    <div style={{ fontFamily: "system-ui, Segoe UI, Arial", padding: 16 }}>
      <h1>Voice Web Agent – Live Transcript</h1>

      <div
        style={{
          marginBottom: 12,
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <button onClick={isRecording ? stop : start}>
          {isRecording ? "Stop" : "Start mic"}
        </button>
        <span>Status: {connected ? "connected" : "disconnected"}</span>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          padding: 12,
          borderRadius: 8,
          maxHeight: 320,
          overflow: "auto",
        }}
      >
        {lines.length === 0 ? (
          <i>No transcripts yet…</i>
        ) : (
          lines.map((l, i) => (
            <div
              key={i}
              style={{
                padding: "4px 0",
                borderBottom: "1px dashed #eee",
                color:
                  l.kind === "warn"
                    ? "#b58900"
                    : l.kind === "error"
                    ? "#dc322f"
                    : undefined,
                fontWeight: l.final && !l.kind ? 600 : 400,
                opacity: !l.kind && !l.final ? 0.6 : 1,
                whiteSpace: "pre-wrap",
              }}
            >
              {l.kind ? `[${l.kind}] ${l.text}` : l.text}
            </div>
          ))
        )}
      </div>

      <p style={{ color: "#666", fontSize: 12, marginTop: 12 }}>
        Uses <code>AudioWorkletNode</code> to batch &amp; resample mic audio to
        16&nbsp;kHz PCM16 before streaming.
      </p>
    </div>
  );
}
