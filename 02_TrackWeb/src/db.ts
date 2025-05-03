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
    indexes: {
      domain: string;
    };
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
          const store = transaction.objectStore(STORE_NAME);
          store.createIndex('domain', 'domain');
          // Fallthrough for subsequent migrations

        // Add more cases for future schema migrations
        // case 1:
        //   // Migration from version 1 to version 2
        //   // Example: Add a new object store or modify existing one
        //   // db.createObjectStore('new_store', { keyPath: 'id' });
        //   // Fallthrough

        // case 2:
        //   // Migration from version 2 to version 3
        //   // Example: Add an index to an existing object store
        //   // transaction.objectStore(STORE_NAME).createIndex('new_index', 'new_property');
        //   // Fallthrough

        default:
          // If oldVersion is greater than or equal to the current version (DB_VERSION),
          // it means the user is downgrading or there's an unexpected version number.
          // In a real application, you might want to handle this more gracefully,
          // perhaps by showing an error or refusing to open the database.
          console.warn(`Unexpected database version. Old version: ${oldVersion}, New version: ${newVersion}`);
          break;
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
  try {
    const db = await openDatabase();
    return db.get(STORE_NAME, normalizedUrl);
  } catch (error) {
    console.error(`Error getting entry for ${normalizedUrl}:`, error);
    throw error; // Re-throw the error for the caller to handle
  }
}

export async function putEntry(entry: WebsiteTimeEntry): Promise<string> {
  try {
    const db = await openDatabase();
    return db.put(STORE_NAME, entry);
  } catch (error) {
    console.error(`Error putting entry for ${entry.normalizedUrl}:`, error);
    throw error; // Re-throw the error for the caller to handle
  }
}

export async function getAllEntries(): Promise<WebsiteTimeEntry[]> {
  try {
    const db = await openDatabase();
    return db.getAll(STORE_NAME);
  } catch (error) {
    console.error('Error getting all entries:', error);
    throw error; // Re-throw the error for the caller to handle
  }
}

export async function clearAllEntries(): Promise<void> {
  try {
    const db = await openDatabase();
    await db.clear(STORE_NAME);
  } catch (error) {
    console.error('Error clearing all entries:', error);
    throw error; // Re-throw the error for the caller to handle
  }
}

export async function deleteEntry(normalizedUrl: string): Promise<void> {
  try {
    const db = await openDatabase();
    await db.delete(STORE_NAME, normalizedUrl);
  } catch (error) {
    console.error(`Error deleting entry for ${normalizedUrl}:`, error);
    throw error; // Re-throw the error for the caller to handle
  }
}

export type { WebsiteTimeEntry };
