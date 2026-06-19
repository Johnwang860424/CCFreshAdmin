"use client";

import { Card, Typography } from "antd";

const { Title, Text } = Typography;

export default function ProductsPage() {
  return (
    <Card>
      <Title level={3}>訂單管理</Title>
      <Text type="secondary">訂單列表尚未建置。</Text>
    </Card>
  );
}
