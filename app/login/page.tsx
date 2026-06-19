"use client";

import { signIn, useSession } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Typography, Space, Spin } from "antd";
import { GoogleOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session) {
      router.replace("/");
    }
  }, [session, router]);

  if (status === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f0f2f5",
      }}
    >
      <Card style={{ width: 380, textAlign: "center", padding: "16px 0" }}>
        <Space orientation="vertical" size={24} style={{ width: "100%" }}>
          <div>
            <Title level={3} style={{ margin: 0, marginBottom: 8 }}>
              CC 生鮮後台管理系統
            </Title>
            <Text type="secondary">請使用授權的 Google 帳號登入</Text>
          </div>
          <Button
            type="primary"
            icon={<GoogleOutlined />}
            size="large"
            style={{ width: "100%" }}
            onClick={() => signIn("google", { callbackUrl: "/" })}
          >
            以 Google 帳號登入
          </Button>
        </Space>
      </Card>
    </div>
  );
}
