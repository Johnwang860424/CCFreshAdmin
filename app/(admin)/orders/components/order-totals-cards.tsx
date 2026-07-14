"use client";

// 訂單管理的金額儀表板：路線總金額卡片 + 各站點總金額（含占比長條）。
// 純顯示元件，金額統計由頁面依篩選結果計算後傳入。
import { DollarOutlined, EnvironmentOutlined } from "@ant-design/icons";

export function OrderTotalsCards({
  routeTotal,
  orderCount,
  stationTotals,
}: {
  /** 篩選結果的總金額。 */
  routeTotal: number;
  /** 篩選結果的訂單筆數。 */
  orderCount: number;
  /** 各站點（宅配/未指定自取點為內建分組）總金額，已依金額降冪。 */
  stationTotals: { label: string; total: number }[];
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 16,
        marginBottom: 16,
      }}
    >
      {/* 路線總金額卡片 */}
      <div
        style={{
          background: "linear-gradient(135deg, #1890ff 0%, #722ed1 100%)",
          borderRadius: 12,
          padding: "20px 24px",
          color: "#fff",
          boxShadow: "0 4px 12px rgba(24, 144, 255, 0.15)",
          position: "relative",
          overflow: "hidden",
          transition: "all 0.3s ease",
        }}
        className="hover:scale-[1.01] hover:shadow-lg"
      >
        <div style={{ opacity: 0.15, position: "absolute", right: -10, bottom: -10, fontSize: 120, lineHeight: 1 }}>
          <DollarOutlined />
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, opacity: 0.85, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <DollarOutlined />
          路線總金額
        </div>
        <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8, fontFamily: "Inter, sans-serif" }}>
          ${routeTotal.toLocaleString()}
        </div>
        <div style={{ fontSize: 13, opacity: 0.9 }}>
          篩選結果共 <span style={{ fontWeight: 600 }}>{orderCount}</span> 筆訂單
        </div>
      </div>

      {/* 站點總金額卡片 */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #f0f0f0",
          borderRadius: 12,
          padding: "20px 24px",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
          display: "flex",
          flexDirection: "column",
          maxHeight: 220,
          overflowY: "auto",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "#262626", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <EnvironmentOutlined style={{ color: "#1890ff" }} />
          各站點總金額
        </div>
        {stationTotals.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#bfbfbf", fontSize: 13 }}>
            無站點資料
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {stationTotals.map(({ label, total }) => {
              const percentage = routeTotal > 0 ? Math.round((total / routeTotal) * 100) : 0;
              return (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "4px 8px",
                    borderRadius: 6,
                    transition: "background 0.2s",
                  }}
                  className="hover:bg-gray-50"
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ fontWeight: 500, color: "#595959" }}>{label}</span>
                    <span style={{ fontWeight: 600, color: "#262626" }}>
                      ${total.toLocaleString()} ({percentage}%)
                    </span>
                  </div>
                  <div style={{ height: 6, width: "100%", background: "#f5f5f5", borderRadius: 3, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${percentage}%`,
                        background: "linear-gradient(90deg, #1890ff 0%, #36cfc9 100%)",
                        borderRadius: 3,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
