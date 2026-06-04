import { closeDb } from "../lib/db/client.js";
import { ensureSchema } from "../lib/db/migrate.js";

async function main() {
  await ensureSchema();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
