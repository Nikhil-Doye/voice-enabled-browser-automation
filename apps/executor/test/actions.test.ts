import { describe, it, expect, vi } from "vitest";
import { runIntents } from "../src/actions";
import type { Page } from "playwright";

function makePage(): Page {
  return {
    goto: vi.fn(),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("")),
    locator: vi.fn() as any,
    $: vi.fn().mockResolvedValue(null) as any,
    $$eval: vi.fn().mockResolvedValue([{ title: "X", price: "$9.99" }]) as any,
    fill: vi.fn() as any,
    type: vi.fn() as any,
    click: vi.fn() as any,
    keyboard: { type: vi.fn(), press: vi.fn() } as any,
    getByText: vi.fn(() => ({ first: () => ({ click: vi.fn() }) })) as any,
    waitForSelector: vi.fn() as any,
    setInputFiles: vi.fn() as any,
    selectOption: vi.fn() as any,
    evaluate: vi.fn() as any,
    goBack: vi.fn() as any,
    goForward: vi.fn() as any,
  } as unknown as Page;
}

describe("runIntents", () => {
  it("navigates, waits, extracts table", async () => {
    const page = makePage();
    const intents: any[] = [
      { type: "navigate", args: { url: "https://example.com" } },
      { type: "wait_for", args: { selector: "#results", timeoutMs: 100 } },
      {
        type: "extract_table",
        target: { selector: "#results" },
        args: { columns: ["title", "price"], limit: 5 },
      },
    ];
    const res = await runIntents(page, ".tmp", intents as any);
    expect(res[0].ok).toBe(true);
    expect(res[2].ok).toBe(true);
    expect(Array.isArray(res[2].data)).toBe(true);
  });
});
