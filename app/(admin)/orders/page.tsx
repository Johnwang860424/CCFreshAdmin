"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Typography,
  Table,
  Button,
  Space,
  Input,
  Tag,
  Modal,
  message,
  Spin,
  Descriptions,
  Empty,
} from "antd";
import {
  SearchOutlined,
  ReloadOutlined,
  DownloadOutlined,
  ExclamationCircleFilled,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

const { Title, Text } = Typography;

interface OrderItem {
  id: number;
  orderId: number;
  productName: string;
  unitPrice: number;
  quantity: number;
}

interface Order {
  id: number;
  customerName: string;
  phone: string | null;
  pickupLabel: string | null;
  status: string;
  note: string | null;
  total: number;
  createdAt: string;
  items: OrderItem[];
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending: { color: "gold", label: "待處理" },
  confirmed: { color: "blue", label: "已確認" },
  completed: { color: "green", label: "已完成" },
  cancelled: { color: "default", label: "已取消" },
};

export default function OrdersPage() {
  const [data, setData] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [search, setSearch] = useState("");
  const [messageApi, contextHolder] = message.useMessage();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/orders");
      if (!res.ok) throw new Error("Failed to fetch");
      const orders: Order[] = await res.json();
      setData(orders);
    } catch {
      messageApi.error("讀取訂單資料失敗");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = data.filter(
    (order) =>
      order.customerName.includes(search) ||
      (order.phone ?? "").includes(search) ||
      (order.pickupLabel ?? "").includes(search) ||
      String(order.id).includes(search)
  );

  const handleCloseOrders = () => {
    Modal.confirm({
      title: "確定結單？",
      icon: <ExclamationCircleFilled />,
      content: (
        <div>
          <p>此操作將：</p>
          <ol style={{ paddingLeft: 20 }}>
            <li>匯出所有訂單為 CSV 檔案下載到本機</li>
            <li>刪除資料庫中的所有訂單資料</li>
          </ol>
          <p style={{ color: "#ff4d4f", fontWeight: 500 }}>
            ⚠️ 此操作無法復原，請確認已做好備份！
          </p>
        </div>
      ),
      okText: "確定結單",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        setClosing(true);
        try {
          const res = await fetch("/api/orders/close", { method: "POST" });

          if (!res.ok) {
            const err = await res.json();
            messageApi.error(err.error || "結單失敗");
            return;
          }

          // Download CSV first — only clear the DB once the file is in hand
          const blob = await res.blob();
          const disposition = res.headers.get("Content-Disposition") ?? "";
          const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
          const filename = filenameMatch?.[1] ?? "orders.csv";

          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          // CSV 已成功下載，再請求刪除訂單
          const delRes = await fetch("/api/orders/close", { method: "DELETE" });
          if (!delRes.ok) {
            messageApi.warning("CSV 已下載，但清除訂單失敗，請重新整理後再試");
            await fetchData();
            return;
          }

          messageApi.success("結單完成，CSV 已下載");
          await fetchData();
        } catch {
          messageApi.error("結單失敗，請稍後再試");
        } finally {
          setClosing(false);
        }
      },
    });
  };

  const columns: ColumnsType<Order> = [
    {
      title: "訂單編號",
      dataIndex: "id",
      key: "id",
      width: 100,
      render: (id: number) => <Text strong>#{id}</Text>,
    },
    {
      title: "客戶",
      dataIndex: "customerName",
      key: "customerName",
    },
    {
      title: "電話",
      dataIndex: "phone",
      key: "phone",
      render: (phone: string | null) => phone ?? "-",
    },
    {
      title: "自取點",
      dataIndex: "pickupLabel",
      key: "pickupLabel",
      render: (label: string | null) => label ?? "-",
    },
    {
      title: "狀態",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => {
        const config = STATUS_CONFIG[status] ?? {
          color: "default",
          label: status,
        };
        return <Tag color={config.color}>{config.label}</Tag>;
      },
    },
    {
      title: "總額",
      dataIndex: "total",
      key: "total",
      width: 100,
      render: (total: number) => (
        <Text strong style={{ color: "#cf1322" }}>
          ${total}
        </Text>
      ),
    },
    {
      title: "建立時間",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (createdAt: string) =>
        new Date(createdAt).toLocaleString("zh-TW", {
          timeZone: "Asia/Taipei",
        }),
    },
  ];

  const expandedRowRender = (record: Order) => (
    <div style={{ padding: "0 16px" }}>
      <Descriptions
        size="small"
        column={1}
        style={{ marginBottom: record.items.length > 0 ? 12 : 0 }}
      >
        {record.note && (
          <Descriptions.Item label="備註">{record.note}</Descriptions.Item>
        )}
      </Descriptions>
      {record.items.length > 0 ? (
        <Table
          rowKey="id"
          dataSource={record.items}
          pagination={false}
          size="small"
          columns={[
            {
              title: "商品",
              dataIndex: "productName",
              key: "productName",
            },
            {
              title: "單價",
              dataIndex: "unitPrice",
              key: "unitPrice",
              width: 80,
              render: (v: number) => `$${v}`,
            },
            {
              title: "數量",
              dataIndex: "quantity",
              key: "quantity",
              width: 60,
            },
            {
              title: "小計",
              key: "subtotal",
              width: 80,
              render: (_: unknown, item: OrderItem) =>
                `$${item.unitPrice * item.quantity}`,
            },
          ]}
        />
      ) : (
        <Empty description="此訂單無明細項目" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}
    </div>
  );

  return (
    <>
      {contextHolder}
      <Spin spinning={closing} fullscreen description="結單處理中…" />
      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <Title level={3} style={{ margin: 0 }}>
            訂單管理
          </Title>
          <Space>
            <Input
              placeholder="搜尋訂單 (客戶/電話/自取點)"
              prefix={<SearchOutlined />}
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 260 }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={fetchData}
              loading={loading}
            >
              重新載入
            </Button>
            <Button
              danger
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleCloseOrders}
              disabled={data.length === 0}
            >
              結單（匯出並清除）
            </Button>
          </Space>
        </div>

        <div
          style={{
            marginBottom: 16,
            padding: "8px 16px",
            background: "#fffbe6",
            border: "1px solid #ffe58f",
            borderRadius: 6,
          }}
        >
          <Text type="warning" style={{ fontSize: 13 }}>
            💡 因使用 Neon 免費版資料庫，建議定期使用「結單」功能匯出訂單後清除資料，以節省雲端儲存空間。
          </Text>
        </div>

        <Spin spinning={loading}>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            expandable={{
              expandedRowRender,
              rowExpandable: () => true,
            }}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            locale={{ emptyText: "目前沒有訂單" }}
          />
        </Spin>
      </Card>
    </>
  );
}
