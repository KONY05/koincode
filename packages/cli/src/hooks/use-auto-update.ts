import { useEffect, useState } from "react";

import { version } from "../../package.json";

let updateChecked = false;

export function useAutoUpdate() {
  const [hasUpdate, setHasUpdate] = useState(false);

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
          setHasUpdate(true);
        }
      } catch {}
    }
    check();
  }, []);

  return hasUpdate;
}
