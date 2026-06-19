import { NextResponse } from "next/server";
import { cloudinary, deleteCloudinaryImage } from "@/app/lib/cloudinary";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "未提供檔案" }, { status: 400 });
    }

    const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "僅允許 JPG、PNG、WebP、GIF 格式" }, { status: 400 });
    }

    const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "圖片大小不可超過 5 MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const dataUri = `data:${file.type};base64,${base64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: "CC",
    });

    return NextResponse.json({ url: result.secure_url });
  } catch (err) {
    console.error("Upload failed:", err);
    return NextResponse.json({ error: "圖片上傳失敗" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { url } = (await request.json()) as { url?: string };
    if (!url) {
      return NextResponse.json({ error: "未提供圖片網址" }, { status: 400 });
    }

    await deleteCloudinaryImage(url);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete uploaded image failed:", err);
    return NextResponse.json({ error: "圖片刪除失敗" }, { status: 500 });
  }
}
