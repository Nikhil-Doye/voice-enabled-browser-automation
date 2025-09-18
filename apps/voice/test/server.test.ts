import { describe, it, expect } from "vitest";
import WebSocket from "ws";
import { startVoiceServer } from "../src/server";

function wait(ms: number) { return new Promise(res => setTimeout(res, ms)); }

describe("voice server bootstrap", () => {
  it("responds on /health", async () => {
    const srv = await startVoiceServer({ port: 7099, deepgramApiKey: null });
    const res = await fetch("http://127.0.0.1:7099/health");
    const json = await res.json();
    expect(json.status).toBe("ok");
    await srv.close();
  }, 10000);

  it("accepts WS connection and sends an info frame without API key", async () => {
    const srv = await startVoiceServer({ port: 7098, deepgramApiKey: null });
    const ws = new WebSocket("ws://127.0.0.1:7098/stream");

    const first = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout waiting for WS frame")), 8000);
      ws.once("message", (data: WebSocket.RawData) => {
        clearTimeout(t);
        resolve(String(data));
      });
    });
    const parsed = JSON.parse(first);
    expect(["warn", "info", "error"]).toContain(parsed.type); // warns because no API key

    ws.close();
    await srv.close();
  }, 15000);
});