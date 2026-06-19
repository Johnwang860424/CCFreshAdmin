import { NextResponse } from "next/server";
import {
  deleteProduct,
  getProducts,
  updateProductDetails,
} from "@/app/lib/products";
import { deleteCloudinaryImage } from "@/app/lib/cloudinary";
import { revalidateCache } from "@/app/lib/revalidate";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    const body = await request.json();
    const { price, imageUrl, oldImageUrl } = body as {
      price: number | string;
      imageUrl: string;
      oldImageUrl?: string;
    };

    const priceNum = Number(price);
    if (
      String(price).trim() === "" ||
      !Number.isInteger(priceNum) ||
      priceNum < 0 ||
      !imageUrl
    ) {
      return NextResponse.json(
        { error: "有效價格（非負整數）和圖片為必填欄位" },
        { status: 400 }
      );
    }

    await updateProductDetails(id, priceNum, imageUrl);

    if (oldImageUrl && oldImageUrl !== imageUrl) {
      await deleteCloudinaryImage(oldImageUrl);
    }

    await revalidateCache("products");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to update product:", err);
    return NextResponse.json({ error: "更新商品失敗" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id: idStr } = await params;
    const id = Number(idStr);

    const products = await getProducts();
    const product = products.find((p) => p.id === id);

    await deleteProduct(id);

    if (product?.imageUrl) {
      await deleteCloudinaryImage(product.imageUrl);
    }

    await revalidateCache("products");
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete product:", err);
    return NextResponse.json({ error: "刪除商品失敗" }, { status: 500 });
  }
}
