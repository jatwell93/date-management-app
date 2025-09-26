import request from "supertest";
import app from "../../src/index";
import { getDb } from "../../src/database";

// Mock the database connection
jest.mock("../../src/database", () => ({
  getDb: jest.fn(),
}));

describe("User API Integration Tests", () => {
  const mockDb = {
    run: jest.fn(),
    all: jest.fn(),
    get: jest.fn(),
  };

  beforeEach(() => {
    (getDb as jest.Mock).mockResolvedValue(mockDb);
    jest.clearAllMocks();
  });

  describe("POST /auth/login", () => {
    it("should login successfully with valid PIN", async () => {
      const mockUser = {
        id: 1,
        pin: "1234",
        role: "Manager",
        created_at: "2023-01-01",
        updated_at: "2023-01-01",
      };
      mockDb.get.mockResolvedValue(mockUser);

      const response = await request(app)
        .post("/auth/login")
        .send({ pin: "1234" })
        .expect(200);

      expect(response.body).toHaveProperty("token");
    });

    it("should return 401 for invalid PIN", async () => {
      mockDb.get.mockResolvedValue(undefined);

      await request(app)
        .post("/auth/login")
        .send({ pin: "wrongpin" })
        .expect(401);
    });
  });

  describe("GET /users (Manager only)", () => {
    it("should return 401 for unauthorized access", async () => {
      await request(app).get("/users").expect(401);
    });

    it("should return all users when accessed by manager", async () => {
      const mockUser = {
        id: 1,
        pin: "1234",
        role: "Manager",
        created_at: "2023-01-01",
        updated_at: "2023-01-01",
      };

      mockDb.get.mockResolvedValue(mockUser);
      mockDb.all.mockResolvedValue([
        {
          id: 1,
          pin: "1234",
          role: "Manager",
          created_at: "2023-01-01",
          updated_at: "2023-01-01",
        },
        {
          id: 2,
          pin: "5678",
          role: "Team Member",
          created_at: "2023-01-01",
          updated_at: "2023-01-01",
        },
      ]);

      // Mock authentication with a manager token
      const authResponse = await request(app)
        .post("/auth/login")
        .send({ pin: "1234" });

      const token = authResponse.body.token;

      const response = await request(app)
        .get("/users")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(2);
    });
  });

  describe("POST /users (Manager only)", () => {
    it("should create a new user when accessed by manager", async () => {
      const mockUser = {
        id: 1,
        pin: "1234",
        role: "Manager",
        created_at: "2023-01-01",
        updated_at: "2023-01-01",
      };

      mockDb.get.mockResolvedValue(mockUser);
      mockDb.run.mockResolvedValue({ lastID: 2 });

      const authResponse = await request(app)
        .post("/auth/login")
        .send({ pin: "1234" });

      const token = authResponse.body.token;

      const response = await request(app)
        .post("/users")
        .set("Authorization", `Bearer ${token}`)
        .send({ pin: "5678", role: "Team Member" })
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body.role).toBe("Team Member");
    });
  });

  describe("PUT /users/:id (Manager only)", () => {
    it("should update a user when accessed by manager", async () => {
      const mockUser = {
        id: 1,
        pin: "1234",
        role: "Manager",
        created_at: "2023-01-01",
        updated_at: "2023-01-01",
      };

      mockDb.get.mockResolvedValue(mockUser);
      mockDb.run.mockResolvedValue({ changes: 1 });
      mockDb.get.mockResolvedValueOnce(mockUser);
      mockDb.get.mockResolvedValueOnce({
        id: 2,
        pin: "5678",
        role: "Updated Team Member",
        created_at: "2023-01-01",
        updated_at: "2023-01-01",
      });

      const authResponse = await request(app)
        .post("/auth/login")
        .send({ pin: "1234" });

      const token = authResponse.body.token;

      const response = await request(app)
        .put("/users/2")
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "Updated Team Member" })
        .expect(200);

      expect(response.body.role).toBe("Updated Team Member");
    });
  });

  describe("DELETE /users/:id (Manager only)", () => {
    it("should delete a user when accessed by manager", async () => {
      const mockUser = {
        id: 1,
        pin: "1234",
        role: "Manager",
        created_at: "2023-01-01",
        updated_at: "2023-01-01",
      };

      mockDb.get.mockResolvedValue(mockUser);
      mockDb.run.mockResolvedValue({ changes: 1 });

      const authResponse = await request(app)
        .post("/auth/login")
        .send({ pin: "1234" });

      const token = authResponse.body.token;

      await request(app)
        .delete("/users/2")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
    });
  });
});
