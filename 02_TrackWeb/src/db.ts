import { openDB, IDBPDatabase, DBSchema, IDBPTransaction } from 'idb';

interface WebsiteTimeEntry {
  normalizedUrl: string;
  domain: string;
  titles: string;
  activeSeconds: number;
  totalSeconds: number;
}

interface WebTimeTrackerDBSchema extends DBSchema {
  website_times: {
    key: string;
    value: WebsiteTimeEntry;
  };
}

const DB_NAME = 'webTimeTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'website_times';

let db: IDBPDatabase<WebTimeTrackerDBSchema> | null = null;

export async function openDatabase(): Promise<IDBPDatabase<WebTimeTrackerDBSchema>> {
  if (db) {
    return db;
  }

  db = await openDB<WebTimeTrackerDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db: IDBPDatabase<WebTimeTrackerDBSchema>, oldVersion: number, newVersion: number, transaction: IDBPTransaction<WebTimeTrackerDBSchema, 'website_times'[], 'versionchange'>) {
      switch (oldVersion) {
        case 0:
          // Migration from no database to version 1
          db.createObjectStore(STORE_NAME, {
            keyPath: 'normalizedUrl',
          });
          // You might want to create indexes here if needed for performance on queries other than keyPath
          // store.createIndex('domain', 'domain');
          break;
        // Add more cases for future schema migrations
      }
    },
    blocked() {
      console.error('Database upgrade blocked.');
      // Handle the blocked event, perhaps notify the user
    },
    blocking() {
      console.warn('Database blocking other connections.');
      // Handle the blocking event, perhaps close other connections
    },
    terminated() {
      console.error('Database connection terminated.');
      db = null;
      // Handle unexpected termination, try to reconnect or notify user
    },
  });

  return db;
}

export async function getEntry(normalizedUrl: string): Promise<WebsiteTimeEntry | undefined> {
  const db = await openDatabase();
  return db.get(STORE_NAME, normalizedUrl);
}

export async function putEntry(entry: WebsiteTimeEntry): Promise<string> {
  const db = await openDatabase();
  return db.put(STORE_NAME, entry);
}

export async function getAllEntries(): Promise<WebsiteTimeEntry[]> {
  const db = await openDatabase();
  return db.getAll(STORE_NAME);
}

export async function clearAllEntries(): Promise<void> {
  const db = await openDatabase();
  await db.clear(STORE_NAME);
}

export async function deleteEntry(normalizedUrl: string): Promise<void> {
  const db = await openDatabase();
  await db.delete(STORE_NAME, normalizedUrl);
}

export type { WebsiteTimeEntry };
