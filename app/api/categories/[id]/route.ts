import { NextResponse } from "next/server";
import {
  renameCategory,
  deleteCategory,
  countProductsInCategory,
} from "@/app/lib/categories";
import { revalidateCache } from "@/app/lib/revalidate";
import { MAX_LEN, parseId } from "@/app/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id: idStr } = await params;
    const parsed = parseId(idStr);
    if ("error" in parsed) return parsed.error;
    const { id } = parsed;
    const body = await request.json();
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
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to rename category:", err);
    return NextResponse.json({ error: "更新分類失敗" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id: idStr } = await params;
    const parsed = parseId(idStr);
    if ("error" in parsed) return parsed.error;
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
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete category:", err);
    return NextResponse.json({ error: "刪除分類失敗" }, { status: 500 });
  }
}
