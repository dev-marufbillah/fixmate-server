import { MongoMemoryServer } from "mongodb-memory-server";
import fs from "node:fs";

const dbPath = "/home/user/.mongo-data";
fs.mkdirSync(dbPath, { recursive: true });

const mongod = await MongoMemoryServer.create({
  instance: { port: 27017, ip: "127.0.0.1", dbPath },
});
console.log("MONGOD_READY " + mongod.getUri() + " (persistent: " + dbPath + ")");
setInterval(() => {}, 1 << 30);
