import { defineConfig } from "prisma/config";
import { DB_PATH } from "@koincode/shared";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? `file:${DB_PATH}`,
  },
});
