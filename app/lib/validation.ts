import { NextResponse } from "next/server";

/** 後端文字欄位的最大長度限制，避免超長字串造成 DB 壓力。 */
export const MAX_LEN = {
  name: 100,
  spec: 100,
  description: 2000,
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
