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
