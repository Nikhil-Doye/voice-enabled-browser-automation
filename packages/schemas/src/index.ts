import { z } from "zod";

// Shared sub-shapes
export const Target = z.object({
  url: z.string().url().optional(),
  query: z.string().optional(),
  selector: z.string().optional(),
  position: z.record(z.number()).optional(),
  semantic: z.record(z.string()).optional(),
});

export const Sorting = z.object({
  field: z.string(),
  order: z.enum(["asc", "desc"]),
});

export const Filter = z.object({
  field: z.string(),
  op: z.enum(["<", "<=", "=", ">=", ">", "contains"]),
  value: z.any(),
});

// Primary intent schema
export const IntentSchema = z.object({
  intent: z.string(), // e.g. navigate | type | click | filter | sort | extract
  utterance: z.string(),
  confidence: z.number().min(0).max(1),
  target: Target.optional(),
  params: z
    .object({
      value: z.any().optional(),
      filters: z.array(Filter).optional(),
      sorting: Sorting.optional(),
      index: z.number().int().gte(1).optional(), // for "open_result"
      fields: z.array(z.string()).optional(), // for "extract"
      format: z.enum(["csv", "json"]).optional(),
      filename: z.string().optional(),
    })
    .partial()
    .optional(),
  requires_confirmation: z.boolean().default(false),
});

export type Intent = z.infer<typeof IntentSchema>;

// Helper to parse with good error messages
export function parseIntent(input: unknown): Intent {
  return IntentSchema.parse(input);
}
