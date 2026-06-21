"use client";

import { Typography } from "antd";
import type { ReactNode } from "react";

const { Title } = Typography;

/** 各管理頁共用的標題列：左側標題、右側操作區（搜尋/重新載入/新增等）。 */
export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
      }}
    >
      <Title level={3} style={{ margin: 0 }}>
        {title}
      </Title>
      {actions}
    </div>
  );
}
