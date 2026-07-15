import { NextResponse } from "next/server";
import { getRoutes, addRoute } from "@/app/lib/routes";
import { jsonHandler, readJson } from "@/app/lib/api";
import { revalidateCache } from "@/app/lib/revalidate";
import { MAX_LEN } from "@/app/lib/validation";

export const GET = jsonHandler(getRoutes, "無法讀取路線資料");

export const POST = jsonHandler(async (request) => {
  const body = await readJson(request);
  const { name } = body as { name: string };

  const nameVal = name?.trim();
  if (!nameVal) {
    return NextResponse.json({ error: "路線名稱為必填欄位" }, { status: 400 });
  }
  if (nameVal.length > MAX_LEN.routeName) {
    return NextResponse.json(
      { error: `路線名稱不可超過 ${MAX_LEN.routeName} 字` },
      { status: 400 },
    );
  }

  try {
    await addRoute(nameVal);
  } catch (err) {
    // 23505 = unique_violation：路線名稱重複。
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json({ error: "路線名稱重複" }, { status: 400 });
    }
    throw err;
  }
  await revalidateCache("routes");
  return { success: true };
}, "新增路線失敗");
