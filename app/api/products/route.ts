import { NextResponse } from "next/server";
import { getProducts, addProduct } from "@/app/lib/products";
import { revalidateCache } from "@/app/lib/revalidate";

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
    const { name, price, imageUrl } = body as {
      name: string;
      price: number | string;
      imageUrl: string;
    };

    const priceNum = Number(price);
    if (!name || String(price).trim() === "" || !Number.isInteger(priceNum) || priceNum < 0) {
      return NextResponse.json(
        { error: "商品名稱和有效價格（非負整數）為必填欄位" },
        { status: 400 }
      );
    }

    await addProduct(name, priceNum, imageUrl || "");
    await revalidateCache("products");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to add product:", err);
    return NextResponse.json({ error: "新增商品失敗" }, { status: 500 });
  }
}
