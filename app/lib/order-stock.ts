import { sql } from "@/app/lib/db";
import { stockInsufficiencyMessage } from "@/app/domain/stock";
import { OrderInputError } from "@/app/lib/order-errors";

/**
 * 對照「每商品需求量」與目前剩餘庫存，組「庫存不足」錯誤；全部足夠回 null。
 * 訊息組字（SC-003 契約）在 app/domain/stock.ts。
 */
export function stockErrorFromRows(
  rows: { id: number; name: string; stock: number | null }[],
  wantedByProductId: Map<number, number>,
): OrderInputError | null {
  const message = stockInsufficiencyMessage(rows, wantedByProductId);
  return message !== null ? new OrderInputError(message) : null;
}

/**
 * 23514 競態後援：預檢通過但寫入時庫存被併發搶走。重查目前庫存組同款訊息；
 * 若重查已無不足（庫存又變動），給通用訊息請使用者重試。
 */
export async function buildStockInsufficientError(
  wantedByProductId: Map<number, number>,
): Promise<OrderInputError> {
  const ids = [...wantedByProductId.keys()];
  const rows = (await sql`
    SELECT id, name, stock FROM products WHERE id = ANY(${ids})
  `) as { id: number; name: string; stock: number | null }[];
  return (
    stockErrorFromRows(rows, wantedByProductId) ??
    new OrderInputError("部分商品庫存不足，請重新整理後再試")
  );
}

/** 是否為庫存非負約束違反（SQLSTATE 23514 + 具名 CHECK products_stock_nonneg）。 */
export function isStockCheckViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === "23514" && e?.constraint === "products_stock_nonneg";
}
