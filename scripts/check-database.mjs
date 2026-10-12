import { MongoClient } from "mongodb";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());

if (!process.env.MONGODB_URI) { console.error("MONGODB_URI is not configured."); process.exit(1); }
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000, connectTimeoutMS: 10_000, maxPoolSize: 1 });
try {
  await client.connect();
  await client.db(process.env.MONGODB_DB || "family_budget").command({ ping: 1 });
  console.log("Atlas connection verified (ping only; no data was written).");
} catch (error) {
  const code = typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : error.name;
  const phase = typeof error.syscall === "string" && /^[A-Za-z]+$/.test(error.syscall) ? `, ${error.syscall}` : "";
  console.error(`Atlas connection could not be verified (${code}${phase}). Check the database user, password, network access, and connection string.`);
  process.exitCode = 1;
} finally { await client.close(); }
