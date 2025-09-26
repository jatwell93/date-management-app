import {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUserByPin,
} from "../../src/services/user.service";
import { getDb } from "../../src/database";

// Mock the database connection
jest.mock("../../src/database", () => ({
  getDb: jest.fn(),
}));

describe("User Service", () => {
  const mockDb = {
    run: jest.fn(),
    all: jest.fn(),
    get: jest.fn(),
  };

  beforeEach(() => {
    (getDb as jest.Mock).mockResolvedValue(mockDb);
    jest.clearAllMocks();
  });

  describe("createUser", () => {
    it("should create a user successfully", async () => {
      const mockUser = { pin: "1234", role: "Manager" };
      const mockResult = { lastID: 1 };
      mockDb.run.mockResolvedValue(mockResult);

      const result = await createUser(mockUser);

      expect(mockDb.run).toHaveBeenCalledWith(
        "INSERT INTO users (pin, role) VALUES (?, ?)",
        mockUser.pin,
        mockUser.role,
      );
      expect(result).toEqual({ id: 1, ...mockUser });
    });
  });

  describe("getUsers", () => {
    it("should get all users successfully", async () => {
      const mockUsers = [
        {
          id: 1,
          pin: "1234",
          role: "Manager",
          created_at: "2023-01-01",
          updated_at: "2023-01-01",
        },
      ];
      mockDb.all.mockResolvedValue(mockUsers);

      const result = await getUsers();

      expect(mockDb.all).toHaveBeenCalledWith("SELECT * FROM users");
      expect(result).toEqual(mockUsers);
    });
  });

  describe("getUserById", () => {
    it("should get a user by ID successfully", async () => {
      const mockUser = {
        id: 1,
        pin: "1234",
        role: "Manager",
        created_at: "2023-01-01",
        updated_at: "2023-01-01",
      };
      mockDb.get.mockResolvedValue(mockUser);

      const result = await getUserById(1);

      expect(mockDb.get).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = ?",
        1,
      );
      expect(result).toEqual(mockUser);
    });

    it("should return undefined when user is not found", async () => {
      mockDb.get.mockResolvedValue(undefined);

      const result = await getUserById(999);

      expect(mockDb.get).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = ?",
        999,
      );
      expect(result).toBeUndefined();
    });
  });

  describe("getUserByPin", () => {
    it("should get a user by PIN successfully", async () => {
      const mockUser = {
        id: 1,
        pin: "1234",
        role: "Manager",
        created_at: "2023-01-01",
        updated_at: "2023-01-01",
      };
      mockDb.get.mockResolvedValue(mockUser);

      const result = await getUserByPin("1234");

      expect(mockDb.get).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE pin = ?",
        "1234",
      );
      expect(result).toEqual(mockUser);
    });

    it("should return undefined when user is not found", async () => {
      mockDb.get.mockResolvedValue(undefined);

      const result = await getUserByPin("9999");

      expect(mockDb.get).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE pin = ?",
        "9999",
      );
      expect(result).toBeUndefined();
    });
  });

  describe("updateUser", () => {
    it("should update a user successfully", async () => {
      mockDb.run.mockResolvedValue({ changes: 1 });

      const result = await updateUser(1, { role: "Team Member" });

      expect(mockDb.run).toHaveBeenCalledWith(
        "UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        "Team Member",
        1,
      );
      expect(result).toBe(true);
    });

    it("should return false when user is not found", async () => {
      mockDb.run.mockResolvedValue({ changes: 0 });

      const result = await updateUser(999, { role: "Team Member" });

      expect(result).toBe(false);
    });
  });

  describe("deleteUser", () => {
    it("should delete a user successfully", async () => {
      mockDb.run.mockResolvedValue({ changes: 1 });

      const result = await deleteUser(1);

      expect(mockDb.run).toHaveBeenCalledWith(
        "DELETE FROM users WHERE id = ?",
        1,
      );
      expect(result).toBe(true);
    });

    it("should return false when user is not found", async () => {
      mockDb.run.mockResolvedValue({ changes: 0 });

      const result = await deleteUser(999);

      expect(result).toBe(false);
    });
  });
});
