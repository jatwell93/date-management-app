import { getDb } from "../database";

export interface User {
  id?: number;
  pin: string;
  role: "Manager" | "Team Member";
  created_at?: string;
  updated_at?: string;
}

export async function createUser(user: User): Promise<User> {
  const db = await getDb();
  const result = await db.run(
    "INSERT INTO users (pin, role) VALUES (?, ?)",
    user.pin,
    user.role,
  );
  return { id: result.lastID, ...user };
}

export async function getUsers(): Promise<User[]> {
  const db = await getDb();
  return db.all("SELECT * FROM users");
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = await getDb();
  return db.get("SELECT * FROM users WHERE id = ?", id);
}

export async function getUserByPin(pin: string): Promise<User | undefined> {
  const db = await getDb();
  return db.get("SELECT * FROM users WHERE pin = ?", pin);
}

export async function updateUser(
  id: number,
  user: Partial<User>,
): Promise<boolean> {
  const db = await getDb();
  const fields = Object.keys(user)
    .map((key) => `${key} = ?`)
    .join(", ");
  const values = Object.values(user);
  const result = await db.run(
    `UPDATE users SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ...values,
    id,
  );
  return result.changes === 1;
}

export async function deleteUser(id: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.run("DELETE FROM users WHERE id = ?", id);
  return result.changes === 1;
}
