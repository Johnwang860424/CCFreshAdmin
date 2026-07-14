import { describe, expect, it } from "vitest";
import { extractPublicId } from "./cloudinary";

describe("extractPublicId", () => {
  it("解析 Cloudinary 標準 /upload/ 網址（含版本段）", () => {
    expect(
      extractPublicId(
        "https://res.cloudinary.com/demo/image/upload/v1718000000/CC/abc123.jpg",
      ),
    ).toBe("CC/abc123");
  });

  it("解析無版本段的網址", () => {
    expect(
      extractPublicId("https://res.cloudinary.com/demo/image/upload/CC/xyz.webp"),
    ).toBe("CC/xyz");
  });

  it("非標準網址回傳 null（呼叫端略過刪除）", () => {
    expect(extractPublicId("https://example.com/foo.jpg")).toBeNull();
    expect(extractPublicId("not-a-url")).toBeNull();
  });
});
