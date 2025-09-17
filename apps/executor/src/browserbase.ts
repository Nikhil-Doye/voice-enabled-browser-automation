// apps/executor/src/browserbase.ts
export type CreateSessionResponse = {
  id: string;
  connectUrl: string; // <-- puppeteer.connect() uses this
};

const API_BASE =
  process.env.BROWSERBASE_API_BASE ?? "https://api.browserbase.com/v1";

export async function createBrowserbaseSession(): Promise<CreateSessionResponse> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error(
      "Missing env vars. Set BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID in .env"
    );
  }

  const r = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: {
      "X-BB-API-Key": apiKey, // ✅ correct header
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ projectId }), // ✅ correct body
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Browserbase create session failed (${r.status}): ${text}`);
  }

  const data = (await r.json()) as any;
  const connectUrl = data.connectUrl; // ✅ correct field
  if (!connectUrl)
    throw new Error("No connectUrl returned in Browserbase session response");

  return { id: data.id ?? "unknown", connectUrl };
}
