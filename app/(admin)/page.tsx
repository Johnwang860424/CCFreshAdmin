"use client";

import { Card, Empty, Typography } from "antd";

const { Title } = Typography;

export default function HomePage() {
  return (
    <Card>
      <Title level={3}>CC 生鮮後台管理系統</Title>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="請從左側選單選擇要進行的功能"
      />
    </Card>
  );
}
