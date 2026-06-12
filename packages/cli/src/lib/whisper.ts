import { readFileSync, unlinkSync } from "node:fs";

export type VoiceConfig = {
  whisperBackend: "auto" | "openai" | "openrouter";
  openaiKey?: string;
  openrouterKey?: string;
};

async function transcribeOpenAI(audioPath: string, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("file", new Blob([readFileSync(audioPath)], { type: "audio/wav" }), "audio.wav");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) return "";
  const data = await response.json() as { text?: string };
  return data.text?.trim() ?? "";
}

async function transcribeOpenRouter(audioPath: string, apiKey: string): Promise<string> {
  const form = new FormData();
  form.append("model", "openai/whisper-large-v3");
  form.append("file", new Blob([readFileSync(audioPath)], { type: "audio/wav" }), "audio.wav");

  const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) return "";
  const data = await response.json() as { text?: string };
  return data.text?.trim() ?? "";
}

export async function transcribe(audioPath: string, config: VoiceConfig): Promise<string> {
  let text = "";

  try {
    const { whisperBackend: backend, openaiKey, openrouterKey } = config;

    if (backend === "openai") {
      if (openaiKey) text = await transcribeOpenAI(audioPath, openaiKey);
    } else if (backend === "openrouter") {
      if (openrouterKey) text = await transcribeOpenRouter(audioPath, openrouterKey);
    } else {
      // auto: openai first, openrouter as fallback
      if (openaiKey) {
        text = await transcribeOpenAI(audioPath, openaiKey);
      } else if (openrouterKey) {
        text = await transcribeOpenRouter(audioPath, openrouterKey);
      }
    }
  } catch { /* ignore network errors */ }

  try { unlinkSync(audioPath); } catch { /* ignore */ }

  return text;
}
