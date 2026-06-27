"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Layout, Menu, Typography, Button, Avatar, Space, Image, Drawer, Grid } from "antd";
import {
  ShopOutlined,
  LogoutOutlined,
  UserOutlined,
  ShoppingCartOutlined,
  EnvironmentOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  MenuOutlined,
} from "@ant-design/icons";

const { Sider, Header, Content } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: "/pickup-spots", icon: <EnvironmentOutlined />, label: "自取點管理" },
  { key: "/categories", icon: <AppstoreOutlined />, label: "分類管理" },
  { key: "/products", icon: <ShopOutlined />, label: "商品管理" },
  { key: "/order-summary", icon: <BarChartOutlined />, label: "縣市訂單統計" },
  { key: "/orders", icon: <ShoppingCartOutlined />, label: "訂單管理" },
];

export function AdminShell({
  userName,
  userEmail,
  userImage,
  children,
}: {
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const screens = Grid.useBreakpoint();

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsMounted(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const isMobile = isMounted ? !screens.md : false;

  const selectedKey = menuItems
    .map((item) => item.key)
    .filter((key) => pathname.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];

  const logoContent = (isCollapsed: boolean) => (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        setDrawerOpen(false);
        router.push("/");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          setDrawerOpen(false);
          router.push("/");
        }
      }}
      style={{
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: isCollapsed ? "center" : "flex-start",
        gap: isCollapsed ? 0 : 8,
        color: "#fff",
        padding: "0 12px",
        cursor: "pointer",
      }}
    >
      <Image
        src="/logo.jpg"
        alt="CC 生鮮"
        width={isCollapsed ? 32 : 36}
        height={isCollapsed ? 32 : 36}
        style={{ borderRadius: "50%", flexShrink: 0 }}
        preview={false}
      />
      {!isCollapsed && (
        <span
          style={{ fontSize: 16, fontWeight: 600, whiteSpace: "nowrap" }}
        >
          CC 生鮮
        </span>
      )}
    </div>
  );

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {!isMobile && (
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          theme="dark"
        >
          {logoContent(collapsed)}
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={selectedKey ? [selectedKey] : []}
            items={menuItems}
            onClick={({ key }) => router.push(key)}
          />
        </Sider>
      )}

      {isMobile && (
        <Drawer
          title={
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Image
                src="/logo.jpg"
                alt="CC 生鮮"
                width={32}
                height={32}
                style={{ borderRadius: "50%" }}
                preview={false}
              />
              <span style={{ color: "#fff", fontSize: 16, fontWeight: 600 }}>CC 生鮮</span>
            </div>
          }
          placement="left"
          onClose={() => setDrawerOpen(false)}
          open={drawerOpen}
          styles={{
            body: { padding: 0, background: "#001529" },
            header: { background: "#001529", color: "#fff", borderBottom: "1px solid #000c17" },
          }}
          size={240}
        >
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={selectedKey ? [selectedKey] : []}
            items={menuItems}
            onClick={({ key }) => {
              setDrawerOpen(false);
              router.push(key);
            }}
            style={{ height: "100%", borderRight: 0 }}
          />
        </Drawer>
      )}

      <Layout>
        <Header
          style={{
            background: "#fff",
            paddingInline: isMobile ? 16 : 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          {isMobile ? (
            <Button
              type="text"
              icon={<MenuOutlined style={{ fontSize: 18 }} />}
              onClick={() => setDrawerOpen(true)}
            />
          ) : (
            <div />
          )}

          <Space size={isMobile ? 8 : 16}>
            <Space size={8}>
              <Avatar size="small" src={userImage} icon={!userImage ? <UserOutlined /> : undefined} />
              {!isMobile && <Text type="secondary">{userName ?? userEmail}</Text>}
            </Space>
            <Button
              icon={<LogoutOutlined />}
              onClick={() => signOut({ callbackUrl: "/login" })}
              size={isMobile ? "small" : "middle"}
            >
              登出
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: isMobile ? 12 : 24 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
