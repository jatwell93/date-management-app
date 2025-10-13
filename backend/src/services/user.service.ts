import { getDb } from "../database";
import { AuthService } from "./auth.service";

export interface User {
  id?: number;
  pin: string;
  role: "Manager" | "Team Member";
  created_at?: string;
  updated_at?: string;
}

const authService = new AuthService();

export async function createUser(user: User): Promise<User> {
  // Validate PIN strength before creating user
  const pinValidation = authService.validatePin(user.pin);
  if (!pinValidation.isValid) {
    throw new Error(pinValidation.message || "Invalid PIN format");
  }
  
  // Hash the PIN before storing
  const hashedPin = await authService.hashPin(user.pin);
  
  const db = await getDb();
  const stmt = db.prepare("INSERT INTO users (pin, role) VALUES (?, ?)");
  const result = stmt.run(hashedPin, user.role);
  return { id: result.lastInsertRowid as number, ...user, pin: hashedPin }; // Return hashed pin in the object
}

export async function getUsers(): Promise<User[]> {
  const db = await getDb();
  const stmt = db.prepare("SELECT * FROM users");
  return stmt.all() as User[];
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
  return stmt.get(id) as User | undefined;
}

export async function getUserByPin(pin: string): Promise<User | undefined> {
  const db = await getDb();
  // Get all users and compare PINs using bcrypt (since PINs are hashed)
  const stmt = db.prepare("SELECT * FROM users");
  const users = stmt.all() as User[];
  
  for (const user of users) {
    const isValid = await authService.verifyPin(pin, user.pin);
    if (isValid) {
      return user;
    }
  }
  
  return undefined;
}

export async function updateUser(
  id: number,
  user: Partial<User>,
): Promise<boolean> {
  const db = await getDb();
  
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
  const stmt = db.prepare(
    `UPDATE users SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  );
  const result = stmt.run(...values, id);
  return result.changes === 1;
}

export async function deleteUser(id: number): Promise<boolean> {
  const db = await getDb();
  const stmt = db.prepare("DELETE FROM users WHERE id = ?");
  const result = stmt.run(id);
  return result.changes === 1;
}
