import request from "supertest";
import app from "../../index";

describe("POST /auth/login", () => {
  it("should respond with a 200 status code and a token for valid credentials", async () => {
    // This test will fail with a connection refused error until the server is running
    // and the endpoint is implemented. This is the correct TDD workflow.
    const response = await request(app)
      .post("/auth/login")
      .send({ pin: "5624" });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("token");
  });
});
