import "server-only";
import { MongoClient, type Db } from "mongodb";

declare global {
  var budgetMongo: Promise<MongoClient> | undefined;
  var budgetIndexes: Promise<void> | undefined;
}

export function mongoClient() {
  if (!process.env.MONGODB_URI) throw new Error("databaseUnavailable");
  if (!global.budgetMongo) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 5, minPoolSize: 0, maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: 10_000, connectTimeoutMS: 10_000
    });
    global.budgetMongo = client.connect().catch(error => { global.budgetMongo = undefined; throw error; });
  }
  return global.budgetMongo;
}

export async function database(): Promise<Db> {
  const client = await mongoClient();
  const db = client.db(process.env.MONGODB_DB || "family_budget");
  if (!global.budgetIndexes) {
    global.budgetIndexes = Promise.all([
      db.collection("users").createIndex({ googleSub: 1 }, { unique: true }),
      db.collection("families").createIndex({ "members.userId": 1 }),
      db.collection("expenses").createIndex({ familyId: 1, deletedAt: 1, date: -1, createdAt: -1, _id: -1 }),
      db.collection("plans").createIndex({ familyId: 1, createdAt: -1 }),
      db.collection("budgets").createIndex({ familyId: 1, month: 1 }, { unique: true }),
      db.collection("invitations").createIndex({ tokenHash: 1 }, { unique: true }),
      db.collection("invitations").createIndex({ familyId: 1, expiresAt: 1 }),
      db.collection("activities").createIndex({ familyId: 1, at: -1 }),
      db.collection("rateLimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    ]).then(() => {}).catch(error => { global.budgetIndexes = undefined; throw error; });
  }
  await global.budgetIndexes;
  return db;
}
