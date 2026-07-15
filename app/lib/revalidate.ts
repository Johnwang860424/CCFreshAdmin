import { revalidateTag } from "next/cache";

export async function revalidateCache(tag: string) {
  revalidateTag(tag, { expire: 0 });

  const frontendUrl = process.env.FRONTEND_URL;
  const token = process.env.ADMIN_SECRET_TOKEN;

  if (!frontendUrl || !token) {
    console.warn("[revalidate] FRONTEND_URL or ADMIN_SECRET_TOKEN is not configured");
    return;
  }

  try {
    await fetch(`${frontendUrl}/api/revalidate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ tag }),
    });
  } catch (err) {
    // 前台重新驗證為 best-effort：失敗不應阻斷後台寫入，但仍記錄以利排查。
    console.warn(`[revalidate] 通知前台失敗（tag=${tag}）：`, err);
  }
}
