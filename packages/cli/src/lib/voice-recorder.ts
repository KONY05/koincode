import os from "node:os";
import path from "node:path";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export type RecorderHandle = { stop: () => Promise<string> };

// ─── macOS: compiled Swift binary (AVFoundation) ─────────────────────────────
//
// Why not Bun FFI (AudioQueue): JSCallback with threadsafe:true segfaults in
// some Bun versions on x86_64 — the callback ptr is null when passed to CoreAudio.
//
// Why a compiled binary instead of `swift <script>`:
// Script mode re-compiles on every invocation (~3s cold start each time).
// We compile once into ~/.koincode/bin/koincode-recorder during voice warmup;
// subsequent recordings are instant.
//
// When the binary first accesses the microphone, macOS shows
// "Terminal would like to access the microphone" — the same popup Claude Code shows.
// swiftc ships with Xcode Command Line Tools (`xcode-select --install`).

const RECORDER_DIR = path.join(os.homedir(), ".koincode", "bin");
const RECORDER_BIN = path.join(RECORDER_DIR, "koincode-recorder");

// Records 16 kHz mono 16-bit PCM WAV until stdin is closed by the parent.
const SWIFT_SOURCE = `
import AVFoundation
import Foundation

guard CommandLine.arguments.count > 1 else { exit(1) }
let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])

let settings: [String: Any] = [
    AVFormatIDKey: Int(kAudioFormatLinearPCM),
    AVSampleRateKey: 16000.0,
    AVNumberOfChannelsKey: 1,
    AVLinearPCMBitDepthKey: 16,
    AVLinearPCMIsSignedIntegerKey: true,
    AVLinearPCMIsBigEndianKey: false,
    AVLinearPCMIsNonInterleavedKey: false,
]

guard let recorder = try? AVAudioRecorder(url: outputURL, settings: settings),
      recorder.record()
else { exit(1) }

// Block until the parent closes stdin — that is the stop signal.
FileHandle.standardInput.readDataToEndOfFile()
recorder.stop()
`.trim();

// ─── Public recorder API ─────────────────────────────────────────────────────

export function isRecorderReady(): boolean {
  if (process.platform === "darwin") return existsSync(RECORDER_BIN);
  return true; // arecord / PowerShell always available on Linux / Windows
}

/** Compile the Swift recorder binary. Called once during voice warmup. */
export async function warmRecorder(): Promise<void> {
  if (process.platform !== "darwin") return;
  if (existsSync(RECORDER_BIN)) return;

  const which = spawnSync("which", ["swiftc"], { encoding: "utf8" });
  if (which.status !== 0) {
    throw new Error(
      "swiftc not found — install Xcode Command Line Tools: xcode-select --install",
    );
  }

  mkdirSync(RECORDER_DIR, { recursive: true });

  const srcPath = path.join(os.tmpdir(), "koincode-recorder.swift");
  writeFileSync(srcPath, SWIFT_SOURCE);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("swiftc", [srcPath, "-o", RECORDER_BIN], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
    proc.on("error", reject);
  });
}

export async function checkRecorderAvailable(): Promise<{ ok: boolean; hint?: string }> {
  if (process.platform === "darwin") {
    return existsSync(RECORDER_BIN)
      ? { ok: true }
      : { ok: false, hint: "Voice recorder is still being set up. Please wait." };
  }
  if (process.platform === "linux") {
    return checkCommand("arecord", "Install ALSA utils: sudo apt-get install alsa-utils");
  }
  if (process.platform === "win32") return { ok: true };
  return { ok: false, hint: "Unsupported platform for voice recording" };
}

export function startRecording(): Promise<RecorderHandle> {
  const wavPath = path.join(os.tmpdir(), `koincode-voice-${Date.now()}.wav`);
  let proc: ChildProcess;

  if (process.platform === "darwin") {
    // Swift binary reads stdin; closing it is the stop signal.
    proc = spawn(RECORDER_BIN, [wavPath], { stdio: ["pipe", "ignore", "ignore"] });
  } else if (process.platform === "linux") {
    proc = spawn("arecord", ["-f", "S16_LE", "-r", "16000", "-c", "1", wavPath]);
  } else {
    proc = spawnWindowsRecorder(wavPath);
  }

  return Promise.resolve({
    stop: () =>
      new Promise<string>((resolve) => {
        if (proc.stdin) {
          proc.stdin.end(); // signals macOS/Windows recorders to stop
        } else {
          proc.kill("SIGTERM");
        }
        proc.on("close", () => resolve(wavPath));
        proc.on("error", () => resolve(wavPath));
      }),
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function checkCommand(
  cmd: string,
  hint: string,
): Promise<{ ok: boolean; hint?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("which", [cmd]);
    proc.on("close", (code) =>
      code === 0 ? resolve({ ok: true }) : resolve({ ok: false, hint }),
    );
    proc.on("error", () => resolve({ ok: false, hint }));
  });
}

function spawnWindowsRecorder(wavPath: string): ChildProcess {
  const escaped = wavPath.replace(/\\/g, "\\\\");
  const psCmd = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Mci {
  [DllImport("winmm.dll")] public static extern int mciSendString(string cmd, System.Text.StringBuilder ret, int len, IntPtr h);
}
"@;
[Mci]::mciSendString("open new type waveaudio alias cap", $null, 0, [IntPtr]::Zero) | Out-Null;
[Mci]::mciSendString("record cap", $null, 0, [IntPtr]::Zero) | Out-Null;
$null = [Console]::ReadLine();
[Mci]::mciSendString("stop cap", $null, 0, [IntPtr]::Zero) | Out-Null;
[Mci]::mciSendString("save cap \`"${escaped}\`"", $null, 0, [IntPtr]::Zero) | Out-Null;
[Mci]::mciSendString("close cap", $null, 0, [IntPtr]::Zero) | Out-Null;
`.trim();
  return spawn("powershell.exe", ["-Command", psCmd], {
    stdio: ["pipe", "ignore", "ignore"],
  });
}
