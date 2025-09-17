import type { Intent } from "@voice-web-agent/schemas";

export type StepLog = {
  step: string;
  selector?: string;
  status: "success" | "error";
  latencyMs: number;
  message?: string;
};

export function describeIntent(i: Intent): string {
  // Human-readable label; useful for logs
  const t = i.target?.url
    ? ` → ${i.target.url}`
    : i.target?.selector
    ? ` @ ${i.target.selector}`
    : "";
  return `${i.intent}${t}`;
}

export function validateNavigate(i: Intent) {
  if (i.intent !== "navigate") throw new Error("Not a navigate intent");
  if (!i.target?.url) throw new Error("navigate requires target.url");
}

export function validateType(i: Intent) {
  if (i.intent !== "type") throw new Error("Not a type intent");
  if (!i.target?.selector) throw new Error("type requires target.selector");
  if (typeof i.params?.value === "undefined")
    throw new Error("type requires params.value");
}
