"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUser = createUser;
exports.getUsers = getUsers;
exports.getUserById = getUserById;
exports.getUserByPin = getUserByPin;
exports.updateUser = updateUser;
exports.deleteUser = deleteUser;
const database_1 = require("../database");
async function createUser(user) {
    const db = await (0, database_1.getDb)();
    const result = await db.run("INSERT INTO users (pin, role) VALUES (?, ?)", user.pin, user.role);
    return { id: result.lastID, ...user };
}
async function getUsers() {
    const db = await (0, database_1.getDb)();
    return db.all("SELECT * FROM users");
}
async function getUserById(id) {
    const db = await (0, database_1.getDb)();
    return db.get("SELECT * FROM users WHERE id = ?", id);
}
async function getUserByPin(pin) {
    const db = await (0, database_1.getDb)();
    return db.get("SELECT * FROM users WHERE pin = ?", pin);
}
async function updateUser(id, user) {
    const db = await (0, database_1.getDb)();
    const fields = Object.keys(user)
        .map((key) => `${key} = ?`)
        .join(", ");
    const values = Object.values(user);
    const result = await db.run(`UPDATE users SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, ...values, id);
    return result.changes === 1;
}
async function deleteUser(id) {
    const db = await (0, database_1.getDb)();
    const result = await db.run("DELETE FROM users WHERE id = ?", id);
    return result.changes === 1;
}
