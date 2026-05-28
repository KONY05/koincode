import fs from "fs";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../generated/prisma/client.ts";
import { CONFIG_DIR, DB_PATH } from "@koincode/shared";

fs.mkdirSync(CONFIG_DIR, { recursive: true });

const adapter = new PrismaLibSql({ url: `file:${DB_PATH}` });

export const db = new PrismaClient({ adapter });
