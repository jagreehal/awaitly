import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const dataDir = join(process.cwd(), ".data");
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}
const url = `file:${join(dataDir, "sqlite.db")}`;
const client = createClient({ url });
export const db = drizzle(client, { schema });
