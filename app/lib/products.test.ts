import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock("@/app/lib/db", () => ({
  sql: sqlMock,
}));

import { deleteProduct, updateProduct } from "@/app/lib/products";

describe("product writes", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("updates product details and images in one SQL statement", async () => {
    sqlMock.mockResolvedValue([{ product_id: 1 }]);

    const updated = await updateProduct(
      1,
      "A1",
      100,
      ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      2,
      null,
      null,
      null,
      null,
      5,
    );

    expect(updated).toBe(true);
    expect(sqlMock).toHaveBeenCalledTimes(1);
    const query = sqlMock.mock.calls[0][0].join(" ");
    expect(query).toContain("WITH updated_product AS");
    expect(query).toContain("deleted_images AS");
    expect(query).toContain("INSERT INTO product_images");
  });

  it("reports a missing product on delete", async () => {
    sqlMock.mockResolvedValue([]);

    await expect(deleteProduct(999)).resolves.toBe(false);
  });
});
