import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { User } from "../models/user.model";
import { getDb } from "../database";

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret"; // Use environment variable for secret

export class AuthService {
  async hashPin(pin: string): Promise<string> {
    const saltRounds = 10;
    return await bcrypt.hash(pin, saltRounds);
  }

  async verifyPin(pin: string, hashedPin: string): Promise<boolean> {
    return await bcrypt.compare(pin, hashedPin);
  }

  async login(pin: string): Promise<string | null> {
    const db = await getDb();
    
    // Get all users and iterate through them to find a match
    const users = await db.all("SELECT * FROM users");
    console.log("All users in DB:", users);
    
    // Look for a user whose hashed pin matches the PIN that was provided
    for (const user of users) {
      console.log("Checking user:", user);
      console.log("Comparing provided PIN:", pin);
      console.log("Stored hashed PIN:", user.pin);
      
      const isValidPin = await bcrypt.compare(pin, user.pin);
      console.log("PIN comparison result for user", user.id, ":", isValidPin);
      
      if (isValidPin) {
        console.log("Valid user found:", user);
        const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
          expiresIn: "1h",
        });
        return token;
      }
    }
    
    console.log("No valid user found with PIN:", pin);
    return null;
  }
}
