import Database from "better-sqlite3";

const dbPath = process.env.SQLITE_DB_PATH ?? "swiggy-agent.db";

export const db = new Database(dbPath);

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      budget INTEGER,
      favoriteCuisine TEXT,
      favoriteDessert TEXT,
      dislikes TEXT,
      swiggyOne INTEGER,
      defaultAddress TEXT,
      lastUpdated TEXT
    )
  `);
}
