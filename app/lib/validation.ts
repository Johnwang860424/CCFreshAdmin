// 請求驗證工具：框架無關（不依賴 next / DOM），失敗回傳 { error: string }，
// 由 route 層以 badRequest()（app/lib/api.ts）轉為 400 回應。
import { validatePromo, type PromoConfig } from "@/app/lib/promotions";
import { MAX_PRODUCT_IMAGES } from "@/app/lib/product-constants";

/** 後端文字欄位的最大長度限制，避免超長字串造成 DB 壓力。 */
export const MAX_LEN = {
  name: 100,
  spec: 100,
  description: 100,
  categoryName: 50,
  routeName: 50,
} as const;

/** 解析並驗證路由的 `id` 參數為正整數，失敗時回傳錯誤訊息。 */
export function parseId(
  idStr: string,
): { id: number } | { error: string } {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return { error: "無效的 ID 格式" };
  }
  return { id };
}

/**
 * 解析取貨點所屬路線 id：null/undefined → null（未分路線）；正整數 → 該 id；
 * 其餘（字串、0、負數、非整數）→ 錯誤。
 */
export function parseRouteId(
  routeId: unknown,
): { value: number | null } | { error: string } {
  if (routeId === null || routeId === undefined) return { value: null };
  if (Number.isInteger(routeId) && (routeId as number) > 0) {
    return { value: routeId as number };
  }
  return { error: "無效的路線" };
}

/**
 * 解析站點代碼（取貨號碼前綴）：trim → 轉大寫 → 須為 1–3 個英文字母，不符回錯誤。
 * 一律以大寫回傳（儲存與顯示皆大寫，同路線唯一性因此天然不分大小寫）。
 */
export function parseSpotCode(
  code: unknown,
): { value: string } | { error: string } {
  const raw = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!/^[A-Z]{1,3}$/.test(raw)) {
    return { error: "站點代碼須為 1–3 個英文字母" };
  }
  return { value: raw };
}

/**
 * 驗證商品排序請求：`ids` 須為非空、皆正整數、不重複的陣列。
 * 回傳已驗證的 id 陣列（代表期望的由前到後完整順序）。
 */
function validateUniquePositiveIds(
  ids: unknown,
  error: string,
): { value: number[] } | { error: string } {
  if (!Array.isArray(ids) || ids.length === 0) return { error };
  const valid = ids.every((id) => Number.isInteger(id) && id > 0);
  if (!valid || new Set(ids).size !== ids.length) return { error };
  return { value: ids as number[] };
}
export function validateReorderBody(
  body: unknown,
): { value: number[] } | { error: string } {
  const { ids } = (body ?? {}) as { ids?: unknown };
  return validateUniquePositiveIds(ids, "排序資料格式錯誤");
}

/**
 * 驗證自取點「單一縣市」排序請求：`city` 非空字串，`ids` 須為非空、皆正整數、不重複的陣列。
 * 回傳已驗證的 `{ city, ids }`（ids 代表該縣市期望的由前到後完整順序）。
 * 此排序供前台顧客選取貨點使用，故維持以縣市分群。
 */
export function validatePickupReorderBody(
  body: unknown,
): { value: { city: string; ids: number[] } } | { error: string } {
  const { city, ids } = (body ?? {}) as { city?: unknown; ids?: unknown };
  const error = "排序資料格式錯誤";
  if (typeof city !== "string" || city.trim() === "") return { error };
  const parsedIds = validateUniquePositiveIds(ids, error);
  if ("error" in parsedIds) return parsedIds;
  return { value: { city: city.trim(), ids: parsedIds.value } };
}

/**
 * 驗證「依 id 清單」的訂單動作請求（選取出貨／選取匯出）：
 * `ids` 須為非空、皆正整數、不重複的陣列。回傳去重後的 id 陣列。
 */
export function validateOrderIdsBody(
  body: unknown,
): { value: number[] } | { error: string } {
  const { ids } = (body ?? {}) as { ids?: unknown };
  return validateUniquePositiveIds(ids, "選取資料格式錯誤");
}

/** 單一商品的圖片張數上限（見 spec FR-011）。 */
export { MAX_PRODUCT_IMAGES };

/**
 * 驗證商品圖片集合：`imageUrls` 須為 1–8 個非空字串的陣列（有序，index 0 為封面）。
 * 回傳已驗證、去除前後空白後的 URL 陣列。
 */
export function validateProductImages(
  imageUrls: unknown,
): { value: string[] } | { error: string } {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return { error: `商品圖片需為 1 至 ${MAX_PRODUCT_IMAGES} 張` };
  }
  if (imageUrls.length > MAX_PRODUCT_IMAGES) {
    return { error: `商品圖片需為 1 至 ${MAX_PRODUCT_IMAGES} 張` };
  }
  const cleaned: string[] = [];
  for (const url of imageUrls) {
    if (typeof url !== "string" || url.trim() === "") {
      return { error: `商品圖片需為 1 至 ${MAX_PRODUCT_IMAGES} 張` };
    }
    cleaned.push(url.trim());
  }
  return { value: cleaned };
}

/**
 * 已驗證、可直接寫入 DB 的商品非圖片欄位（name 僅在新增時存在）。
 * 圖片集合另由 validateProductImages 驗證，不在此結構內。
 */
interface ValidatedProduct {
  code: string;
  name: string;
  price: number;
  categoryId: number;
  spec: string | null;
  description: string | null;
  promoType: string | null;
  promoConfig: PromoConfig | null;
  /** 剩餘可售數量；null＝不限量（不追蹤庫存）。 */
  stock: number | null;
}

/**
 * 驗證商品新增/更新請求的共用「非圖片」欄位（價格、分類、長度、優惠）。
 * 圖片以 validateProductImages 另行驗證。
 * `requireName` 為 true（新增）時額外驗證並回傳 name；更新時 name 不可變，回傳空字串。
 */
export function validateProductBody(
  body: unknown,
  { requireName }: { requireName: boolean },
): { value: ValidatedProduct } | { error: string } {
  const {
    code,
    name,
    price,
    categoryId,
    spec,
    description,
    promoType,
    promoConfig,
    stock,
  } = (body ?? {}) as {
    code?: string | null;
    name?: string;
    price?: number | string;
    categoryId?: number | string;
    spec?: string;
    description?: string;
    promoType?: string | null;
    promoConfig?: unknown;
    stock?: number | string | null;
  };

  const codeVal = typeof code === "string" ? code.trim() : "";
  if (!codeVal) {
    return { error: "產品編號為必填欄位" };
  }
  if (codeVal.length > 3) {
    return { error: "產品編號不可超過 3 個字" };
  }

  const priceNum = Number(price);
  const priceValid =
    String(price).trim() !== "" && Number.isInteger(priceNum) && priceNum > 0;

  let nameVal = "";
  if (requireName) {
    nameVal = name?.trim() ?? "";
    if (!nameVal || !priceValid) {
      return { error: "商品名稱和有效價格（正整數）為必填欄位" };
    }
    if (nameVal.length > MAX_LEN.name) {
      return { error: `商品名稱不可超過 ${MAX_LEN.name} 字` };
    }
  } else if (!priceValid) {
    return { error: "有效價格（正整數）為必填欄位" };
  }

  if (spec && spec.length > MAX_LEN.spec) {
    return { error: `規格不可超過 ${MAX_LEN.spec} 字` };
  }
  if (description && description.length > MAX_LEN.description) {
    return { error: `說明不可超過 ${MAX_LEN.description} 字` };
  }

  const categoryNum = Number(categoryId);
  if (!Number.isInteger(categoryNum) || categoryNum <= 0) {
    return { error: "請選擇分類" };
  }

  const promo = validatePromo(promoType, promoConfig);
  if ("error" in promo) {
    return { error: promo.error };
  }

  // 庫存：缺省/null/空字串 → null（不限量）；否則須為非負整數。
  let stockVal: number | null = null;
  if (stock !== undefined && stock !== null && String(stock).trim() !== "") {
    const stockNum = Number(stock);
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      return { error: "庫存必須為 0 或正整數" };
    }
    stockVal = stockNum;
  }

  return {
    value: {
      code: codeVal,
      name: nameVal,
      price: priceNum,
      categoryId: categoryNum,
      spec: spec?.trim() || null,
      description: description?.trim() || null,
      promoType: promo.promoType,
      promoConfig: promo.promoConfig,
      stock: stockVal,
    },
  };
}

/** 訂單來源標籤允許值；未指定時預設「網站」（顧客端外部訂單亦套此預設）。 */
const ORDER_TAGS = ["網站", "FB", "Line"] as const;
export type OrderTag = (typeof ORDER_TAGS)[number];

/** 已驗證的訂單明細項（金額由後端計算，不取前端值）。 */
export interface ValidatedOrderItem {
  productId: number;
  quantity: number;
}

/** 已驗證、可交給 createOrder 的建立訂單欄位。 */
export interface ValidatedCreateOrder {
  customerName: string;
  phone: string | null;
  tag: OrderTag;
  deliveryMethod: "pickup" | "delivery";
  pickupSpotId: number | null;
  shippingAddress: string | null;
  note: string | null;
  items: ValidatedOrderItem[];
}

/**
 * 驗證後台「新增訂單」請求。金額相關欄位一律忽略（由後端依商品目前單價＋促銷計算），
 * 故此處只驗證客戶、取貨方式、來源標籤與商品明細。重複商品合併數量。
 */
export function validateCreateOrderBody(
  body: unknown,
): { value: ValidatedCreateOrder } | { error: string } {
  const {
    customerName,
    phone,
    tag,
    deliveryMethod,
    pickupSpotId,
    shippingAddress,
    note,
    items,
  } = (body ?? {}) as {
    customerName?: string;
    phone?: string;
    tag?: string;
    deliveryMethod?: string;
    pickupSpotId?: number | string;
    shippingAddress?: string;
    note?: string;
    items?: unknown;
  };

  const name = typeof customerName === "string" ? customerName.trim() : "";
  if (!name) return { error: "客戶姓名為必填" };
  if (name.length > MAX_LEN.name) {
    return { error: `客戶姓名不可超過 ${MAX_LEN.name} 字` };
  }

  const trimmedPhone = typeof phone === "string" ? phone.trim() : "";
  if (trimmedPhone) {
    if (!/^09\d{8}$/.test(trimmedPhone)) {
      return { error: "請輸入有效的手機號碼" };
    }
  }

  const tagVal = tag == null || tag === "" ? "網站" : tag;
  if (!ORDER_TAGS.includes(tagVal as OrderTag)) {
    return { error: "來源標籤無效" };
  }

  if (deliveryMethod !== "pickup" && deliveryMethod !== "delivery") {
    return { error: "無效的取貨方式" };
  }

  let spotId: number | null = null;
  let address: string | null = null;
  if (deliveryMethod === "pickup") {
    const n = Number(pickupSpotId);
    if (!Number.isInteger(n) || n <= 0) return { error: "請選擇取貨點" };
    spotId = n;
  } else {
    address = typeof shippingAddress === "string" ? shippingAddress.trim() : "";
    if (!address) return { error: "宅配地址為必填" };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { error: "請至少加入一項商品" };
  }

  // 重複 productId 合併數量為單一明細列。
  const merged = new Map<number, number>();
  for (const raw of items) {
    const { productId, quantity } = (raw ?? {}) as {
      productId?: number | string;
      quantity?: number | string;
    };
    const pid = Number(productId);
    const qty = Number(quantity);
    if (!Number.isInteger(pid) || pid <= 0) {
      return { error: "商品資料格式錯誤" };
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return { error: "商品數量需為正整數" };
    }
    merged.set(pid, (merged.get(pid) ?? 0) + qty);
  }
  const mergedItems = [...merged.entries()].map(([productId, quantity]) => ({
    productId,
    quantity,
  }));

  return {
    value: {
      customerName: name,
      phone: trimmedPhone || null,
      tag: tagVal as OrderTag,
      deliveryMethod,
      pickupSpotId: spotId,
      shippingAddress: address,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
      items: mergedItems,
    },
  };
}

/**
 * 已驗證的「修改訂單品項」單列：
 * - 帶 `id` → 既有 `order_items` 明細（保留其單價/促銷快照，僅套用新數量）。
 * - 帶 `productId` → 新增明細（以商品目前單價＋促銷建立快照）。
 * 兩者恰有其一。
 */
export interface ValidatedUpdateOrderItem {
  id?: number;
  productId?: number;
  quantity: number;
}

export interface ValidatedBatchOrderAdjustment {
  productId: number;
  method: "pickup" | "delivery";
  routeId: number | null;
  changes: {
    orderId: number;
    orderItemId: number;
    expectedQuantity: number;
    newQuantity: number;
  }[];
}

/** 缺貨調整只允許減量，並可保留數量為 0 的明細。 */
export function validateBatchOrderAdjustmentBody(
  body: unknown,
): { value: ValidatedBatchOrderAdjustment } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const productId = Number(b.productId);
  const method = b.method;
  if (!Number.isInteger(productId) || productId <= 0) return { error: "商品資料不正確" };
  if (method !== "pickup" && method !== "delivery") return { error: "訂單群組不正確" };
  const routeId = method === "pickup" && b.routeId !== null ? Number(b.routeId) : null;
  if (routeId !== null && (!Number.isInteger(routeId) || routeId <= 0)) {
    return { error: "路線資料不正確" };
  }
  if (!Array.isArray(b.changes) || b.changes.length === 0 || b.changes.length > 1000) {
    return { error: "請提供 1 至 1000 筆商品調整" };
  }
  const seen = new Set<number>();
  const changes = b.changes.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      orderId: Number(r.orderId),
      orderItemId: Number(r.orderItemId),
      expectedQuantity: Number(r.expectedQuantity),
      newQuantity: Number(r.newQuantity),
    };
  });
  const invalid = changes.some((r) => {
    const bad = !Number.isInteger(r.orderId) || r.orderId <= 0 ||
      !Number.isInteger(r.orderItemId) || r.orderItemId <= 0 ||
      !Number.isInteger(r.expectedQuantity) || r.expectedQuantity <= 0 ||
      !Number.isInteger(r.newQuantity) || r.newQuantity < 0 ||
      r.newQuantity >= r.expectedQuantity || seen.has(r.orderItemId);
    seen.add(r.orderItemId);
    return bad;
  });
  if (invalid) return { error: "商品調整資料不正確，只能將原數量調低至 0 以上" };
  return { value: { productId, method, routeId, changes } };
}

/**
 * 驗證後台「修改訂單品項」請求。金額欄位一律忽略（後端依快照/現價計算）。
 * - `items` 必為非空陣列（至少保留一項；清空請改用刪除訂單）。
 * - 每列 `quantity` 為正整數；且恰有 `id` 或 `productId` 其一（皆正整數）。
 * - 重複的既有 `id`、或重複的新增 `productId`，各自合併數量。
 */
export function validateUpdateOrderItemsBody(
  body: unknown,
): { value: { items: ValidatedUpdateOrderItem[] } } | { error: string } {
  const { items } = (body ?? {}) as { items?: unknown };

  if (!Array.isArray(items) || items.length === 0) {
    return { error: "訂單至少需保留一項明細，如需清空請改用刪除訂單" };
  }

  // 既有明細（依 order_items.id）與新增明細（依 productId）分別合併數量。
  const existingQty = new Map<number, number>();
  const newQty = new Map<number, number>();

  for (const raw of items) {
    const { id, productId, quantity } = (raw ?? {}) as {
      id?: number | string;
      productId?: number | string;
      quantity?: number | string;
    };

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      return { error: "商品數量需為正整數" };
    }

    const hasId = id !== undefined && id !== null && String(id) !== "";
    const hasProduct =
      productId !== undefined && productId !== null && String(productId) !== "";
    // 必須恰有 id 或 productId 其一。
    if (hasId === hasProduct) {
      return { error: "明細資料格式錯誤" };
    }

    if (hasId) {
      const n = Number(id);
      if (!Number.isInteger(n) || n <= 0) return { error: "明細資料格式錯誤" };
      existingQty.set(n, (existingQty.get(n) ?? 0) + qty);
    } else {
      const n = Number(productId);
      if (!Number.isInteger(n) || n <= 0) return { error: "商品資料格式錯誤" };
      newQty.set(n, (newQty.get(n) ?? 0) + qty);
    }
  }

  const merged: ValidatedUpdateOrderItem[] = [
    ...[...existingQty.entries()].map(([id, quantity]) => ({ id, quantity })),
    ...[...newQty.entries()].map(([productId, quantity]) => ({
      productId,
      quantity,
    })),
  ];

  return { value: { items: merged } };
}
