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
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4 w-full">
      <Title level={3} style={{ margin: 0 }}>
        {title}
      </Title>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
          {actions}
        </div>
      )}
    </div>
  );
}
