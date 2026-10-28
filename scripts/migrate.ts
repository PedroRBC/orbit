import "dotenv/config";
import { getDatabase } from "../src/db/index";
getDatabase().$client.close();
console.log("Banco do Orbit pronto.");
