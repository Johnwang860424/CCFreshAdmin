import { revalidateTag } from "next/cache";

export async function revalidateCache(tag: string) {
  revalidateTag(tag, { expire: 0 });

  const frontendUrl = process.env.FRONTEND_URL;
  const token = process.env.ADMIN_SECRET_TOKEN;

  try {
    await fetch(`${frontendUrl}/api/revalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tag }),
    });
  } catch {
    // 前端暫時無法連線，不阻斷主流程
  }
}
