import { useEffect, useState } from "react";

import { getModifiedFiles, type ModifiedFile } from "../lib/git-status";

const POLL_MS = 3000;

/** Only polls while `enabled` — avoids shelling out to git on every render when the info sidebar is closed. */
export function useModifiedFiles(enabled: boolean): ModifiedFile[] {
  const [files, setFiles] = useState<ModifiedFile[]>([]);

  useEffect(() => {
    if (!enabled) return;

    const refresh = () => setFiles(getModifiedFiles());
    refresh();

    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [enabled]);

  return files;
}
