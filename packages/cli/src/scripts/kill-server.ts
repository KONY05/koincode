import path from "path";
import fs from "fs/promises";
import os from "os";

const PID_FILE = path.join(os.homedir(), ".koincode/server.pid");
(async () => {
  const pid = Number((await fs.readFile(PID_FILE, "utf8")).trim());
  if (pid) process.kill(pid);
})();