/**
 * React hook that checks for koincode updates on mount and exposes the result
 * to all mounted consumers via a module-level subscriber set (so the home
 * screen and status bar stay in sync without duplicate network calls).
 *
 * For npm installs: stops at "available" — the user triggers /update manually.
 * For curl/iex installs: automatically downloads the new binary in the
 * background and transitions through "downloading" -> "downloaded" (or
 * "permission-denied" if the binary is in a root-owned directory).
 *
 * The check runs exactly once per process, on the first component mount.
 */

import { useEffect, useState } from "react";

import { version } from "../../package.json";
import {
  detectInstallMethod,
  downloadSelfUpdate,
} from "../lib/update-cli";

export type UpdateStatus =
  | "current"
  | "available"
  | "downloading"
  | "downloaded"
  | "permission-denied";

export interface UpdateInfo {
  status: UpdateStatus;
  version?: string;
}

let checkDone = false;
let cachedInfo: UpdateInfo = { status: "current" };
const subscribers = new Set<(info: UpdateInfo) => void>();

function broadcast(info: UpdateInfo) {
  cachedInfo = info;
  for (const fn of subscribers) fn(info);
}

export function useUpdateCheck(): UpdateInfo {
  const [info, setInfo] = useState<UpdateInfo>(cachedInfo);

  useEffect(() => {
    subscribers.add(setInfo);

    if (!checkDone) {
      checkDone = true;

      async function check() {
        try {
          const res = await fetch("https://registry.npmjs.org/koincode/latest");
          const data = await res.json();
          if (
            data != null &&
            typeof data === "object" &&
            "version" in data &&
            typeof data.version === "string" &&
            data.version !== version
          ) {
            const newVersion = data.version;
            broadcast({ status: "available", version: newVersion });

            if (detectInstallMethod() === "curl") {
              broadcast({ status: "downloading", version: newVersion });
              const result = await downloadSelfUpdate(newVersion);
              if (result === "downloaded") {
                broadcast({ status: "downloaded", version: newVersion });
              } else if (result === "permission-denied") {
                broadcast({ status: "permission-denied", version: newVersion });
              } else {
                broadcast({ status: "available", version: newVersion });
              }
            }
          }
        } catch {}
      }
      check();
    }

    return () => {
      subscribers.delete(setInfo);
    };
  }, []);

  return info;
}
