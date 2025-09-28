import { AuthService } from "../services/auth.service";
import { getDb } from "../database";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

// Mock the database module
jest.mock("../database", () => ({
  getDb: jest.fn(),
}));

// Mock the jsonwebtoken module
jest.mock("jsonwebtoken", () => ({
  sign: jest.fn(),
}));

// Mock the bcrypt module
jest.mock("bcrypt", () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe("AuthService", () => {
  let authService: AuthService;
  interface MockDatabase {
    get: jest.Mock;
    run?: jest.Mock;
    all?: jest.Mock;
  }
  let mockDb: MockDatabase;

  beforeEach(() => {
    authService = new AuthService();
    mockDb = {
      get: jest.fn(),
    };
    (getDb as jest.Mock).mockResolvedValue(mockDb);
    (jwt.sign as jest.Mock).mockReturnValue("mock_jwt_token");
    (bcrypt.hash as jest.Mock).mockResolvedValue("hashed_pin");
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should return a JWT token on successful login", async () => {
    mockDb.get.mockResolvedValue({ id: 1, pin: "hashed_pin", role: "Manager" });

    const token = await authService.login("1234");

    expect(token).toBe("mock_jwt_token");
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(mockDb.get).toHaveBeenCalledWith(
      "SELECT * FROM users WHERE pin = ?",
      "1234",
    );
    expect(jwt.sign).toHaveBeenCalledWith(
      { userId: 1, role: "Manager" },
      expect.any(String),
      { expiresIn: "1h" },
    );
  });

  it("should return null for invalid PIN", async () => {
    mockDb.get.mockResolvedValue(undefined);

    const token = await authService.login("wrong_pin");

    expect(token).toBeNull();
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(mockDb.get).toHaveBeenCalledWith(
      "SELECT * FROM users WHERE pin = ?",
      "wrong_pin",
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
