"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUser = createUser;
exports.getUsers = getUsers;
exports.getUserById = getUserById;
exports.getUserByPin = getUserByPin;
exports.updateUser = updateUser;
exports.deleteUser = deleteUser;
const database_1 = require("../database");
const auth_service_1 = require("./auth.service");
const authService = new auth_service_1.AuthService();
async function createUser(user) {
    // Validate PIN strength before creating user
    const pinValidation = authService.validatePin(user.pin);
    if (!pinValidation.isValid) {
        throw new Error(pinValidation.message || "Invalid PIN format");
    }
    // Hash the PIN before storing
    const hashedPin = await authService.hashPin(user.pin);
    const db = await (0, database_1.getDb)();
    const stmt = db.prepare("INSERT INTO users (pin, role) VALUES (?, ?)");
    const result = stmt.run(hashedPin, user.role);
    return { id: result.lastInsertRowid, ...user, pin: hashedPin }; // Return hashed pin in the object
}
async function getUsers() {
    const db = await (0, database_1.getDb)();
    const stmt = db.prepare("SELECT * FROM users");
    return stmt.all();
}
async function getUserById(id) {
    const db = await (0, database_1.getDb)();
    const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
    return stmt.get(id);
}
async function getUserByPin(pin) {
    const db = await (0, database_1.getDb)();
    // Get all users and compare PINs using bcrypt (since PINs are hashed)
    const stmt = db.prepare("SELECT * FROM users");
    const users = stmt.all();
    for (const user of users) {
        const isValid = await authService.verifyPin(pin, user.pin);
        if (isValid) {
            return user;
        }
    }
    return undefined;
}
async function updateUser(id, user) {
    const db = await (0, database_1.getDb)();
    // If PIN is being updated, validate and hash it
    if (user.pin) {
        const pinValidation = authService.validatePin(user.pin);
        if (!pinValidation.isValid) {
            throw new Error(pinValidation.message || "Invalid PIN format");
        }
        // Hash the new PIN before updating
        user.pin = await authService.hashPin(user.pin);
    }
    const fields = Object.keys(user)
        .map((key) => `${key} = ?`)
        .join(", ");
    const values = Object.values(user);
    const stmt = db.prepare(`UPDATE users SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
    const result = stmt.run(...values, id);
    return result.changes === 1;
}
async function deleteUser(id) {
    const db = await (0, database_1.getDb)();
    const stmt = db.prepare("DELETE FROM users WHERE id = ?");
    const result = stmt.run(id);
    return result.changes === 1;
}
