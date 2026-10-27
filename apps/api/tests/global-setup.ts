import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Starts an isolated, throwaway single-node replica set (replica set mode is needed
 * for transactions in later phases). Tests never touch a real database.
 * Set MONGOMS_SYSTEM_BINARY to use a locally installed mongod.
 */
let replSet: MongoMemoryReplSet | undefined;

export async function setup(): Promise<void> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.TEST_MONGODB_URI = replSet.getUri('workforce_test');
}

export async function teardown(): Promise<void> {
  await replSet?.stop();
}
