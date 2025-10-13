import request from "supertest";
import app from "../../index";
import express from "express";
app.use(express.json());

describe('"Manager Report" Integration Scenario', () => {
  it("should allow a manager to generate a monthly markdown report", async () => {
    // Step 1: Log in as a manager (simulate by getting a token)
    const loginResponse = await request(app)
      .post("/auth/login")
      .send({ pin: "5624" }); // Default manager PIN

    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.token;
    expect(token).toBeDefined();

    // Step 2: Request the monthly markdown report
    const reportResponse = await request(app)
      .get("/reports/monthly-markdown")
      .set("Authorization", `Bearer ${token}`);

    expect(reportResponse.status).toBe(200);
    expect(reportResponse.headers["content-type"]).toEqual("application/pdf");
  });
});
