const EXECUTOR_URL =
  import.meta.env.VITE_EXECUTOR_URL ?? "http://127.0.0.1:7081";

export async function executeIntents(intents: any[], sessionId?: string) {
  const res = await fetch(`${EXECUTOR_URL}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, intents }),
  });
  if (!res.ok) throw new Error(`Executor ${res.status}: ${await res.text()}`);
  return res.json(); // { session_id, results, artifacts }
}

export async function uploadFile(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${EXECUTOR_URL}/uploads`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { fileRef, path }
}
