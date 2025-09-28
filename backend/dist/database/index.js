"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sqlite3_1 = __importDefault(require("sqlite3"));
const path_1 = __importDefault(require("path"));
const dbPath = path_1.default.resolve(__dirname, "../database.sqlite");
let db;
const getDbConnection = () => {
    if (!db) {
        db = new sqlite3_1.default.Database(dbPath, (err) => {
            if (err) {
                // console.error("Error opening database", err.message);
            }
            else {
                // console.log("Connected to the SQLite database.");
            }
        });
    }
    return db;
};
exports.default = getDbConnection;
