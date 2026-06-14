import { useEffect, useState } from "react";

import { version } from "../../package.json";

let updateChecked = false;
let cachedHasUpdate = false;
const subscribers = new Set<(v: boolean) => void>();

export function useUpdateCheck() {
  const [hasUpdate, setHasUpdate] = useState(cachedHasUpdate);

  useEffect(() => {
    subscribers.add(setHasUpdate);

    if (!updateChecked) {
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
            cachedHasUpdate = true;
            for (const fn of subscribers) fn(true);
          }
        } catch {}
      }
      check();
    }

    return () => {
      subscribers.delete(setHasUpdate);
    };
  }, []);

  return hasUpdate;
}
