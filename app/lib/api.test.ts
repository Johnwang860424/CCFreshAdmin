import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));

vi.mock("@/auth", () => ({
  auth: authMock,
  isAllowedEmail: vi.fn(() => true),
}));

import { jsonHandler, readJson } from "@/app/lib/api";

describe("JSON route boundary", () => {
  beforeEach(() => {
    authMock.mockResolvedValue({
      user: { email: "admin@example.com" },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });
  });

  it("returns 400 for malformed JSON", async () => {
    const handler = jsonHandler(async (request: Request) => {
      await readJson(request);
      return { success: true };
    });
    const response = await handler(
      new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      undefined,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON body",
    });
  });
});
