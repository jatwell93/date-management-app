import sqlite3 from "sqlite3";
import path from "path";

const dbPath = path.resolve(__dirname, "../database.sqlite");

let db: sqlite3.Database;

const getDbConnection = () => {
  if (!db) {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        // console.error("Error opening database", err.message);
      } else {
        // console.log("Connected to the SQLite database.");
      }
    });
  }
  return db;
};

export default getDbConnection;
