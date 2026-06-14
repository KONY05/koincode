import { useEffect, useState } from "react";

import { version } from "../../package.json";

type UpdateStatus = "idle" | "updating" | "done";

let updateChecked = false;

export function useAutoUpdate() {
  const [status, setStatus] = useState<UpdateStatus>("idle");

  useEffect(() => {
    if (updateChecked) return;
    updateChecked = true;

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
          setStatus("updating");
          const proc = Bun.spawn(["npm", "install", "-g", "koincode"], {
            stdout: "ignore",
            stderr: "ignore",
          });
          await proc.exited;
          setStatus("done");
        }
      } catch {}
    }
    check();
  }, []);

  return status;
}
