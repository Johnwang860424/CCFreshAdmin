import { sql } from "@/app/lib/db";
import { OrderInputError } from "@/app/lib/order-errors";
import {
  buildStockInsufficientError,
  isStockCheckViolation,
  stockErrorFromRows,
} from "@/app/lib/order-stock";
import { calcLineSubtotal, type PromoConfig } from "@/app/lib/promotions";
import type {
  ValidatedBatchOrderAdjustment,
  ValidatedCreateOrder,
  ValidatedUpdateOrderItem,
} from "@/app/lib/validation";
import { assembleOrders, type OrderRow } from "@/app/domain/order-assembly";

/**
 * 依訂單 id 清單刪除訂單（order_items 由 ON DELETE CASCADE 一併清除），供「選取出貨」使用。
 * 單一語句原子；回傳實際刪除筆數（清單中已消失的 id 自然不計入，FR-010）。
 */
export async function deleteOrdersByIds(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await sql`
    DELETE FROM orders WHERE id = ANY(${ids}) RETURNING id
  `;
  return rows.length;
}

/** 自取訂單指派取貨號碼撞唯一鍵時的重試上限。 */
const PICKUP_NUMBER_MAX_RETRY = 5;

interface ProductSnapshot {
  id: number;
  name: string;
  price: number;
  promo_type: string | null;
  promo_config: PromoConfig | null;
  /** 剩餘可售數量；NULL＝不限量（不追蹤庫存，不檢查不扣減）。 */
  stock: number | null;
}

/**
 * 計算新訂單所屬路線分組內、客戶姓名相同的既有訂單筆數（重複下單警示用，唯讀）。
 * - 自取：分組＝所選取貨點的 route_id（NULL＝未分路線，IS NOT DISTINCT FROM 比對）；
 *   取貨點不存在時 target 為空集合，回 0（錯誤留給 createOrder 的既有驗證回報）。
 * - 宅配：分組＝全部宅配訂單。
 * - 姓名以去頭尾空白後完全相符為準（輸入端與資料庫皆已 trim）。
 */
export async function countSameNameOrdersInGroup(
  input: Pick<
    ValidatedCreateOrder,
    "customerName" | "deliveryMethod" | "pickupSpotId"
  >,
): Promise<number> {
  if (input.deliveryMethod === "delivery") {
    const rows = await sql`
      SELECT COUNT(*)::int AS count
      FROM orders o
      WHERE o.delivery_method = 'delivery'
        AND o.customer_name = ${input.customerName}
    `;
    return rows[0].count as number;
  }

  const rows = await sql`
    WITH target AS (SELECT route_id FROM pickup_spots WHERE id = ${input.pickupSpotId})
    SELECT COUNT(*)::int AS count
    FROM orders o
    JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    CROSS JOIN target t
    WHERE o.delivery_method = 'pickup'
      AND ps.route_id IS NOT DISTINCT FROM t.route_id
      AND o.customer_name = ${input.customerName}
  `;
  return (rows[0]?.count as number) ?? 0;
}

/**
 * 後台手動建立一筆訂單（含明細）。
 * - 明細的單價/促銷/小計一律以商品「目前」資料快照計算（calcLineSubtotal），不採信前端金額。
 * - 依既有約定指派 pickup_number（自取每取貨點各自遞增；宅配於 pickup_spot_id IS NULL 作用域遞增），撞唯一鍵時重試。
 * - 以單一 CTE SQL 語句原子寫入 orders 與 order_items（Neon HTTP 無互動式交易）。
 * 回傳新訂單 id。
 */
export async function createOrder(input: ValidatedCreateOrder): Promise<number> {
  const productIds = input.items.map((i) => i.productId);

  const products = (await sql`
    SELECT id, name, price, promo_type, promo_config, stock
    FROM products
    WHERE id = ANY(${productIds})
  `) as ProductSnapshot[];

  const byId = new Map(products.map((p) => [p.id, p]));
  for (const it of input.items) {
    if (!byId.has(it.productId)) {
      throw new OrderInputError("部分商品不存在，請重新選擇");
    }
  }

  // 每商品需求量（validateCreateOrderBody 已合併重複商品，一商品恰一列）。
  // 預檢負責友善訊息（含商品名與剩餘量）；正確性由寫入語句內的原子扣減＋
  // DB CHECK 最終防線保證（見 insertOnce 的 dec CTE）。
  const wantedByProductId = new Map(
    input.items.map((it) => [it.productId, it.quantity]),
  );
  const stockError = stockErrorFromRows(products, wantedByProductId);
  if (stockError) throw stockError;

  if (input.deliveryMethod === "pickup") {
    const spot = await sql`
      SELECT id FROM pickup_spots WHERE id = ${input.pickupSpotId}
    `;
    if (spot.length === 0) {
      throw new OrderInputError("選定的取貨點不存在，請重新選擇");
    }
  }

  // 依商品目前單價＋促銷計算各項小計與總額，並備好寫入用的快照欄位。
  const lineItems = input.items.map((it) => {
    const p = byId.get(it.productId)!;
    const promoType = p.promo_type ?? null;
    const promoConfig = p.promo_config ?? null;
    const promo =
      promoType && promoConfig ? { type: promoType, config: promoConfig } : null;
    return {
      productId: it.productId,
      productName: p.name,
      unitPrice: p.price,
      quantity: it.quantity,
      promoType,
      promoConfig,
      subtotal: calcLineSubtotal(promo, p.price, it.quantity),
    };
  });
  const total = lineItems.reduce((sum, li) => sum + li.subtotal, 0);

  // unnest 用的平行陣列（promo_config 以 text[] 傳入，於 SELECT 時逐筆轉 jsonb）。
  const productIdArr = lineItems.map((li) => li.productId);
  const productNameArr = lineItems.map((li) => li.productName);
  const unitPriceArr = lineItems.map((li) => li.unitPrice);
  const quantityArr = lineItems.map((li) => li.quantity);
  const promoTypeArr = lineItems.map((li) => li.promoType);
  const promoConfigArr = lineItems.map((li) =>
    li.promoConfig === null ? null : JSON.stringify(li.promoConfig),
  );
  const subtotalArr = lineItems.map((li) => li.subtotal);

  const insertOnce = async (pickupNumber: number): Promise<number> => {
    const rows = await sql`
      WITH new_order AS (
        INSERT INTO orders (
          customer_name, phone, delivery_method, pickup_spot_id,
          pickup_number, shipping_address, note, total, tag
        )
        VALUES (
          ${input.customerName}, ${input.phone}, ${input.deliveryMethod},
          ${input.pickupSpotId}, ${pickupNumber}, ${input.shippingAddress},
          ${input.note}, ${total}, ${input.tag}
        )
        RETURNING id
      ),
      dec AS (
        -- 與訂單/明細同句原子扣減庫存（每商品一列，驗證層已合併重複商品）。
        -- 不限量（stock IS NULL）不扣；扣到負值違反 products_stock_nonneg
        -- CHECK，整句失敗＝零部分效果；併發由 UPDATE 行鎖序列化，永不超賣。
        UPDATE products p
        SET stock = p.stock - t.qty
        FROM unnest(
          ${productIdArr}::int[],
          ${quantityArr}::int[]
        ) AS t(product_id, qty)
        WHERE p.id = t.product_id AND p.stock IS NOT NULL
      )
      INSERT INTO order_items (
        order_id, product_id, product_name, unit_price, quantity,
        promo_type, promo_config, subtotal
      )
      SELECT new_order.id, t.product_id, t.product_name, t.unit_price, t.quantity,
             t.promo_type, t.promo_config::jsonb, t.subtotal
      FROM new_order, unnest(
        ${productIdArr}::int[],
        ${productNameArr}::text[],
        ${unitPriceArr}::int[],
        ${quantityArr}::int[],
        ${promoTypeArr}::text[],
        ${promoConfigArr}::text[],
        ${subtotalArr}::int[]
      ) AS t(product_id, product_name, unit_price, quantity,
             promo_type, promo_config, subtotal)
      RETURNING order_id
    `;
    return rows[0].order_id as number;
  };

  const spotId = input.deliveryMethod === "pickup" ? input.pickupSpotId : null;

  // 自取或宅配：取下一個號碼牌；撞唯一鍵 (pickup_spot_id, pickup_number) 時重算重試。
  for (let attempt = 0; attempt < PICKUP_NUMBER_MAX_RETRY; attempt++) {
    const [{ next }] = (await (spotId !== null
      ? sql`
          SELECT COALESCE(MAX(pickup_number), 0) + 1 AS next
          FROM orders
          WHERE pickup_spot_id = ${spotId}
        `
      : sql`
          SELECT COALESCE(MAX(pickup_number), 0) + 1 AS next
          FROM orders
          WHERE pickup_spot_id IS NULL
        `)) as { next: number }[];
    try {
      return await insertOnce(next);
    } catch (err) {
      // 23505 = unique_violation：號碼被搶走，重算再試。
      if ((err as { code?: string })?.code === "23505") continue;
      // 庫存 CHECK 違反＝預檢後被併發搶走：重查剩餘量組友善訊息，不重試。
      if (isStockCheckViolation(err)) {
        throw await buildStockInsufficientError(wantedByProductId);
      }
      throw err;
    }
  }
  throw new OrderInputError("取貨號碼指派衝突，請稍後再試");
}

/** 取得單筆訂單（含明細）；不存在回 null。供編輯後回應與內部重載使用。 */
export async function getOrderById(id: number): Promise<OrderRow | null> {
  const orderRows = await sql`
    SELECT o.id, o.customer_name, o.phone, o.delivery_method, o.pickup_spot_id,
           o.pickup_number, o.shipping_address, o.note, o.total, o.tag, o.created_at,
           CASE
             WHEN ps.id IS NOT NULL THEN ps.city || ' ' || ps.township
             ELSE NULL
           END AS pickup_spot_label,
           ps.township AS pickup_spot_township,
           ps.route_id AS route_id,
           r.name AS route_name,
           ps.code AS spot_code
    FROM orders o
    LEFT JOIN pickup_spots ps ON ps.id = o.pickup_spot_id
    LEFT JOIN routes r ON r.id = ps.route_id
    WHERE o.id = ${id}
  `;
  if (orderRows.length === 0) return null;

  const itemRows = await sql`
    SELECT id, order_id, product_id, product_name, unit_price, quantity, promo_type, promo_config, subtotal
    FROM order_items
    WHERE order_id = ${id}
    ORDER BY id
  `;

  return assembleOrders(orderRows, itemRows)[0];
}

/** 修改訂單品項時，讀取既有明細快照所用的資料形狀（含 product_id 供保留列重寫）。 */
interface ExistingItemSnapshot {
  id: number;
  product_id: number | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  promo_type: string | null;
  promo_config: PromoConfig | null;
}

/**
 * 修改一筆訂單的商品明細（新增／移除／改數量）並重算總額。
 * - 帶 `id` 的列＝既有明細：保留其單價/促銷/商品快照，僅套用新數量並重算小計（FR-009）。
 * - 帶 `productId` 的列＝新增明細：以商品「目前」單價＋促銷建立快照計算小計（FR-008）。
 * - 未列出的既有明細＝移除。
 * 以單一 CTE 原子替換該訂單的 order_items 並更新 orders.total（Neon HTTP 無互動式交易）。
 * 訂單不存在（並發刪除/出貨）回 null；商品不存在或明細 id 不屬本訂單時拋 OrderInputError。
 */
export async function updateOrderItems(
  id: number,
  items: ValidatedUpdateOrderItem[],
): Promise<OrderRow | null> {
  const orderRows = await sql`SELECT id FROM orders WHERE id = ${id}`;
  if (orderRows.length === 0) return null;

  // 既有明細快照（含 product_id 供保留列重寫、quantity 供庫存淨差額計算）。
  const existingRows = (await sql`
    SELECT id, product_id, product_name, unit_price, quantity, promo_type, promo_config
    FROM order_items
    WHERE order_id = ${id}
  `) as ExistingItemSnapshot[];
  const existingById = new Map(existingRows.map((r) => [r.id, r]));

  // 新增列所需的商品現值快照。
  const newProductIds = items
    .filter((it) => it.productId !== undefined)
    .map((it) => it.productId!);
  const products =
    newProductIds.length > 0
      ? ((await sql`
          SELECT id, name, price, promo_type, promo_config
          FROM products
          WHERE id = ANY(${newProductIds})
        `) as ProductSnapshot[])
      : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const lineItems = items.map((it) => {
    if (it.id !== undefined) {
      const e = existingById.get(it.id);
      if (!e) throw new OrderInputError("明細資料錯誤，請重新載入");
      const promo =
        e.promo_type && e.promo_config
          ? { type: e.promo_type, config: e.promo_config }
          : null;
      return {
        productId: e.product_id,
        productName: e.product_name,
        unitPrice: e.unit_price,
        quantity: it.quantity,
        promoType: e.promo_type,
        promoConfig: e.promo_config,
        subtotal: calcLineSubtotal(promo, e.unit_price, it.quantity),
      };
    }
    const p = productById.get(it.productId!);
    if (!p) throw new OrderInputError("部分商品不存在，請重新選擇");
    const promo =
      p.promo_type && p.promo_config
        ? { type: p.promo_type, config: p.promo_config }
        : null;
    return {
      productId: p.id,
      productName: p.name,
      unitPrice: p.price,
      quantity: it.quantity,
      promoType: p.promo_type,
      promoConfig: p.promo_config,
      subtotal: calcLineSubtotal(promo, p.price, it.quantity),
    };
  });

  const total = lineItems.reduce((sum, li) => sum + li.subtotal, 0);

  // 庫存淨差額（FR-007）：每商品 delta = 新合計 − 舊合計（正＝需再扣、負＝回補）。
  // product_id 為 NULL 的明細列（商品已刪除）無庫存可調，自然略過。
  const oldQtyByProductId = new Map<number, number>();
  for (const r of existingRows) {
    if (r.product_id !== null) {
      oldQtyByProductId.set(
        r.product_id,
        (oldQtyByProductId.get(r.product_id) ?? 0) + r.quantity,
      );
    }
  }
  const newQtyByProductId = new Map<number, number>();
  for (const li of lineItems) {
    if (li.productId !== null) {
      newQtyByProductId.set(
        li.productId,
        (newQtyByProductId.get(li.productId) ?? 0) + li.quantity,
      );
    }
  }
  const deltaByProductId = new Map<number, number>();
  for (const [pid, qty] of newQtyByProductId) {
    const delta = qty - (oldQtyByProductId.get(pid) ?? 0);
    if (delta !== 0) deltaByProductId.set(pid, delta);
  }
  for (const [pid, qty] of oldQtyByProductId) {
    if (!newQtyByProductId.has(pid)) deltaByProductId.set(pid, -qty);
  }

  // 只就淨增量預檢（友善訊息含商品名與剩餘量）；正確性由寫入語句的 CHECK 最終防線保證。
  const increasedByProductId = new Map(
    [...deltaByProductId].filter(([, delta]) => delta > 0),
  );
  if (increasedByProductId.size > 0) {
    const stockRows = (await sql`
      SELECT id, name, stock
      FROM products
      WHERE id = ANY(${[...increasedByProductId.keys()]})
    `) as { id: number; name: string; stock: number | null }[];
    const stockError = stockErrorFromRows(stockRows, increasedByProductId);
    if (stockError) throw stockError;
  }

  // unnest 用的平行陣列（promo_config 以 text[] 傳入，於 SELECT 時逐筆轉 jsonb）。
  const productIdArr = lineItems.map((li) => li.productId);
  const productNameArr = lineItems.map((li) => li.productName);
  const unitPriceArr = lineItems.map((li) => li.unitPrice);
  const quantityArr = lineItems.map((li) => li.quantity);
  const promoTypeArr = lineItems.map((li) => li.promoType);
  const promoConfigArr = lineItems.map((li) =>
    li.promoConfig === null ? null : JSON.stringify(li.promoConfig),
  );
  const subtotalArr = lineItems.map((li) => li.subtotal);
  const deltaProductIdArr = [...deltaByProductId.keys()];
  const deltaArr = [...deltaByProductId.values()];

  // 單一語句原子替換：del/ins/adj 為資料變更 CTE（即使未被主查詢參照仍會執行），
  // 主查詢 UPDATE orders 回傳 id；訂單並發消失時回空列。
  let rows: Record<string, unknown>[];
  try {
    rows = await sql`
      WITH del AS (
        DELETE FROM order_items WHERE order_id = ${id}
      ),
      ins AS (
        INSERT INTO order_items (
          order_id, product_id, product_name, unit_price, quantity,
          promo_type, promo_config, subtotal
        )
        SELECT ${id}, t.product_id, t.product_name, t.unit_price, t.quantity,
               t.promo_type, t.promo_config::jsonb, t.subtotal
        FROM unnest(
          ${productIdArr}::int[],
          ${productNameArr}::text[],
          ${unitPriceArr}::int[],
          ${quantityArr}::int[],
          ${promoTypeArr}::text[],
          ${promoConfigArr}::text[],
          ${subtotalArr}::int[]
        ) AS t(product_id, product_name, unit_price, quantity,
               promo_type, promo_config, subtotal)
      ),
      adj AS (
        -- 庫存淨差額同句原子調整（正＝扣、負＝補；不限量不動）。扣到負值違反
        -- products_stock_nonneg CHECK，整次編輯失敗＝零部分效果。
        UPDATE products p
        SET stock = p.stock - t.delta
        FROM unnest(
          ${deltaProductIdArr}::int[],
          ${deltaArr}::int[]
        ) AS t(product_id, delta)
        WHERE p.id = t.product_id AND p.stock IS NOT NULL
      )
      UPDATE orders SET total = ${total} WHERE id = ${id} RETURNING id
    `;
  } catch (err) {
    // 庫存被併發搶走（預檢後）：重查剩餘量組友善訊息。
    if (isStockCheckViolation(err)) {
      throw await buildStockInsufficientError(increasedByProductId);
    }
    // 訂單在讀取後被併發刪除/出貨：ins 的 order_id FK 違反，視同訂單不存在（回 404）。
    const e = err as { code?: string; constraint?: string };
    if (e?.code === "23503" && e?.constraint === "order_items_order_id_fkey") {
      return null;
    }
    throw err;
  }
  if (rows.length === 0) return null;

  return getOrderById(id);
}

interface BatchAdjustmentSnapshot {
  id: number;
  unit_price: number;
  promo_type: string | null;
  promo_config: PromoConfig | null;
}

/** 缺貨專用批次減量：不異動庫存，數量為 0 的明細仍保留。 */
export async function batchAdjustOrderItems(
  input: ValidatedBatchOrderAdjustment,
): Promise<{ updatedItems: number; updatedOrders: number }> {
  const itemIds = input.changes.map((change) => change.orderItemId);
  const snapshotRows = (await sql`
    SELECT id, unit_price, promo_type, promo_config
    FROM order_items
    WHERE id = ANY(${itemIds})
  `) as BatchAdjustmentSnapshot[];
  const snapshotById = new Map(snapshotRows.map((row) => [row.id, row]));
  if (snapshotById.size !== itemIds.length) {
    throw new OrderInputError("部分訂單明細已變更，請重新整理後再試");
  }

  const orderIdArr = input.changes.map((change) => change.orderId);
  const expectedQuantityArr = input.changes.map((change) => change.expectedQuantity);
  const newQuantityArr = input.changes.map((change) => change.newQuantity);
  const newSubtotalArr = input.changes.map((change) => {
    const snapshot = snapshotById.get(change.orderItemId)!;
    const promo = snapshot.promo_type && snapshot.promo_config
      ? { type: snapshot.promo_type, config: snapshot.promo_config }
      : null;
    return calcLineSubtotal(promo, snapshot.unit_price, change.newQuantity);
  });
  const result = (await sql`
    WITH input AS (
      SELECT * FROM unnest(
        ${itemIds}::int[],
        ${orderIdArr}::int[],
        ${expectedQuantityArr}::int[],
        ${newQuantityArr}::int[],
        ${newSubtotalArr}::int[]
      ) AS t(item_id, order_id, expected_quantity, new_quantity, new_subtotal)
    ),
    target AS MATERIALIZED (
      SELECT i.*, oi.subtotal AS old_subtotal
      FROM input i
      JOIN order_items oi
        ON oi.id = i.item_id
       AND oi.order_id = i.order_id
       AND oi.product_id = ${input.productId}
       AND oi.quantity = i.expected_quantity
      JOIN orders o ON o.id = oi.order_id
      WHERE (
        ${input.method} = 'delivery' AND o.delivery_method = 'delivery'
      ) OR (
        ${input.method} = 'pickup'
        AND o.delivery_method = 'pickup'
        AND EXISTS (
          SELECT 1 FROM pickup_spots ps
          WHERE ps.id = o.pickup_spot_id
            AND ps.route_id IS NOT DISTINCT FROM ${input.routeId}
        )
      )
      FOR UPDATE OF oi
    ),
    valid AS (
      SELECT (SELECT COUNT(*) FROM target) = (SELECT COUNT(*) FROM input) AS ok
    ),
    updated AS (
      UPDATE order_items oi
      SET quantity = target.new_quantity,
          subtotal = target.new_subtotal
      FROM target, valid
      WHERE valid.ok AND oi.id = target.item_id
      RETURNING oi.order_id, target.old_subtotal, target.new_subtotal
    ),
    delta AS (
      SELECT order_id, SUM(new_subtotal - old_subtotal)::int AS amount
      FROM updated
      GROUP BY order_id
    ),
    updated_orders AS (
      UPDATE orders o
      SET total = o.total + delta.amount
      FROM delta
      WHERE o.id = delta.order_id
      RETURNING o.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM updated) AS updated_items,
      (SELECT COUNT(*)::int FROM updated_orders) AS updated_orders
  `) as { updated_items: number; updated_orders: number }[];

  const updatedItems = Number(result[0]?.updated_items ?? 0);
  if (updatedItems !== input.changes.length) {
    throw new OrderInputError("部分訂單明細已變更，請重新整理後再試");
  }
  return {
    updatedItems,
    updatedOrders: Number(result[0]?.updated_orders ?? 0),
  };
}

/**
 * 刪除單筆訂單（order_items 由 ON DELETE CASCADE 自動清除）並回補追蹤庫存
 * 品項的剩餘量；回傳是否確有刪到。
 * 單一 CTE 語句原子：WITH 各部分讀同一 snapshot，qty 讀到的是 CASCADE 清除前
 * 的 order_items，回補量因此正確（SC-004）。已刪商品（product_id NULL）與
 * 不限量商品（stock IS NULL）自然略過。
 * 注意：出貨路徑（deleteOrdersByIds／deleteOrdersByGroup）刻意不回補——
 * 出貨＝商品實際售出（憲章原則 V 的結算邊界）。
 */
export async function deleteOrder(id: number): Promise<boolean> {
  const rows = await sql`
    WITH del AS (
      DELETE FROM orders WHERE id = ${id} RETURNING id
    ),
    qty AS (
      SELECT oi.product_id, SUM(oi.quantity)::int AS q
      FROM order_items oi
      JOIN del ON del.id = oi.order_id
      WHERE oi.product_id IS NOT NULL
      GROUP BY oi.product_id
    ),
    restock AS (
      UPDATE products p
      SET stock = p.stock + qty.q
      FROM qty
      WHERE p.id = qty.product_id AND p.stock IS NOT NULL
    )
    SELECT id FROM del
  `;
  return rows.length > 0;
}

/**
 * 依「結單分組」刪除訂單（order_items 由 ON DELETE CASCADE 自動清除）。
 * - 宅配：刪除所有 delivery_method='delivery' 的訂單
 * - 自取（指定路線）：刪除該路線所有取貨點的 pickup 訂單
 * - 自取（未分路線 routeId=null）：刪除取貨點 route_id 為 NULL 者，及無取貨點（pickup_spot_id 為 NULL）的 pickup 訂單
 */
export async function deleteOrdersByGroup(
  method: string,
  routeId?: number | null,
) {
  if (method === "delivery") {
    await sql`DELETE FROM orders WHERE delivery_method = 'delivery'`;
    return;
  }

  if (routeId == null) {
    await sql`
      DELETE FROM orders
      WHERE delivery_method = 'pickup'
        AND (
          pickup_spot_id IS NULL
          OR pickup_spot_id IN (
            SELECT id FROM pickup_spots WHERE route_id IS NULL
          )
        )
    `;
  } else {
    await sql`
      DELETE FROM orders
      WHERE delivery_method = 'pickup'
        AND pickup_spot_id IN (
          SELECT id FROM pickup_spots WHERE route_id = ${routeId}
        )
    `;
  }
}
