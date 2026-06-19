import { sql } from "@/app/lib/db";

export interface OrderItemRow {
  id: number;
  orderId: number;
  productName: string;
  unitPrice: number;
  quantity: number;
}

export interface OrderRow {
  id: number;
  customerName: string;
  phone: string | null;
  pickupLabel: string | null;
  status: string;
  note: string | null;
  total: number;
  createdAt: string;
  items: OrderItemRow[];
}

/** 取得所有訂單（含明細），按建立時間降冪排列 */
export async function getOrders(): Promise<OrderRow[]> {
  const orderRows = await sql`
    SELECT id, customer_name, phone, pickup_label, status, note, total, created_at
    FROM orders
    ORDER BY created_at DESC
  `;

  const itemRows = await sql`
    SELECT id, order_id, product_name, unit_price, quantity
    FROM order_items
    ORDER BY id
  `;

  const itemsByOrderId = new Map<number, OrderItemRow[]>();
  for (const r of itemRows) {
    const orderId = r.order_id as number;
    const item: OrderItemRow = {
      id: r.id as number,
      orderId,
      productName: r.product_name as string,
      unitPrice: r.unit_price as number,
      quantity: r.quantity as number,
    };
    if (!itemsByOrderId.has(orderId)) {
      itemsByOrderId.set(orderId, []);
    }
    itemsByOrderId.get(orderId)!.push(item);
  }

  return orderRows.map((r) => ({
    id: r.id as number,
    customerName: r.customer_name as string,
    phone: (r.phone as string) ?? null,
    pickupLabel: (r.pickup_label as string) ?? null,
    status: r.status as string,
    note: (r.note as string) ?? null,
    total: r.total as number,
    createdAt: (r.created_at as string),
    items: itemsByOrderId.get(r.id as number) ?? [],
  }));
}

/** 刪除全部訂單（order_items 由 ON DELETE CASCADE 自動清除） */
export async function deleteAllOrders() {
  await sql`DELETE FROM orders`;
}
