import { NextResponse } from "next/server";
import { getCategories, addCategory } from "@/app/lib/categories";
import { jsonHandler } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { MAX_LEN } from "@/app/lib/validation";

export const GET = jsonHandler(getCategories, "無法讀取分類資料");

export const POST = jsonHandler(async (request) => {
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

  await addCategory(nameVal);
  await revalidateCache("categories");
  return { success: true };
}, "新增分類失敗");
