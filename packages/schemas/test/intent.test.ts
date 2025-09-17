import { describe, it, expect } from "vitest";
import { parseIntent } from "../src";

describe("Intent schema", () => {
  it("accepts a minimal navigate intent", () => {
    const intent = parseIntent({
      intent: "navigate",
      utterance: "go to bestbuy",
      confidence: 0.9,
      target: { url: "https://www.bestbuy.com" },
    });
    expect(intent.intent).toBe("navigate");
    expect(intent.target?.url).toMatch(/^https:\/\/www\.bestbuy\.com/);
  });

  it("allows filter + sort params", () => {
    const intent = parseIntent({
      intent: "filter",
      utterance: "under 50 sorted by price asc",
      confidence: 0.85,
      params: {
        filters: [{ field: "price", op: "<=", value: 50 }],
        sorting: { field: "price", order: "asc" },
      },
    });
    expect(intent.params?.filters?.[0]?.op).toBe("<=");
    expect(intent.params?.sorting?.order).toBe("asc");
  });

  it("rejects invalid confidence", () => {
    expect(() =>
      parseIntent({
        intent: "navigate",
        utterance: "go",
        confidence: 2, // invalid
      })
    ).toThrow();
  });

  it("supports extract with fields and export", () => {
    const intent = parseIntent({
      intent: "extract",
      utterance: "export results as csv",
      confidence: 0.8,
      params: {
        fields: ["title", "price", "rating", "url"],
        format: "csv",
        filename: "earbuds.csv",
      },
    });
    expect(intent.params?.fields?.length).toBeGreaterThan(0);
    expect(intent.params?.format).toBe("csv");
  });
});
