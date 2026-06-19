import { NextResponse } from "next/server";
import { getOrders, deleteAllOrders } from "@/app/lib/orders";

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const STATUS_MAP: Record<string, string> = {
  pending: "待處理",
  confirmed: "已確認",
  completed: "已完成",
  cancelled: "已取消",
};

// 結單第一步：僅匯出 CSV，不刪除任何資料。
// 客戶端確認成功下載後，再呼叫 DELETE 清除訂單，避免下載失敗造成資料遺失。
export async function POST() {
  try {
    const orders = await getOrders();

    if (orders.length === 0) {
      return NextResponse.json({ error: "目前沒有訂單可結單" }, { status: 400 });
    }

    // Build CSV with BOM for Excel compatibility
    const BOM = "\uFEFF";
    const headers = [
      "訂單編號",
      "客戶姓名",
      "電話",
      "自取點",
      "狀態",
      "商品名稱",
      "單價",
      "數量",
      "小計",
      "訂單總額",
      "備註",
      "建立時間",
    ];

    const rows: string[] = [headers.join(",")];

    for (const order of orders) {
      const createdAt = new Date(order.createdAt).toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
      });
      const status = STATUS_MAP[order.status] ?? order.status;

      if (order.items.length === 0) {
        rows.push(
          [
            escapeCSV(String(order.id)),
            escapeCSV(order.customerName),
            escapeCSV(order.phone ?? ""),
            escapeCSV(order.pickupLabel ?? ""),
            escapeCSV(status),
            "",
            "",
            "",
            "",
            escapeCSV(String(order.total)),
            escapeCSV(order.note ?? ""),
            escapeCSV(createdAt),
          ].join(",")
        );
      } else {
        for (const item of order.items) {
          rows.push(
            [
              escapeCSV(String(order.id)),
              escapeCSV(order.customerName),
              escapeCSV(order.phone ?? ""),
              escapeCSV(order.pickupLabel ?? ""),
              escapeCSV(status),
              escapeCSV(item.productName),
              escapeCSV(String(item.unitPrice)),
              escapeCSV(String(item.quantity)),
              escapeCSV(String(item.unitPrice * item.quantity)),
              escapeCSV(String(order.total)),
              escapeCSV(order.note ?? ""),
              escapeCSV(createdAt),
            ].join(",")
          );
        }
      }
    }

    const csv = BOM + rows.join("\n");

    const now = new Date().toLocaleDateString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).replace(/\//g, "-");

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="orders_${now}.csv"`,
      },
    });
  } catch (err) {
    console.error("Failed to export orders:", err);
    return NextResponse.json({ error: "匯出訂單失敗" }, { status: 500 });
  }
}

// 結單第二步：客戶端確認 CSV 已成功下載後，才清除資料庫中的所有訂單。
export async function DELETE() {
  try {
    await deleteAllOrders();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to delete orders:", err);
    return NextResponse.json({ error: "清除訂單失敗" }, { status: 500 });
  }
}
