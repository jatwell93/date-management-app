"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const database_1 = require("../database");
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret"; // Use environment variable for secret
class AuthService {
    async hashPin(pin) {
        const saltRounds = 10;
        return await bcrypt_1.default.hash(pin, saltRounds);
    }
    async verifyPin(pin, hashedPin) {
        return await bcrypt_1.default.compare(pin, hashedPin);
    }
    async login(pin) {
        const db = await (0, database_1.getDb)();
        // Get all users and iterate through them to find a match
        const users = await db.all("SELECT * FROM users");
        console.log("All users in DB:", users);
        // Look for a user whose hashed pin matches the PIN that was provided
        for (const user of users) {
            console.log("Checking user:", user);
            console.log("Comparing provided PIN:", pin);
            console.log("Stored hashed PIN:", user.pin);
            const isValidPin = await bcrypt_1.default.compare(pin, user.pin);
            console.log("PIN comparison result for user", user.id, ":", isValidPin);
            if (isValidPin) {
                console.log("Valid user found:", user);
                const token = jsonwebtoken_1.default.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
                    expiresIn: "1h",
                });
                return token;
            }
        }
        console.log("No valid user found with PIN:", pin);
        return null;
    }
}
exports.AuthService = AuthService;
