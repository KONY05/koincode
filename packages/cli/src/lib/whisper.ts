import os from "node:os";
import path from "node:path";
import { readFileSync, unlinkSync } from "node:fs";

export type VoiceConfig = {
  whisperModel: "tiny" | "base" | "small";
  whisperBackend: "auto" | "openai" | "local";
  openaiKey?: string;
};

// Progress callback receives 0–100 during download, then undefined when loading into memory.
export type WarmProgressCallback = (progress: number | undefined) => void;

const WHISPER_CACHE_DIR = path.join(os.homedir(), ".koincode", "whisper");

// Module-scoped pipeline — loaded once per process lifetime.
let _pipeline: unknown = null;
// Tracks an in-flight warmup so multiple callers share the same Promise.
let _warmingPromise: Promise<unknown> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Transformers = any;

async function loadTransformers(): Promise<Transformers> {
  // Dynamic import so the WASM runtime is never loaded at startup.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = await import("@xenova/transformers" as string) as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  t.env.cacheDir = WHISPER_CACHE_DIR;
  return t;
}

async function getLocalPipeline(
  model: string,
  onProgress?: WarmProgressCallback,
): Promise<unknown> {
  if (_pipeline) return _pipeline;

  // If already warming, wait for the existing promise (share the work).
  if (_warmingPromise) {
    return _warmingPromise;
  }

  _warmingPromise = (async () => {
    const t = await loadTransformers() as Transformers;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const pipe = await t.pipeline(
      "automatic-speech-recognition",
      `Xenova/whisper-${model}`,
      {
        progress_callback: (event: {
          status: string;
          progress?: number;
        }) => {
          if (!onProgress) return;
          if (event.status === "progress") {
            onProgress(Math.round(event.progress ?? 0));
          } else if (event.status === "loading" || event.status === "initiate") {
            onProgress(undefined); // model loaded from disk, no download %
          }
        },
      },
    );

    _pipeline = pipe;
    _warmingPromise = null;
    return pipe;
  })();

  return _warmingPromise;
}

/**
 * Pre-loads the local Whisper pipeline in the background.
 * Call this when voice mode is enabled so the first recording doesn't wait.
 * onProgress receives 0–100 while downloading, undefined while loading into WASM.
 */
export async function warmLocalPipeline(
  model: string,
  onProgress?: WarmProgressCallback,
): Promise<void> {
  await getLocalPipeline(model, onProgress);
}

export function isLocalPipelineReady(): boolean {
  return _pipeline !== null;
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
