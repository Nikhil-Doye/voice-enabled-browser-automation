// apps/voice/src/server.ts
import dotenv from "dotenv";
import path from "node:path";
import express from "express";
import type { Server as HttpServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { connectDeepgram } from "./deepgram.js";
import { fileURLToPath } from "node:url";
import http from "node:http";

// Load .env from app and repo root (app values take precedence)
dotenv.config(); // apps/voice/.env (if present)
dotenv.config({ path: path.resolve(process.cwd(), "..", "..", ".env") }); // repo-root .env fallback

function postJsonAndReturn(url: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const data = Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          hostname: u.hostname,
          port:
            (u.port && Number(u.port)) || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + (u.search || ""),
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": data.length,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks).toString("utf8");
            try {
              resolve(JSON.parse(buf));
            } catch {
              resolve({ ok: false });
            }
          });
        }
      );
      req.on("error", reject);
      req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

export type VoiceServer = {
  http: HttpServer;
  wss: WebSocketServer;
  close: () => Promise<void>;
};

export async function startVoiceServer(opts?: {
  port?: number;
  deepgramApiKey?: string | null;
}): Promise<VoiceServer> {
  const PORT = Number(opts?.port ?? process.env.VOICE_PORT ?? 7072);
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

  const httpServer = await new Promise<HttpServer>((resolve) => {
    const s = app.listen(PORT, () => {
      console.log(`[voice] http/ws listening on http://127.0.0.1:${PORT}`);
      resolve(s);
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/stream" });

  type ClientState = {
    dg?: Awaited<ReturnType<typeof connectDeepgram>>;
    closed?: boolean;
    context: Record<string, any>;
    pendingText?: string;
    debounce?: NodeJS.Timeout;
  };

  wss.on("connection", async (ws: WebSocket) => {
    const state: ClientState = { context: {} };
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
          // onMessage from Deepgram
          (msg: any) => {
            const isFinal = msg?.is_final || msg?.channel?.is_final;

            ws.send(
              JSON.stringify({
                type: isFinal ? "transcript_final" : "transcript_partial",
                payload: msg,
              })
            );

            // Debounce/aggregate final transcripts before sending to brain
            if (isFinal) {
              const alt = msg?.channel?.alternatives?.[0];
              const text: string = (alt?.transcript ?? "").trim();
              if (!text) return;

              state.pendingText = state.pendingText
                ? `${state.pendingText} ${text}`
                : text;
              if (state.debounce) clearTimeout(state.debounce);

              state.debounce = setTimeout(() => {
                const combined = (state.pendingText || "").trim();
                state.pendingText = "";

                if (!combined) return;
                const brainUrl =
                  process.env.BRAIN_URL ?? "http://127.0.0.1:8090/parse";

                postJsonAndReturn(brainUrl, {
                  text: combined,
                  session_id: undefined,
                  context: state.context,
                })
                  .then((brainResp) => {
                    try {
                      ws.send(
                        JSON.stringify({ type: "intent", payload: brainResp })
                      );
                      if (brainResp?.tts_summary) {
                        ws.send(
                          JSON.stringify({
                            type: "tts",
                            payload: brainResp.tts_summary,
                          })
                        );
                      }
                      if (
                        brainResp?.context_updates &&
                        typeof brainResp.context_updates === "object"
                      ) {
                        state.context = {
                          ...state.context,
                          ...brainResp.context_updates,
                        };
                      }
                    } catch {}
                  })
                  .catch((e) =>
                    console.error("[voice] brain post failed:", e?.message || e)
                  );
              }, 1000); // 1s debounce window
            }
          },
          // onState from Deepgram
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
      if (Buffer.isBuffer(data)) {
        // raw PCM16 16k mono audio from browser
        state.dg?.sendAudio(data);
        return;
      }

      // Optional JSON control frames from client
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type === "close") {
          state.dg?.close();
          ws.close();
        } else if (
          msg?.type === "context_update" &&
          msg?.payload &&
          typeof msg.payload === "object"
        ) {
          // allow the client to push context (e.g., current URL once executor is running)
          state.context = { ...state.context, ...msg.payload };
        }
      } catch {
        // ignore non-JSON control messages
      }
    });

    ws.on("close", () => {
      state.closed = true;
      if (state.debounce) clearTimeout(state.debounce);
      state.dg?.close().catch(() => void 0);
      console.log("[voice] client disconnected");
    });
  });

  return {
    http: httpServer,
    wss,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => {
          httpServer.close(() => resolve());
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
