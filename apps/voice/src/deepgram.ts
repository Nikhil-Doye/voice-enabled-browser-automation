import WebSocket, { RawData } from "ws";

export type DeepgramClientOptions = {
  apiKey: string;
  model?: string; // "nova-3" etc.
  language?: string; // "en"
  interimResults?: boolean; // partials
};

export type DeepgramClient = {
  socket: WebSocket;
  sendAudio: (chunk: Buffer | ArrayBuffer | Uint8Array) => void;
  close: () => void;
};

export function connectDeepgram(
  opts: DeepgramClientOptions,
  onMessage: (msg: any) => void,
  onClose?: () => void
): Promise<DeepgramClient> {
  const {
    apiKey,
    model = "nova-3",
    language = "en",
    interimResults = true,
  } = opts;

  const url = new URL("wss://api.deepgram.com/v1/listen");
  url.searchParams.set("model", model);
  url.searchParams.set("language", language);
  if (interimResults) url.searchParams.set("punctuate", "true");

  return new Promise((resolve, reject) => {
    const dg = new WebSocket(url.toString(), {
      headers: { Authorization: `Token ${apiKey}` },
    });

    dg.on("open", () => {
      resolve({
        socket: dg,
        sendAudio: (chunk) => {
          if (dg.readyState === WebSocket.OPEN) dg.send(chunk);
        },
        close: () => dg.close(),
      });
    });

    dg.on("message", (data: RawData) => {
      try {
        const json = JSON.parse(String(data));
        onMessage(json);
      } catch {
        // ignore non-JSON frames
      }
    });

    dg.on("error", (err: Error) => reject(err));
    dg.on("close", () => {
      onClose?.();
    });
  });
}
