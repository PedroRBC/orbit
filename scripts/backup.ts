import "dotenv/config";
import { backupDatabase } from "../src/db/backup";

process.umask(0o077);
const file = await backupDatabase(process.env.ORBIT_DB_PATH || "data/orbit.db", process.argv[2] || process.env.ORBIT_BACKUP_DIR || "data/backups");
console.log(`Backup verificado: ${file}`);
