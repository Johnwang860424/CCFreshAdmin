import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  isAllowedEmail: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

import { auth } from "@/auth";
import { revalidateTag } from "next/cache";
import { POST } from "@/app/api/revalidate/route";

function request(body: string, token = "shared-secret") {
  return new Request("http://localhost/api/revalidate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body,
  });
}

describe("POST /api/revalidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_SECRET_TOKEN", "shared-secret");
  });

  it("accepts the shared Bearer token without an admin session", async () => {
    const response = await POST(request(JSON.stringify({ tag: "products" })));

    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith("products", { expire: 0 });
    expect(auth).not.toHaveBeenCalled();
  });

  it("rejects an invalid token", async () => {
    const response = await POST(
      request(JSON.stringify({ tag: "products" }), "wrong"),
    );

    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await POST(request("{"));

    expect(response.status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
