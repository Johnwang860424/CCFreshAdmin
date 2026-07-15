import { NextResponse } from "next/server";
import { cloudinary, deleteCloudinaryImage } from "@/app/lib/cloudinary";
import { jsonHandler, readJson } from "@/app/lib/api";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * 以檔案內容的 Magic Bytes 推斷真實圖片格式，避免攻擊者僅靠偽造
 * Content-Type 就上傳 SVG 等可挾帶 Script 的檔案。
 */
function detectImageType(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export const POST = jsonHandler(async (request) => {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "未提供檔案" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "僅允許 JPG、PNG、WebP 格式" },
      { status: 400 },
    );
  }

  const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "圖片大小不可超過 5 MB" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const detectedType = detectImageType(buffer);
  if (!detectedType || !ALLOWED_TYPES.includes(detectedType)) {
    return NextResponse.json(
      { error: "檔案內容不是有效的圖片格式" },
      { status: 400 },
    );
  }

  const base64 = buffer.toString("base64");
  const dataUri = `data:${detectedType};base64,${base64}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "CC",
  });

  return { url: result.secure_url };
}, "圖片上傳失敗");

export const DELETE = jsonHandler(async (request) => {
  const { url } = (await readJson(request)) as { url?: string };
  if (!url) {
    return NextResponse.json({ error: "未提供圖片網址" }, { status: 400 });
  }

  await deleteCloudinaryImage(url);
  return { success: true };
}, "圖片刪除失敗");
