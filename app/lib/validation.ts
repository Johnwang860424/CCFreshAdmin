import { NextResponse } from "next/server";
import { validatePromo, type PromoConfig } from "@/app/lib/promotions";

/** 後端文字欄位的最大長度限制，避免超長字串造成 DB 壓力。 */
export const MAX_LEN = {
  name: 100,
  spec: 100,
  description: 100,
  categoryName: 50,
} as const;

/** 解析並驗證路由的 `id` 參數為正整數，失敗時回傳 400 response。 */
export function parseId(
  idStr: string,
): { id: number } | { error: NextResponse } {
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return {
      error: NextResponse.json({ error: "無效的 ID 格式" }, { status: 400 }),
    };
  }
  return { id };
}

function badRequest(message: string): { error: NextResponse } {
  return { error: NextResponse.json({ error: message }, { status: 400 }) };
}

/**
 * 驗證商品排序請求：`ids` 須為非空、皆正整數、不重複的陣列。
 * 回傳已驗證的 id 陣列（代表期望的由前到後完整順序）。
 */
export function validateReorderBody(
  body: unknown,
): { value: number[] } | { error: NextResponse } {
  const { ids } = (body ?? {}) as { ids?: unknown };

  if (!Array.isArray(ids) || ids.length === 0) {
    return badRequest("排序資料格式錯誤");
  }
  const allValid = ids.every((id) => Number.isInteger(id) && (id as number) > 0);
  if (!allValid || new Set(ids).size !== ids.length) {
    return badRequest("排序資料格式錯誤");
  }

  return { value: ids as number[] };
}

/**
 * 驗證自取點「單一縣市」排序請求：`city` 非空字串，`ids` 須為非空、皆正整數、不重複的陣列。
 * 回傳已驗證的 `{ city, ids }`（ids 代表該縣市期望的由前到後完整順序）。
 */
export function validatePickupReorderBody(
  body: unknown,
): { value: { city: string; ids: number[] } } | { error: NextResponse } {
  const { city, ids } = (body ?? {}) as { city?: unknown; ids?: unknown };

  if (typeof city !== "string" || city.trim() === "") {
    return badRequest("排序資料格式錯誤");
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return badRequest("排序資料格式錯誤");
  }
  const allValid = ids.every((id) => Number.isInteger(id) && (id as number) > 0);
  if (!allValid || new Set(ids).size !== ids.length) {
    return badRequest("排序資料格式錯誤");
  }

  return { value: { city, ids: ids as number[] } };
}

/** 已驗證、可直接寫入 DB 的商品欄位（name 僅在新增時存在）。 */
export interface ValidatedProduct {
  name: string;
  price: number;
  imageUrl: string;
  categoryId: number;
  spec: string | null;
  description: string | null;
  promoType: string | null;
  promoConfig: PromoConfig | null;
}

/**
 * 驗證商品新增/更新請求的共用欄位（價格、分類、長度、優惠）。
 * `requireName` 為 true（新增）時額外驗證並回傳 name；更新時 name 不可變，回傳空字串。
 */
export function validateProductBody(
  body: unknown,
  { requireName }: { requireName: boolean },
): { value: ValidatedProduct } | { error: NextResponse } {
  const {
    name,
    price,
    imageUrl,
    categoryId,
    spec,
    description,
    promoType,
    promoConfig,
  } = (body ?? {}) as {
    name?: string;
    price?: number | string;
    imageUrl?: string;
    categoryId?: number | string;
    spec?: string;
    description?: string;
    promoType?: string | null;
    promoConfig?: unknown;
  };

  const priceNum = Number(price);
  const priceValid =
    String(price).trim() !== "" && Number.isInteger(priceNum) && priceNum >= 0;

  let nameVal = "";
  if (requireName) {
    nameVal = name?.trim() ?? "";
    if (!nameVal || !priceValid || !imageUrl) {
      return badRequest("商品名稱、有效價格（非負整數）和圖片為必填欄位");
    }
    if (nameVal.length > MAX_LEN.name) {
      return badRequest(`商品名稱不可超過 ${MAX_LEN.name} 字`);
    }
  } else if (!priceValid || !imageUrl) {
    return badRequest("有效價格（非負整數）和圖片為必填欄位");
  }

  if (spec && spec.length > MAX_LEN.spec) {
    return badRequest(`規格不可超過 ${MAX_LEN.spec} 字`);
  }
  if (description && description.length > MAX_LEN.description) {
    return badRequest(`說明不可超過 ${MAX_LEN.description} 字`);
  }

  const categoryNum = Number(categoryId);
  if (!Number.isInteger(categoryNum) || categoryNum <= 0) {
    return badRequest("請選擇分類");
  }

  const promo = validatePromo(promoType, promoConfig);
  if ("error" in promo) {
    return badRequest(promo.error);
  }

  return {
    value: {
      name: nameVal,
      price: priceNum,
      imageUrl: imageUrl!,
      categoryId: categoryNum,
      spec: spec?.trim() || null,
      description: description?.trim() || null,
      promoType: promo.promoType,
      promoConfig: promo.promoConfig,
    },
  };
}

/** 訂單來源標籤允許值；未指定時預設「網站」（顧客端外部訂單亦套此預設）。 */
export const ORDER_TAGS = ["網站", "FB", "Line"] as const;
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
): { value: ValidatedCreateOrder } | { error: NextResponse } {
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
  if (!name) return badRequest("客戶姓名為必填");
  if (name.length > MAX_LEN.name) {
    return badRequest(`客戶姓名不可超過 ${MAX_LEN.name} 字`);
  }

  const tagVal = tag == null || tag === "" ? "網站" : tag;
  if (!ORDER_TAGS.includes(tagVal as OrderTag)) {
    return badRequest("來源標籤無效");
  }

  if (deliveryMethod !== "pickup" && deliveryMethod !== "delivery") {
    return badRequest("無效的取貨方式");
  }

  let spotId: number | null = null;
  let address: string | null = null;
  if (deliveryMethod === "pickup") {
    const n = Number(pickupSpotId);
    if (!Number.isInteger(n) || n <= 0) return badRequest("請選擇取貨點");
    spotId = n;
  } else {
    address = typeof shippingAddress === "string" ? shippingAddress.trim() : "";
    if (!address) return badRequest("宅配地址為必填");
  }

  if (!Array.isArray(items) || items.length === 0) {
    return badRequest("請至少加入一項商品");
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
      return badRequest("商品資料格式錯誤");
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      return badRequest("商品數量需為正整數");
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
      phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
      tag: tagVal as OrderTag,
      deliveryMethod,
      pickupSpotId: spotId,
      shippingAddress: address,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
      items: mergedItems,
    },
  };
}
