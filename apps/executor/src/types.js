import { z } from "zod";
export const IntentType = z.enum([
    "search",
    "navigate",
    "click",
    "type",
    "extract",
    "extract_table",
    "sort",
    "filter",
    "scroll",
    "back",
    "forward",
    "select",
    "wait_for",
    "upload",
    "screenshot",
    "summarize",
    "confirm",
    "cancel",
    "unknown",
]);
export const Target = z
    .object({
    strategy: z
        .enum(["auto", "css", "text", "role", "aria", "xpath"])
        .default("auto"),
    selector: z.string().optional(),
    text: z.string().optional(),
    role: z.string().optional(),
    name: z.string().optional(),
})
    .partial()
    .strict()
    .optional();
export const Intent = z
    .object({
    type: IntentType,
    args: z.record(z.any()).default({}),
    target: Target,
    priority: z.number().int().default(0),
    requires_confirmation: z.boolean().default(false),
    timeout_ms: z.number().int().positive().optional(),
    retries: z.number().int().min(0).max(3).default(1),
    clarification: z.string().optional(),
})
    .strict();
export const ExecuteRequest = z
    .object({
    session_id: z.string().optional(),
    intents: z.array(Intent).min(1),
    options: z
        .object({
        headless: z.boolean().optional(),
    })
        .optional(),
})
    .strict();
