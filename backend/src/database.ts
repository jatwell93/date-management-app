// Database setup and initialization
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Open a database connection
export async function getDb() {
  const db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });
  return db;
}

// Initialize the database schema
export async function initDatabase() {
  const db = await getDb();
  
  // Create tables if they don't exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT
    )
  `);
  
  console.log('Database initialized successfully');
}