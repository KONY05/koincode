import path from "path";
import os from "os";

export const SERVER_PORT = 37420;

export const CONFIG_DIR = path.join(os.homedir(), ".koincode");
export const DB_PATH = path.join(CONFIG_DIR, "data.db");
export const PID_FILE = path.join(CONFIG_DIR, "server.pid");
