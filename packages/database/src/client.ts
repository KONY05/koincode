import fs from "fs";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../generated/prisma/client.ts";
import { GLOBAL_CONFIG_DIR, DB_PATH } from "@koincode/shared";

fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });

const adapter = new PrismaLibSql({ url: `file:${DB_PATH}` });

export const db = new PrismaClient({ adapter });
