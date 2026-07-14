// 訂單資料形狀與「DB 列 → OrderRow」組裝邏輯：純函式、框架/DB 無關。
// SQL 查詢在 app/lib/orders.ts；此處只負責把訂單列與明細列組回巢狀結構。
import type { PromoConfig } from "@/app/lib/promotions";

export interface OrderItemRow {
  id: number;
  orderId: number;
  /** 商品可能已被刪除；保留 null 讓歷史訂單仍可顯示。 */
  productId: number | null;
  productName: string;
  unitPrice: number;
  quantity: number;
  /** 下單當下的促銷快照（NULL = 無促銷） */
  promoType: string | null;
  promoConfig: PromoConfig | null;
  /** 折扣後的實付小計，可能不等於 unitPrice × quantity */
  subtotal: number;
}

export interface OrderRow {
  id: number;
  customerName: string;
  phone: string | null;
  deliveryMethod: string;
  /** 自取點 id（宅配為 null） */
  pickupSpotId: number | null;
  /** 自取點顯示名稱（縣市 + 鄉鎮），由 pickup_spots 即時關聯而來；宅配或取貨點已刪除為 null */
  pickupSpotLabel: string | null;
  /** 自取點縣市（不含鄉鎮）；宅配或取貨點已刪除為 null。供匯出時依縣市分頁使用。 */
  pickupSpotCity: string | null;
  /** 自取點鄉鎮（不含縣市）；宅配或取貨點已刪除為 null */
  pickupSpotTownship: string | null;
  /** 所屬路線 id（經取貨點關聯）；宅配、未分路線或取貨點已刪除為 null */
  routeId: number | null;
  /** 所屬路線名稱；宅配、未分路線或取貨點已刪除為 null */
  routeName: string | null;
  /** 所屬站點代碼（JOIN pickup_spots.code 即時取得，管理員可改）；宅配為 null */
  spotCode: string | null;
  /**
   * 現場取貨號碼牌的數字部分（每取貨點各自遞增；宅配走自己的序列）。
   * 顯示時由 app/lib/pickup-code.ts 組成「站點代碼＋流水號」（如 A5）；DB 只存整數。
   */
  pickupNumber: number | null;
  shippingAddress: string | null;
  note: string | null;
  total: number;
  /** 來源標籤：網站（預設）/ FB / Line */
  tag: string;
  createdAt: string;
  items: OrderItemRow[];
}

/** 將訂單列與明細列（snake_case 的 DB 原始列）組裝成 OrderRow（明細掛回各自訂單） */
export function assembleOrders(
  orderRows: Record<string, unknown>[],
  itemRows: Record<string, unknown>[],
): OrderRow[] {
  const itemsByOrderId = new Map<number, OrderItemRow[]>();
  for (const r of itemRows) {
    const orderId = r.order_id as number;
    const item: OrderItemRow = {
      id: r.id as number,
      orderId,
      productId: (r.product_id as number) ?? null,
      productName: r.product_name as string,
      unitPrice: r.unit_price as number,
      quantity: r.quantity as number,
      promoType: (r.promo_type as string) ?? null,
      promoConfig: (r.promo_config as PromoConfig) ?? null,
      subtotal: r.subtotal as number,
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
    deliveryMethod: r.delivery_method as string,
    pickupSpotId: (r.pickup_spot_id as number) ?? null,
    pickupSpotLabel: (r.pickup_spot_label as string) ?? null,
    pickupSpotCity: (r.pickup_spot_city as string) ?? null,
    pickupSpotTownship: (r.pickup_spot_township as string) ?? null,
    routeId: (r.route_id as number) ?? null,
    routeName: (r.route_name as string) ?? null,
    spotCode: (r.spot_code as string) ?? null,
    pickupNumber: (r.pickup_number as number) ?? null,
    shippingAddress: (r.shipping_address as string) ?? null,
    note: (r.note as string) ?? null,
    total: r.total as number,
    tag: (r.tag as string) ?? "網站",
    createdAt: r.created_at as string,
    items: itemsByOrderId.get(r.id as number) ?? [],
  }));
}
