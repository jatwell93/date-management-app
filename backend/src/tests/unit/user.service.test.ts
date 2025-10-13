import {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUserByPin,
} from "../../services/user.service";
import { getDb } from "../../database";
import { AuthService } from "../../services/auth.service";

// Mock the database connection
jest.mock("../../database", () => ({
  getDb: jest.fn(),
}));

describe("User Service", () => {
  const mockStatement = {
    run: jest.fn(),
    all: jest.fn(),
    get: jest.fn(),
  };
  const mockDb = {
    prepare: jest.fn(() => mockStatement),
  };

  beforeEach(() => {
    (getDb as jest.Mock).mockResolvedValue(mockDb);
    jest.clearAllMocks();
  });

  describe("createUser", () => {
    it("should create a user successfully", async () => {
      const mockUser = { pin: "123456", role: "Manager" as const };
      const mockResult = { lastInsertRowid: 1 };
      mockStatement.run.mockReturnValue(mockResult);
      const validatePinSpy = jest.spyOn(AuthService.prototype, 'validatePin').mockReturnValue({ isValid: true });
      const hashPinSpy = jest.spyOn(AuthService.prototype, 'hashPin').mockResolvedValue("hashed_pin");

      const result = await createUser(mockUser);

      expect(validatePinSpy).toHaveBeenCalledWith(mockUser.pin);
      expect(hashPinSpy).toHaveBeenCalledWith(mockUser.pin);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        "INSERT INTO users (pin, role) VALUES (?, ?)"
      );
      expect(mockStatement.run).toHaveBeenCalledWith("hashed_pin", mockUser.role);
      expect(result).toEqual({ id: 1, ...mockUser, pin: "hashed_pin" });
    });
  });

  describe("getUsers", () => {
    it("should get all users successfully", async () => {
      const mockUsers = [
        {
          id: 1,
          pin: "hashed_pin",
          role: "Manager" as const,
          created_at: "2023-01-01",
          updated_at: "2023-01-01",
        },
      ];
      mockStatement.all.mockReturnValue(mockUsers);

      const result = await getUsers();

      expect(mockDb.prepare).toHaveBeenCalledWith("SELECT * FROM users");
      expect(mockStatement.all).toHaveBeenCalledWith();
      expect(result).toEqual(mockUsers);
    });
  });

  describe("getUserById", () => {
    it("should get a user by ID successfully", async () => {
      const mockUser = {
        id: 1,
        pin: "hashed_pin",
        role: "Manager" as const,
        created_at: "2023-01-01",
        updated_at: "2023-01-01",
      };
      mockStatement.get.mockReturnValue(mockUser);

      const result = await getUserById(1);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = ?"
      );
      expect(mockStatement.get).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockUser);
    });

    it("should return undefined when user is not found", async () => {
      mockStatement.get.mockReturnValue(undefined);

      const result = await getUserById(999);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        "SELECT * FROM users WHERE id = ?"
      );
      expect(mockStatement.get).toHaveBeenCalledWith(999);
      expect(result).toBeUndefined();
    });
  });

  describe("getUserByPin", () => {
    it("should get a user by PIN successfully", async () => {
      const mockUsers = [
        {
          id: 1,
          pin: "hashed_pin",
          role: "Manager" as const,
          created_at: "2023-01-01",
          updated_at: "2023-01-01",
        },
      ];
      mockStatement.all.mockReturnValue(mockUsers);
      const verifyPinSpy = jest.spyOn(AuthService.prototype, 'verifyPin').mockResolvedValue(true);

      const result = await getUserByPin("123456");

      expect(mockDb.prepare).toHaveBeenCalledWith("SELECT * FROM users");
      expect(mockStatement.all).toHaveBeenCalledWith();
      expect(verifyPinSpy).toHaveBeenCalledWith("123456", "hashed_pin");
      expect(result).toEqual(mockUsers[0]);
    });

    it("should return undefined when user is not found", async () => {
      mockStatement.all.mockReturnValue([]);

      const result = await getUserByPin("9999");

      expect(mockDb.prepare).toHaveBeenCalledWith("SELECT * FROM users");
      expect(mockStatement.all).toHaveBeenCalledWith();
      expect(result).toBeUndefined();
    });
  });

  describe("updateUser", () => {
    it("should update a user successfully", async () => {
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = await updateUser(1, { role: "Team Member" });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        "UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      );
      expect(mockStatement.run).toHaveBeenCalledWith("Team Member", 1);
      expect(result).toBe(true);
    });

    it("should return false when user is not found", async () => {
      mockStatement.run.mockReturnValue({ changes: 0 });

      const result = await updateUser(999, { role: "Team Member" });

      expect(result).toBe(false);
    });
  });

  describe("deleteUser", () => {
    it("should delete a user successfully", async () => {
      mockStatement.run.mockReturnValue({ changes: 1 });

      const result = await deleteUser(1);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        "DELETE FROM users WHERE id = ?"
      );
      expect(mockStatement.run).toHaveBeenCalledWith(1);
      expect(result).toBe(true);
    });

    it("should return false when user is not found", async () => {
      mockStatement.run.mockReturnValue({ changes: 0 });

      const result = await deleteUser(999);

      expect(result).toBe(false);
    });
  });
});
