import { useEffect, useState } from "react";
import type { WorkspaceRoot } from "@koincode/shared";

import { getModifiedFiles, type ModifiedFilesGroup } from "../lib/git-status";

const POLL_MS = 3000;

/** Only polls while `enabled` — avoids shelling out to git on every render when the info sidebar is closed. */
export function useModifiedFiles(enabled: boolean, roots: WorkspaceRoot[] = []): ModifiedFilesGroup[] {
  const [groups, setGroups] = useState<ModifiedFilesGroup[]>([]);

  useEffect(() => {
    if (!enabled) return;

    const refresh = () => setGroups(getModifiedFiles(roots));
    refresh();

    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [enabled, roots]);

  return groups;
}
