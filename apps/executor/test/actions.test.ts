import { describe, it, expect } from "vitest";
import { parseIntent } from "@voice-web-agent/schemas";
import { describeIntent, validateNavigate, validateType } from "../src/actions";

describe("executor actions", () => {
  it("describeIntent adds target url or selector", () => {
    const n = parseIntent({
      intent: "navigate",
      utterance: "go",
      confidence: 0.9,
      target: { url: "https://example.com" },
    });
    expect(describeIntent(n)).toContain("https://example.com");

    const t = parseIntent({
      intent: "type",
      utterance: "type",
      confidence: 0.9,
      target: { selector: "#q" },
      params: { value: "hello" },
    });
    expect(describeIntent(t)).toContain("#q");
  });

  it("validateNavigate requires url", () => {
    const ok = parseIntent({
      intent: "navigate",
      utterance: "go",
      confidence: 0.9,
      target: { url: "https://example.com" },
    });
    expect(() => validateNavigate(ok)).not.toThrow();

    const bad = parseIntent({
      intent: "navigate",
      utterance: "go",
      confidence: 0.9,
    });
    expect(() => validateNavigate(bad)).toThrow();
  });

  it("validateType requires selector and value", () => {
    const ok = parseIntent({
      intent: "type",
      utterance: "type",
      confidence: 0.9,
      target: { selector: "#q" },
      params: { value: "hi" },
    });
    expect(() => validateType(ok)).not.toThrow();

    const noSel = parseIntent({
      intent: "type",
      utterance: "type",
      confidence: 0.9,
      params: { value: "hi" },
    });
    expect(() => validateType(noSel)).toThrow();

    const noVal = parseIntent({
      intent: "type",
      utterance: "type",
      confidence: 0.9,
      target: { selector: "#q" },
    });
    expect(() => validateType(noVal)).toThrow();
  });
});
