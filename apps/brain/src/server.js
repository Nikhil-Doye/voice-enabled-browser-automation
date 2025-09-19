import Fastify from "fastify";
import { ParseRequest, ParseResponse } from "./schema.js";
import { callLLMJSON } from "./llm.js";
const SYSTEM_PROMPT = `
You convert speech transcripts into a list of browser-automation intents for execution in a real headless browser.

Hard rules:
- Output ONLY JSON that matches the provided schema. No prose.
- Prefer semantic targets (role/name) and robust selectors; fall back to CSS/xpath if clear.
- Use "wait_for" when the step obviously requires it (navigation, results loading).
- Flag risky operations with requires_confirmation=true: login, checkout, payment, personal data entry, file uploads, destructive actions.
- If required info is missing, include a follow_up_question, set confidence <= 0.6, and keep minimal safe intents.
- Provide a concise tts_summary describing what will happen next in everyday language.
- If uncertain, include an 'unknown' intent and set confidence <= 0.5.

Context:
- The request includes a small context object (url, entity, last_intents). Use it to resolve follow-ups like "open the second result".
- Update context_updates with helpful state (entity/site, query, selected index, current_url).
`;
const FEWSHOTS = [
    {
        role: "user",
        content: '{"text":"search wireless earbuds","context":{"url":"https://www.bestbuy.com","last_intents":[]}}'
    },
    {
        role: "assistant",
        content: '{"version":"1.0","intents":[{"type":"search","args":{"query":"wireless earbuds"},"priority":0,"requires_confirmation":false}],"context_updates":{"query":"wireless earbuds"},"confidence":0.9,"tts_summary":"Searching for wireless earbuds.","follow_up_question":null}'
    },
    {
        role: "user",
        content: '{"text":"open the second result","context":{"url":"https://www.bestbuy.com/site/searchpage.jsp?st=wireless+earbuds","last_intents":[{"type":"search","args":{"query":"wireless earbuds"}}]}}'
    },
    {
        role: "assistant",
        content: '{"version":"1.0","intents":[{"type":"click","args":{},"target":{"strategy":"auto","selector":"#search-list li:nth-of-type(2) a"},"priority":0,"requires_confirmation":false}],"context_updates":{},"confidence":0.8,"tts_summary":"Opening the second result.","follow_up_question":null}'
    },
    {
        role: "user",
        content: '{"text":"sort by price low to high","context":{"entity":"bestbuy"}}'
    },
    {
        role: "assistant",
        content: '{"version":"1.0","intents":[{"type":"sort","args":{"by":"price","order":"asc"},"priority":0,"requires_confirmation":false}],"context_updates":{},"confidence":0.85,"tts_summary":"Sorting by lowest price.","follow_up_question":null}'
    },
    // File upload example
    {
        role: "user",
        content: '{"text":"upload my resume and submit the application","context":{"url":"https://careers.example.com/apply","last_intents":[{"type":"navigate","args":{"url":"https://careers.example.com/apply"}}]}}'
    },
    {
        role: "assistant",
        content: "{\"version\":\"1.0\",\"intents\":[{\"type\":\"upload\",\"target\":{\"strategy\":\"auto\",\"selector\":\"input[type=\\\"file\\\"]\"},\"args\":{\"fileRef\":\"resume://latest\"},\"priority\":0,\"requires_confirmation\":true,\"retries\":1},{\"type\":\"click\",\"target\":{\"strategy\":\"text\",\"text\":\"Submit\"},\"args\":{},\"priority\":1,\"requires_confirmation\":true}],\"context_updates\":{},\"confidence\":0.75,\"tts_summary\":\"I will upload your resume and then click submit. Please confirm.\",\"follow_up_question\":null}"
    },
    // Wait + extract example
    {
        role: "user",
        content: '{"text":"search wireless earbuds and extract the top 5 with prices","context":{"url":"https://www.bestbuy.com"}}'
    },
    {
        role: "assistant",
        content: "{\"version\":\"1.0\",\"intents\":[{\"type\":\"search\",\"args\":{\"query\":\"wireless earbuds\"},\"priority\":0,\"requires_confirmation\":false},{\"type\":\"wait_for\",\"args\":{\"selector\":\"[data-test=\\\"results\\\"]\",\"timeoutMs\":15000},\"priority\":1,\"requires_confirmation\":false},{\"type\":\"extract_table\",\"target\":{\"strategy\":\"auto\",\"selector\":\"[data-test=\\\"results\\\"]\"},\"args\":{\"columns\":[\"title\",\"price\"],\"limit\":5},\"priority\":2,\"requires_confirmation\":false}],\"context_updates\":{\"query\":\"wireless earbuds\"},\"confidence\":0.85,\"tts_summary\":\"I’ll search and pull the top five items with prices.\",\"follow_up_question\":null}"
    }
];
export async function buildServer() {
    const app = Fastify({ logger: false });
    app.get("/health", async () => ({ status: "ok", service: "brain-ts" }));
    app.post("/parse", async (req, reply) => {
        const parsedReq = ParseRequest.safeParse(req.body);
        if (!parsedReq.success) {
            return reply.status(400).send({ error: "invalid_request", detail: parsedReq.error.format() });
        }
        const body = parsedReq.data;
        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...FEWSHOTS,
            { role: "user", content: JSON.stringify(body) }
        ];
        // Call LLM and try one repair if schema fails
        let json;
        try {
            json = await callLLMJSON(messages);
            const first = ParseResponse.safeParse(json);
            if (!first.success) {
                json = await callLLMJSON([
                    ...messages,
                    { role: "system", content: "Your previous response failed schema validation. Return ONLY valid JSON matching the schema. No commentary." }
                ]);
            }
        }
        catch (e) {
            return reply.status(500).send({ error: "llm_error", detail: e?.message || String(e) });
        }
        const parsed = ParseResponse.safeParse(json);
        if (!parsed.success) {
            return reply.status(422).send({ error: "schema_validation_failed", detail: parsed.error.format() });
        }
        return parsed.data;
    });
    return app;
}
if (import.meta.url === `file://${process.argv[1]}`) {
    const PORT = Number(process.env.BRAIN_PORT || 8090);
    const app = await buildServer();
    await app.listen({ host: "127.0.0.1", port: PORT });
    console.log(`[brain-ts] listening on http://127.0.0.1:${PORT}`);
}
