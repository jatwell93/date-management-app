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
    const user: User | undefined = await db.get(
      "SELECT * FROM users WHERE pin = ?",
      pin,
    );

    if (user) {
      // In a real app, you would compare hashed PINs: await bcrypt.compare(pin, user.pin)
      const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, {
        expiresIn: "1h",
      });
      return token;
    }
    return null;
  }
}
