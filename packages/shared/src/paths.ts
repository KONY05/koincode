import path from "path";
import os from "os";

export const SERVER_PORT = 37420;

export const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".koincode");
export const PROJECT_CONFIG_DIR = path.join(process.cwd(), ".koincode");
export const PROJECT_CONFIG_FILE = path.join(PROJECT_CONFIG_DIR, "config.json");
export const DB_PATH = path.join(GLOBAL_CONFIG_DIR, "data.db");
export const PID_FILE = path.join(GLOBAL_CONFIG_DIR, "server.pid");
export const GLOBAL_CONFIG_FILE = path.join(GLOBAL_CONFIG_DIR, "config.json");
