import { NextResponse } from "next/server";
import { getProducts, addProduct } from "@/app/lib/products";
import { revalidateCache } from "@/app/lib/revalidate";
import { MAX_LEN } from "@/app/lib/validation";

export async function GET() {
  try {
    const products = await getProducts();
    return NextResponse.json(products);
  } catch (err) {
    console.error("Failed to fetch products:", err);
    return NextResponse.json({ error: "無法讀取商品資料" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, price, imageUrl, categoryId, spec, description } = body as {
      name: string;
      price: number | string;
      imageUrl: string;
      categoryId: number | string;
      spec?: string;
      description?: string;
    };

    const nameVal = name?.trim();
    const priceNum = Number(price);
    if (!nameVal || String(price).trim() === "" || !Number.isInteger(priceNum) || priceNum < 0 || !imageUrl) {
      return NextResponse.json(
        { error: "商品名稱、有效價格（非負整數）和圖片為必填欄位" },
        { status: 400 }
      );
    }

    if (nameVal.length > MAX_LEN.name) {
      return NextResponse.json(
        { error: `商品名稱不可超過 ${MAX_LEN.name} 字` },
        { status: 400 },
      );
    }
    if (spec && spec.length > MAX_LEN.spec) {
      return NextResponse.json(
        { error: `規格不可超過 ${MAX_LEN.spec} 字` },
        { status: 400 },
      );
    }
    if (description && description.length > MAX_LEN.description) {
      return NextResponse.json(
        { error: `說明不可超過 ${MAX_LEN.description} 字` },
        { status: 400 },
      );
    }

    const categoryNum = Number(categoryId);
    if (!Number.isInteger(categoryNum) || categoryNum <= 0) {
      return NextResponse.json({ error: "請選擇分類" }, { status: 400 });
    }

    const specVal = spec?.trim() || null;
    const descriptionVal = description?.trim() || null;

    await addProduct(nameVal, priceNum, imageUrl, categoryNum, specVal, descriptionVal);
    await revalidateCache("products");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to add product:", err);
    return NextResponse.json({ error: "新增商品失敗" }, { status: 500 });
  }
}
