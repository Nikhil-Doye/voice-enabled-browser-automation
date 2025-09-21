import { useState } from "react";
import { executeIntents, uploadFile } from "../api";

export function IntentReview({ lastIntent }: { lastIntent: any | null }) {
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [running, setRunning] = useState(false);

  if (!lastIntent) return null;

  // The brain payload might be under lastIntent.payload
  const intents: any[] =
    lastIntent?.payload?.intents ?? lastIntent?.intents ?? [];

  async function onConfirm() {
    try {
      setRunning(true);

      // If any upload intents are missing fileRef, prompt the user
      for (const intent of intents) {
        if (intent.type === "upload" && !intent.args?.fileRef) {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = ".pdf,.doc,.docx";
          input.click();

          await new Promise<void>((resolve) => {
            input.onchange = async () => {
              const file = input.files?.[0];
              if (file) {
                const up = await uploadFile(file);
                intent.args = { ...(intent.args || {}), fileRef: up.fileRef };
              }
              resolve();
            };
          });
        }
      }

      const res = await executeIntents(intents, sessionId);
      setSessionId(res.session_id);

      // You can also render res.results & screenshots in your UI
      console.log("[executor results]", res);
      alert("Sent to executor. Check Chrome!");
    } catch (e: any) {
      console.error(e);
      alert(e.message || String(e));
    } finally {
      setRunning(false);
    }
  }

  const needsConfirm = intents.some((i) => i.requires_confirmation);

  return (
    <div
      style={{
        border: "1px solid #eee",
        padding: 12,
        borderRadius: 8,
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h3 style={{ margin: 0 }}>Intent Plan</h3>
        <small>{needsConfirm ? "Confirmation required" : "Safe to run"}</small>
      </div>
      <pre
        style={{
          background: "#111",
          color: "#ddd",
          padding: 12,
          borderRadius: 8,
          overflow: "auto",
          maxHeight: 280,
        }}
      >
        {JSON.stringify(intents, null, 2)}
      </pre>
      <button
        onClick={onConfirm}
        disabled={running || intents.length === 0}
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          border: "1px solid #444",
          background: needsConfirm ? "#0ea5e9" : "#10b981",
          color: "white",
          cursor: "pointer",
        }}
      >
        {needsConfirm ? "Confirm & Run" : "Run"}
      </button>
    </div>
  );
}
