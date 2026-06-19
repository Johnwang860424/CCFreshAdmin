import { NextResponse } from "next/server";
import { getCategories, addCategory } from "@/app/lib/categories";
import { revalidateCache } from "@/app/lib/revalidate";
import { MAX_LEN } from "@/app/lib/validation";

export async function GET() {
  try {
    const categories = await getCategories();
    return NextResponse.json(categories);
  } catch (err) {
    console.error("Failed to fetch categories:", err);
    return NextResponse.json({ error: "無法讀取分類資料" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to add category:", err);
    return NextResponse.json({ error: "新增分類失敗" }, { status: 500 });
  }
}
