// apps/voice/src/server.ts
import dotenv from "dotenv";
import path from "node:path";
import express from "express";
import type { Server as HttpServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { connectDeepgram } from "./deepgram.js";
import { fileURLToPath } from "node:url";

// Load .env from app and repo root (app values take precedence)
dotenv.config(); // apps/voice/.env (if present)
dotenv.config({ path: path.resolve(process.cwd(), "..", "..", ".env") }); // repo-root .env fallback

export type VoiceServer = {
  http: HttpServer;
  wss: WebSocketServer;
  close: () => Promise<void>;
};

export async function startVoiceServer(opts?: {
  port?: number;
  deepgramApiKey?: string | null;
}): Promise<VoiceServer> {
  const PORT = Number(opts?.port ?? process.env.VOICE_PORT ?? 7071);
  const DEEPGRAM_API_KEY =
    opts?.deepgramApiKey ?? process.env.DEEPGRAM_API_KEY ?? null;

  if (!DEEPGRAM_API_KEY) {
    console.warn(
      "[voice] DEEPGRAM_API_KEY not set. The server will accept connections but won't transcribe."
    );
  }

  const app = express();
  app.get("/health", (_req, res) =>
    res.json({ status: "ok", service: "voice", version: "0.1.0" })
  );

  const http = await new Promise<HttpServer>((resolve) => {
    const s = app.listen(PORT, () => {
      console.log(`[voice] http/ws listening on http://127.0.0.1:${PORT}`);
      resolve(s);
    });
  });

  const wss = new WebSocketServer({ server: http, path: "/stream" });

  type ClientState = {
    dg?: Awaited<ReturnType<typeof connectDeepgram>>;
    closed?: boolean;
  };

  wss.on("connection", async (ws: WebSocket) => {
    const state: ClientState = {};
    console.log("[voice] client connected");

    if (DEEPGRAM_API_KEY) {
      try {
        state.dg = await connectDeepgram(
          {
            apiKey: DEEPGRAM_API_KEY,
            model: process.env.DEEPGRAM_MODEL ?? "nova-3",
            language: "en-US",
            interimResults: true,
          },
          // onMessage: forward partial/final with explicit types
          (msg: any) => {
            const isFinal = msg?.is_final || msg?.channel?.is_final;
            ws.send(
              JSON.stringify({
                type: isFinal ? "transcript_final" : "transcript_partial",
                payload: msg,
              })
            );
          },
          // onState
          (type, info) => {
            if (!state.closed) {
              ws.send(
                JSON.stringify({ type: "info", payload: { state: type, info } })
              );
            }
          }
        );
        ws.send(
          JSON.stringify({ type: "info", payload: "deepgram_connected" })
        );
      } catch (err: any) {
        console.error("[voice] deepgram connect failed:", err?.message ?? err);
        ws.send(
          JSON.stringify({ type: "error", payload: "deepgram_connect_failed" })
        );
      }
    } else {
      ws.send(
        JSON.stringify({
          type: "warn",
          payload: "no_api_key; running in passthrough",
        })
      );
    }

    ws.on("message", (data: WebSocket.RawData) => {
      // Expect raw PCM16 16k mono bytes from the browser UI
      if (Buffer.isBuffer(data)) {
        state.dg?.sendAudio(data);
      } else {
        // Optional JSON control frames
        try {
          const msg = JSON.parse(String(data));
          if (msg?.type === "close") {
            state.dg?.close(); // graceful finish()
            ws.close();
          }
        } catch {
          // ignore non-JSON control messages
        }
      }
    });

    ws.on("close", () => {
      state.closed = true;
      state.dg?.close().catch(() => void 0);
      console.log("[voice] client disconnected");
    });
  });

  return {
    http,
    wss,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => {
          http.close(() => resolve());
        });
      }),
  };
}

// Robust "am I main?" check (Windows-safe)
const isMain = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
    return path.normalize(thisFile) === path.normalize(argv1);
  } catch {
    return false;
  }
})();

if (isMain && !process.env.VITEST) {
  startVoiceServer().catch((e) => {
    console.error("[voice] failed to start:", e);
    process.exit(1);
  });
}