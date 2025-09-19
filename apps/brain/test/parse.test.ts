import { describe, it, expect, vi } from "vitest";
import { buildServer } from "../src/server";
import * as llm from "../src/llm";

describe("brain-ts /parse", () => {
  it("validates a simple search intent", async () => {
    vi.spyOn(llm, "callLLMJSON").mockResolvedValue({
      version: "1.0",
      intents: [
        {
          type: "search",
          args: { query: "wireless earbuds" },
          priority: 0,
          requires_confirmation: false,
        },
      ],
      context_updates: { query: "wireless earbuds" },
      confidence: 0.9,
      tts_summary: "Searching for wireless earbuds.",
    });
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/parse",
      payload: { text: "search wireless earbuds" },
    });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.version).toBe("1.0");
    expect(j.intents[0].type).toBe("search");
    expect(j.confidence).toBeGreaterThan(0.5);
  });

  it("handles upload with confirmation and tts", async () => {
    vi.spyOn(llm, "callLLMJSON").mockResolvedValue({
      version: "1.0",
      intents: [
        {
          type: "upload",
          target: { strategy: "auto", selector: "input[type='file']" },
          args: { fileRef: "resume://latest" },
          priority: 0,
          requires_confirmation: true,
          retries: 1,
        },
        {
          type: "click",
          target: { strategy: "text", text: "Submit" },
          args: {},
          priority: 1,
          requires_confirmation: true,
        },
      ],
      context_updates: {},
      confidence: 0.75,
      tts_summary:
        "I will upload your resume and then click submit. Please confirm.",
      follow_up_question: null,
    });
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/parse",
      payload: { text: "upload my resume and submit the application" },
    });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.intents.some((i: any) => i.type === "upload")).toBe(true);
    expect(j.tts_summary).toBeTruthy();
    expect(
      j.intents.every((i: any) => typeof i.requires_confirmation === "boolean")
    ).toBe(true);
  });

  it("asks a follow-up when missing info and lowers confidence", async () => {
    vi.spyOn(llm, "callLLMJSON").mockResolvedValue({
      version: "1.0",
      intents: [
        {
          type: "unknown",
          args: {},
          priority: 0,
          requires_confirmation: false,
        },
      ],
      context_updates: {},
      confidence: 0.5,
      follow_up_question: "Which job title and location should I search for?",
    });
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/parse",
      payload: { text: "apply for that job" },
    });
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.confidence).toBeLessThanOrEqual(0.6);
    expect(j.follow_up_question).toMatch(/which job/i);
  });
});
