import { MongoClient, Db, Collection } from 'mongodb';
import { env } from '@utils/env';
import { logger } from '@logger';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectMongo(): Promise<Db> {
  if (db) return db;
  if (!client) {
    client = new MongoClient(env.MONGO_URI);
  }
  if (!client.topology) {
    await client.connect();
  }
  db = client.db();
  logger.info({ db: db.databaseName }, 'Mongo connected');
  return db;
}

export async function getCollection<T = any>(name: string): Promise<Collection<T>> {
  const database = await connectMongo();
  return database.collection<T>(name);
}
