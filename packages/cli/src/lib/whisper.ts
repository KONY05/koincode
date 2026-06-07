import { readFileSync, unlinkSync } from "node:fs";

export type VoiceConfig = {
  whisperModel: "tiny" | "base" | "small";
  whisperBackend: "auto" | "openai" | "local";
  openaiKey?: string;
};

// Module-scoped pipeline — loaded once per process lifetime (2–5s cold start on first use).
let _pipeline: unknown = null;

async function getLocalPipeline(model: string): Promise<unknown> {
  if (!_pipeline) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformers = await import("@xenova/transformers" as string) as any;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    _pipeline = await transformers.pipeline("automatic-speech-recognition", `Xenova/whisper-${model}`);
  }
  return _pipeline;
}

async function transcribeOpenAI(audioPath: string, apiKey: string): Promise<string> {
  try {
    const fileBuffer = readFileSync(audioPath);
    const blob = new Blob([fileBuffer], { type: "audio/wav" });
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", blob, "audio.wav");
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!response.ok) return "";
    const data = await response.json() as { text?: string };
    return data.text?.trim() ?? "";
  } catch {
    return "";
  }
}

async function transcribeLocal(audioPath: string, model: string): Promise<string> {
  try {
    const pipe = await getLocalPipeline(model) as (path: string) => Promise<{ text: string }>;
    const result = await pipe(audioPath);
    return result.text?.trim() ?? "";
  } catch {
    return "";
  }
}

export async function transcribe(audioPath: string, config: VoiceConfig): Promise<string> {
  let text = "";

  try {
    const backend = config.whisperBackend;
    if (backend === "openai") {
      if (config.openaiKey) {
        text = await transcribeOpenAI(audioPath, config.openaiKey);
      }
    } else if (backend === "local") {
      text = await transcribeLocal(audioPath, config.whisperModel);
    } else {
      // "auto" — OpenAI if key present, else local
      if (config.openaiKey) {
        text = await transcribeOpenAI(audioPath, config.openaiKey);
      } else {
        text = await transcribeLocal(audioPath, config.whisperModel);
      }
    }
  } catch {
    // ignore errors, return empty
  }

  try {
    unlinkSync(audioPath);
  } catch {
    // ignore cleanup errors
  }

  return text;
}
