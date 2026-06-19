"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Layout, Menu, Typography, Button, Avatar, Space, Image } from "antd";
import {
  ShopOutlined,
  LogoutOutlined,
  UserOutlined,
  ShoppingCartOutlined,
  EnvironmentOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: "/pickup-spots", icon: <EnvironmentOutlined />, label: "自取點管理" },
  { key: "/categories", icon: <AppstoreOutlined />, label: "分類管理" },
  { key: "/products", icon: <ShopOutlined />, label: "商品管理" },
  { key: "/orders", icon: <ShoppingCartOutlined />, label: "訂單管理" },
];

export function AdminShell({
  userName,
  userEmail,
  children,
}: {
  userName?: string | null;
  userEmail?: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const selectedKey = menuItems
    .map((item) => item.key)
    .filter((key) => pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => router.push("/")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") router.push("/");
          }}
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: collapsed ? 0 : 8,
            color: "#fff",
            padding: "0 12px",
            cursor: "pointer",
          }}
        >
          <Image
            src="/logo.jpg"
            alt="CC 生鮮"
            width={collapsed ? 32 : 36}
            height={collapsed ? 32 : 36}
            style={{ borderRadius: "50%", flexShrink: 0 }}
          />
          {!collapsed && (
            <span
              style={{ fontSize: 16, fontWeight: 600, whiteSpace: "nowrap" }}
            >
              CC 生鮮
            </span>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selectedKey ? [selectedKey] : []}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            paddingInline: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <Space size={16}>
            <Space size={8}>
              <Avatar size="small" icon={<UserOutlined />} />
              <Text type="secondary">{userName ?? userEmail}</Text>
            </Space>
            <Button
              icon={<LogoutOutlined />}
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              登出
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: 24 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
