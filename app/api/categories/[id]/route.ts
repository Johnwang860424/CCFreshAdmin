import { NextResponse } from "next/server";
import {
  renameCategory,
  deleteCategory,
  countProductsInCategory,
} from "@/app/lib/categories";
import { badRequest, jsonHandler, readJson } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { MAX_LEN, parseId } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

export const PUT = jsonHandler<Params>(async (request, { params }) => {
  const { id: idStr } = await params;
  const parsed = parseId(idStr);
  if ("error" in parsed) return badRequest(parsed.error);
  const { id } = parsed;

  const body = await readJson(request);
  const { name } = body as { name: string };

  const nameVal = name?.trim();
  if (!nameVal) {
    return NextResponse.json({ error: "分類名稱為必填欄位" }, { status: 400 });
  }
  if (nameVal.length > MAX_LEN.categoryName) {
    return NextResponse.json(
      { error: `分類名稱不可超過 ${MAX_LEN.categoryName} 字` },
      { status: 400 },
    );
  }

  await renameCategory(id, nameVal);
  await revalidateCache("categories");
  return { success: true };
}, "更新分類失敗");

export const DELETE = jsonHandler<Params>(async (_request, { params }) => {
  const { id: idStr } = await params;
  const parsed = parseId(idStr);
  if ("error" in parsed) return badRequest(parsed.error);
  const { id } = parsed;

  const count = await countProductsInCategory(id);
  if (count > 0) {
    return NextResponse.json(
      { error: `此分類仍有 ${count} 項商品使用，無法刪除` },
      { status: 400 },
    );
  }

  try {
    await deleteCategory(id);
  } catch (err) {
    // 檢查與刪除之間若有商品被關聯進來，會違反外鍵約束（Postgres 23503）
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23503"
    ) {
      return NextResponse.json(
        { error: "此分類仍有商品使用，無法刪除" },
        { status: 400 },
      );
    }
    throw err;
  }

  await revalidateCache("categories");
  return { success: true };
}, "刪除分類失敗");
