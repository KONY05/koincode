import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export type RecorderHandle = {
  stop: () => Promise<string>; // resolves to temp .wav file path
};

export async function checkRecorderAvailable(): Promise<{ ok: boolean; hint?: string }> {
  const platform = process.platform;
  if (platform === "linux") {
    return checkCommand("arecord", "Install ALSA utils: sudo apt-get install alsa-utils");
  } else if (platform === "darwin") {
    return checkCommand("sox", "Install sox: brew install sox");
  } else if (platform === "win32") {
    return { ok: true }; // powershell.exe is always available
  }
  return { ok: false, hint: "Unsupported platform for voice recording" };
}

async function checkCommand(cmd: string, hint: string): Promise<{ ok: boolean; hint?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("which", [cmd]);
    proc.on("close", (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, hint });
    });
    proc.on("error", () => resolve({ ok: false, hint }));
  });
}

export function startRecording(): Promise<RecorderHandle> {
  const wavPath = path.join(os.tmpdir(), `koincode-voice-${Date.now()}.wav`);
  const platform = process.platform;

  let proc: ChildProcess;

  if (platform === "linux") {
    proc = spawn("arecord", ["-f", "S16_LE", "-r", "16000", "-c", "1", wavPath]);
  } else if (platform === "darwin") {
    proc = spawn("sox", ["-d", "-r", "16000", "-c", "1", "-b", "16", wavPath]);
  } else {
    // Windows: use MCI (multimedia control interface) via PowerShell
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
[Mci]::mciSendString("save cap \`"${wavPath.replace(/\\/g, "\\\\")}\`"", $null, 0, [IntPtr]::Zero) | Out-Null;
[Mci]::mciSendString("close cap", $null, 0, [IntPtr]::Zero) | Out-Null;
`.trim();
    proc = spawn("powershell.exe", ["-Command", psCmd], { stdio: ["pipe", "ignore", "ignore"] });
  }

  const handle: RecorderHandle = {
    stop: () =>
      new Promise((resolve) => {
        if (platform === "win32" && proc.stdin) {
          proc.stdin.write("\n");
          proc.stdin.end();
        } else {
          proc.kill("SIGTERM");
        }
        proc.on("close", () => resolve(wavPath));
        proc.on("error", () => resolve(wavPath));
      }),
  };

  return Promise.resolve(handle);
}
