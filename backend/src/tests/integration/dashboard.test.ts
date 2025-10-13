import request from "supertest";
import app from "../../index";
import express from "express";
app.use(express.json());

describe('"Manager Dashboard" Integration Scenario', () => {
  it("should allow a manager to view the dashboard", async () => {
    // Step 1: Log in as a manager (simulate by getting a token)
    const loginResponse = await request(app)
      .post("/auth/login")
      .send({ pin: "5624" }); // Default manager PIN

    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.token;
    expect(token).toBeDefined();

    // Step 2: Request the dashboard data
    const dashboardResponse = await request(app)
      .get("/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body).toHaveProperty("markdown_next_month_value");
    expect(dashboardResponse.body).toHaveProperty("top_5_markdown_items");
    expect(dashboardResponse.body).toHaveProperty("areas_not_checked_30_days");
  });
});
