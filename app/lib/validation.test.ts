import { describe, expect, it } from "vitest";
import {
  MAX_LEN,
  MAX_PRODUCT_IMAGES,
  parseId,
  parseRouteId,
  parseSpotCode,
  validateBatchOrderAdjustmentBody,
  validateCreateOrderBody,
  validateOrderIdsBody,
  validatePickupReorderBody,
  validateProductBody,
  validateProductImages,
  validateReorderBody,
  validateUpdateOrderItemsBody,
} from "./validation";

describe("parseId", () => {
  it("正整數字串通過", () => {
    expect(parseId("42")).toEqual({ id: 42 });
  });

  it("非正整數（0、負數、小數、非數字）回錯誤", () => {
    for (const bad of ["0", "-1", "1.5", "abc", ""]) {
      expect(parseId(bad)).toEqual({ error: "無效的 ID 格式" });
    }
  });
});

describe("parseRouteId", () => {
  it("null/undefined 視為未分路線", () => {
    expect(parseRouteId(null)).toEqual({ value: null });
    expect(parseRouteId(undefined)).toEqual({ value: null });
  });

  it("正整數通過；字串、0、負數、非整數回錯誤", () => {
    expect(parseRouteId(3)).toEqual({ value: 3 });
    for (const bad of ["3", 0, -1, 1.5]) {
      expect(parseRouteId(bad)).toEqual({ error: "無效的路線" });
    }
  });
});

describe("parseSpotCode", () => {
  it("trim 後轉大寫，1–3 個英文字母通過", () => {
    expect(parseSpotCode(" ab ")).toEqual({ value: "AB" });
    expect(parseSpotCode("XYZ")).toEqual({ value: "XYZ" });
  });

  it("空值、過長、含非英文字元回錯誤", () => {
    for (const bad of ["", "ABCD", "A5", "中", 12, null, undefined]) {
      expect(parseSpotCode(bad)).toEqual({
        error: "站點代碼須為 1–3 個英文字母",
      });
    }
  });
});

describe("validateReorderBody / validateOrderIdsBody", () => {
  it("非空、皆正整數、不重複的 ids 通過", () => {
    expect(validateReorderBody({ ids: [3, 1, 2] })).toEqual({
      value: [3, 1, 2],
    });
    expect(validateOrderIdsBody({ ids: [5] })).toEqual({ value: [5] });
  });

  it("空陣列、非陣列、非正整數、重複 id 回錯誤", () => {
    for (const bad of [
      {},
      { ids: [] },
      { ids: "1,2" },
      { ids: [1, 0] },
      { ids: [1, 1] },
      { ids: [1, 1.5] },
    ]) {
      expect(validateReorderBody(bad)).toEqual({ error: "排序資料格式錯誤" });
      expect(validateOrderIdsBody(bad)).toEqual({ error: "選取資料格式錯誤" });
    }
  });
});

describe("validatePickupReorderBody", () => {
  it("city 非空字串 + 合法 ids 通過", () => {
    expect(validatePickupReorderBody({ city: "台中市", ids: [2, 1] })).toEqual({
      value: { city: "台中市", ids: [2, 1] },
    });
  });

  it("city 缺漏或空白回錯誤", () => {
    expect(validatePickupReorderBody({ ids: [1] })).toEqual({
      error: "排序資料格式錯誤",
    });
    expect(validatePickupReorderBody({ city: "  ", ids: [1] })).toEqual({
      error: "排序資料格式錯誤",
    });
  });
});

describe("validateProductImages", () => {
  it("1–8 個非空字串通過並 trim", () => {
    expect(validateProductImages([" https://a.jpg "])).toEqual({
      value: ["https://a.jpg"],
    });
  });

  it("空陣列、超過上限、含空字串回錯誤", () => {
    const error = `商品圖片需為 1 至 ${MAX_PRODUCT_IMAGES} 張`;
    expect(validateProductImages([])).toEqual({ error });
    expect(validateProductImages(undefined)).toEqual({ error });
    expect(
      validateProductImages(Array.from({ length: 9 }, (_, i) => `u${i}`)),
    ).toEqual({ error });
    expect(validateProductImages(["ok", " "])).toEqual({ error });
  });
});

describe("validateProductBody", () => {
  const base = {
    name: "芒果",
    price: 100,
    categoryId: 1,
  };

  it("新增（requireName）驗證名稱與價格並正規化欄位", () => {
    const parsed = validateProductBody(
      { ...base, spec: " 一盒 ", description: "", stock: "" },
      { requireName: true },
    );
    expect(parsed).toEqual({
      value: {
        name: "芒果",
        price: 100,
        categoryId: 1,
        spec: "一盒",
        description: null,
        promoType: null,
        promoConfig: null,
        stock: null,
      },
    });
  });

  it("更新（不驗名稱）name 回空字串", () => {
    const parsed = validateProductBody(
      { price: 50, categoryId: 2 },
      { requireName: false },
    );
    expect("value" in parsed && parsed.value.name).toBe("");
  });

  it("價格須為非負整數（空、負數、小數皆拒絕）", () => {
    for (const price of ["", -1, 1.5, "abc"]) {
      expect(
        validateProductBody({ ...base, price }, { requireName: true }),
      ).toEqual({ error: "商品名稱和有效價格（非負整數）為必填欄位" });
    }
    expect(
      validateProductBody({ price: -1, categoryId: 1 }, { requireName: false }),
    ).toEqual({ error: "有效價格（非負整數）為必填欄位" });
  });

  it("名稱/規格/說明長度上限", () => {
    expect(
      validateProductBody(
        { ...base, name: "a".repeat(MAX_LEN.name + 1) },
        { requireName: true },
      ),
    ).toEqual({ error: `商品名稱不可超過 ${MAX_LEN.name} 字` });
    expect(
      validateProductBody(
        { ...base, spec: "a".repeat(MAX_LEN.spec + 1) },
        { requireName: true },
      ),
    ).toEqual({ error: `規格不可超過 ${MAX_LEN.spec} 字` });
  });

  it("分類必須為正整數", () => {
    expect(
      validateProductBody({ ...base, categoryId: 0 }, { requireName: true }),
    ).toEqual({ error: "請選擇分類" });
  });

  it("優惠設定經 validatePromo 驗證", () => {
    const parsed = validateProductBody(
      { ...base, promoType: "second_item", promoConfig: { discount: 80 } },
      { requireName: true },
    );
    expect("value" in parsed && parsed.value.promoType).toBe("second_item");
    expect(
      validateProductBody(
        { ...base, promoType: "nope", promoConfig: {} },
        { requireName: true },
      ),
    ).toEqual({ error: "無效的優惠方式" });
  });

  it("庫存：缺省/null/空字串 → null；非負整數通過；負數/小數拒絕", () => {
    const ok = validateProductBody({ ...base, stock: 0 }, { requireName: true });
    expect("value" in ok && ok.value.stock).toBe(0);
    const none = validateProductBody({ ...base }, { requireName: true });
    expect("value" in none && none.value.stock).toBeNull();
    for (const stock of [-1, 1.5, "abc"]) {
      expect(
        validateProductBody({ ...base, stock }, { requireName: true }),
      ).toEqual({ error: "庫存必須為 0 或正整數" });
    }
  });
});

describe("validateCreateOrderBody", () => {
  const base = {
    customerName: " 王小明 ",
    deliveryMethod: "pickup",
    pickupSpotId: 3,
    items: [{ productId: 1, quantity: 2 }],
  };

  it("通過時 trim 姓名、空白電話/備註轉 null、預設標籤「網站」", () => {
    expect(validateCreateOrderBody(base)).toEqual({
      value: {
        customerName: "王小明",
        phone: null,
        tag: "網站",
        deliveryMethod: "pickup",
        pickupSpotId: 3,
        shippingAddress: null,
        note: null,
        items: [{ productId: 1, quantity: 2 }],
      },
    });
  });

  it("重複 productId 合併數量", () => {
    const parsed = validateCreateOrderBody({
      ...base,
      items: [
        { productId: 1, quantity: 2 },
        { productId: 1, quantity: 3 },
        { productId: 2, quantity: 1 },
      ],
    });
    expect("value" in parsed && parsed.value.items).toEqual([
      { productId: 1, quantity: 5 },
      { productId: 2, quantity: 1 },
    ]);
  });

  it("姓名必填且有長度上限", () => {
    expect(validateCreateOrderBody({ ...base, customerName: " " })).toEqual({
      error: "客戶姓名為必填",
    });
    expect(
      validateCreateOrderBody({
        ...base,
        customerName: "a".repeat(MAX_LEN.name + 1),
      }),
    ).toEqual({ error: `客戶姓名不可超過 ${MAX_LEN.name} 字` });
  });

  it("電話選填，但填了必須是 09 開頭 10 碼", () => {
    const ok = validateCreateOrderBody({ ...base, phone: "0912345678" });
    expect("value" in ok && ok.value.phone).toBe("0912345678");
    expect(validateCreateOrderBody({ ...base, phone: "12345" })).toEqual({
      error: "請輸入有效的手機號碼",
    });
  });

  it("來源標籤僅接受允許值，空值預設「網站」", () => {
    const fb = validateCreateOrderBody({ ...base, tag: "FB" });
    expect("value" in fb && fb.value.tag).toBe("FB");
    expect(validateCreateOrderBody({ ...base, tag: "IG" })).toEqual({
      error: "來源標籤無效",
    });
  });

  it("自取須有取貨點、宅配須有地址", () => {
    expect(
      validateCreateOrderBody({ ...base, pickupSpotId: undefined }),
    ).toEqual({ error: "請選擇取貨點" });
    expect(
      validateCreateOrderBody({
        ...base,
        deliveryMethod: "delivery",
        shippingAddress: " ",
      }),
    ).toEqual({ error: "宅配地址為必填" });
    const delivery = validateCreateOrderBody({
      ...base,
      deliveryMethod: "delivery",
      shippingAddress: "台中市西區民生路 1 號",
    });
    expect("value" in delivery && delivery.value.pickupSpotId).toBeNull();
    expect(validateCreateOrderBody({ ...base, deliveryMethod: "貨到" })).toEqual(
      { error: "無效的取貨方式" },
    );
  });

  it("明細必填且數量為正整數", () => {
    expect(validateCreateOrderBody({ ...base, items: [] })).toEqual({
      error: "請至少加入一項商品",
    });
    expect(
      validateCreateOrderBody({
        ...base,
        items: [{ productId: 1, quantity: 0 }],
      }),
    ).toEqual({ error: "商品數量需為正整數" });
    expect(
      validateCreateOrderBody({
        ...base,
        items: [{ productId: "x", quantity: 1 }],
      }),
    ).toEqual({ error: "商品資料格式錯誤" });
  });
});

describe("validateUpdateOrderItemsBody", () => {
  it("既有明細（id）與新增明細（productId）分別合併數量", () => {
    expect(
      validateUpdateOrderItemsBody({
        items: [
          { id: 10, quantity: 1 },
          { id: 10, quantity: 2 },
          { productId: 7, quantity: 3 },
          { productId: 7, quantity: 1 },
        ],
      }),
    ).toEqual({
      value: {
        items: [
          { id: 10, quantity: 3 },
          { productId: 7, quantity: 4 },
        ],
      },
    });
  });

  it("空明細回錯誤（清空請改用刪除訂單）", () => {
    expect(validateUpdateOrderItemsBody({ items: [] })).toEqual({
      error: "訂單至少需保留一項明細，如需清空請改用刪除訂單",
    });
  });

  it("每列須恰有 id 或 productId 其一", () => {
    expect(
      validateUpdateOrderItemsBody({ items: [{ quantity: 1 }] }),
    ).toEqual({ error: "明細資料格式錯誤" });
    expect(
      validateUpdateOrderItemsBody({
        items: [{ id: 1, productId: 2, quantity: 1 }],
      }),
    ).toEqual({ error: "明細資料格式錯誤" });
  });

  it("數量須為正整數", () => {
    expect(
      validateUpdateOrderItemsBody({ items: [{ id: 1, quantity: 0 }] }),
    ).toEqual({ error: "商品數量需為正整數" });
  });
});

describe("validateBatchOrderAdjustmentBody", () => {
  const base = {
    productId: 7,
    method: "pickup",
    routeId: 3,
    changes: [
      { orderId: 10, orderItemId: 20, expectedQuantity: 3, newQuantity: 0 },
    ],
  };

  it("允許將商品數量調整為 0", () => {
    expect(validateBatchOrderAdjustmentBody(base)).toEqual({ value: base });
  });

  it("不允許維持原數量、增加數量或重複明細", () => {
    for (const newQuantity of [3, 4]) {
      expect(
        validateBatchOrderAdjustmentBody({
          ...base,
          changes: [{ ...base.changes[0], newQuantity }],
        }),
      ).toHaveProperty("error");
    }
    expect(
      validateBatchOrderAdjustmentBody({
        ...base,
        changes: [base.changes[0], base.changes[0]],
      }),
    ).toHaveProperty("error");
  });
});
