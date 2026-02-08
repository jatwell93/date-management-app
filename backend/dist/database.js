"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.releaseDb = releaseDb;
exports.initDatabase = initDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const environment_1 = require("./config/environment");
let db;
function getDb() {
    if (!db) {
        db = new better_sqlite3_1.default(environment_1.envConfig.DATABASE_PATH || './database.sqlite');
    }
    return db;
}
function releaseDb(_db) {
    // better-sqlite3 doesn't have connection pooling, so this is a no-op
}
async function initDatabase() {
    // This function is now a no-op, as the database is initialized on first call to getDb()
}
