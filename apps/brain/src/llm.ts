import OpenAI from "openai";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "..", "..", ".env") });

const BASE_URL = process.env.LLM_BASE_URL || "https://api.openai.com";
const API_KEY = process.env.LLM_API_KEY || "";
const MODEL = process.env.LLM_MODEL || "gpt-4o-mini";

if (!API_KEY) {
  console.warn(
    "[brain-ts] LLM_API_KEY not set — /parse will fail until you add it to .env"
  );
}

export const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

export async function callLLMJSON(
  messages: { role: "system" | "user" | "assistant"; content: string }[]
) {
  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages,
  });
  const content = res.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content);
}
