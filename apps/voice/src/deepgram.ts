import {
  createClient,
  LiveClient,
  LiveTranscriptionEvents,
} from "@deepgram/sdk";

export type DeepgramClientOptions = {
  apiKey: string;
  model?: string; // e.g. "nova-3"
  language?: string; // e.g. "en"
  interimResults?: boolean;
};

export type DeepgramClient = {
  live: LiveClient;
  sendAudio: (chunk: Buffer | ArrayBuffer | Uint8Array) => void;
  close: () => Promise<void>;
};

// Connect via Deepgram SDK Live client
export async function connectDeepgram(
  opts: DeepgramClientOptions,
  onMessage: (msg: unknown) => void,
  onState?: (type: "open" | "close" | "error", info?: unknown) => void
): Promise<DeepgramClient> {
  const {
    apiKey,
    model = "nova-3",
    language = "en-US",
    interimResults = true,
  } = opts;

  const dg = createClient(apiKey);

  // IMPORTANT: We declare encoding & sample rate to match our UI stream (PCM16 @ 16kHz mono)
  const live = await dg.listen.live({
    model,
    language,
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
    interim_results: interimResults,
    punctuate: true,
    smart_format: true,
  });

  // Wire SDK events to our callbacks
  live.on(LiveTranscriptionEvents.Open, () => onState?.("open"));
  live.on(LiveTranscriptionEvents.Close, () => onState?.("close"));
  live.on(LiveTranscriptionEvents.Error, (e) => onState?.("error", e));
  live.on(LiveTranscriptionEvents.Transcript, (data) => onMessage(data));

  return {
    live,
    sendAudio: (chunk) => {
      // SDK expects ArrayBuffer/TypedArray/Buffer
      live.send(chunk as any);
    },
    close: async () => {
      try {
        await live.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
