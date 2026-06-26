"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  Typography,
  Table,
  Button,
  Space,
  Input,
  Select,
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
  FileWordOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { getPromoStrategy, type PromoConfig } from "@/app/lib/promotions";
import type {
  OrderRow as Order,
  OrderItemRow as OrderItem,
  OrderLocation,
  CloseGroupSummary as CloseGroup,
} from "@/app/lib/orders";
import { fetchJson, downloadBlob } from "@/app/lib/api-client";
import { safeFilename, taipeiDateStamp } from "@/app/lib/csv";
import { PageHeader } from "@/app/components/page-header";

const { Text } = Typography;

/** 將明細的促銷快照轉成顯示文字（找不到對應策略時不顯示） */
function describePromo(
  promoType: string | null,
  promoConfig: PromoConfig | null,
): string | null {
  if (!promoType || !promoConfig) return null;
  const strategy = getPromoStrategy(promoType);
  if (!strategy) return null;
  return strategy.describe(promoConfig);
}

/** 縣市下拉選單中代表「宅配」的特殊值（宅配無結構化縣市，故獨立成一個選項） */
const DELIVERY_CITY = "__delivery__";

export default function OrdersPage() {
  const [locations, setLocations] = useState<OrderLocation[]>([]);
  const [hasDelivery, setHasDelivery] = useState(false);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [city, setCity] = useState<string | undefined>();
  const [township, setTownship] = useState<string | undefined>();
  const [data, setData] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeGroups, setCloseGroups] = useState<CloseGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [messageApi, contextHolder] = message.useMessage();

  // 進到畫面時僅取得有訂單的縣市/鄉鎮清單，不載入全部訂單
  const fetchLocations = useCallback(async () => {
    setLocationsLoading(true);
    try {
      const data = await fetchJson<{
        locations: OrderLocation[];
        hasDelivery: boolean;
      }>("/api/orders");
      setLocations(data.locations);
      setHasDelivery(data.hasDelivery);
    } catch {
      messageApi.error("讀取縣市/地點清單失敗");
    } finally {
      setLocationsLoading(false);
    }
  }, [messageApi]);

  // 依選定的縣市（可再加鄉鎮）查詢訂單
  const fetchOrders = useCallback(
    async (targetCity: string, targetTownship?: string) => {
      setLoading(true);
      try {
        let url: string;
        if (targetCity === DELIVERY_CITY) {
          url = "/api/orders?method=delivery";
        } else {
          const params = new URLSearchParams({ city: targetCity });
          if (targetTownship) params.set("township", targetTownship);
          url = `/api/orders?${params.toString()}`;
        }
        setData(await fetchJson<Order[]>(url));
      } catch {
        messageApi.error("讀取訂單資料失敗");
      } finally {
        setLoading(false);
      }
    },
    [messageApi],
  );

  // 取得各結單分組筆數（結單視窗使用），不需載入全部訂單明細
  const fetchCloseGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const data = await fetchJson<{ groups: CloseGroup[] }>(
        "/api/orders/close",
      );
      setCloseGroups(data.groups);
    } catch {
      messageApi.error("讀取結單分組失敗");
    } finally {
      setGroupsLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  // 縣市/鄉鎮變動時查詢；未選縣市則清空結果
  useEffect(() => {
    if (city) fetchOrders(city, township);
    else setData([]);
  }, [city, township, fetchOrders]);

  const townshipOptions = useMemo(
    () => locations.find((l) => l.city === city)?.townships ?? [],
    [locations, city],
  );

  const openCloseModal = () => {
    setCloseModalOpen(true);
    fetchCloseGroups();
  };

  const filtered = data.filter(
    (order) =>
      order.customerName.includes(search) ||
      (order.phone ?? "").includes(search) ||
      (order.pickupSpotLabel ?? "").includes(search) ||
      (order.shippingAddress ?? "").includes(search) ||
      (order.pickupNumber != null &&
        String(order.pickupNumber).includes(search)) ||
      String(order.id).includes(search),
  );

  const closeGroup = async (group: CloseGroup) => {
    const body = JSON.stringify({
      method: group.method,
      pickupSpotId: group.pickupSpotId,
    });
    const filename = safeFilename(
      `orders_${group.display}_${taipeiDateStamp()}.csv`,
    );

    const refresh = () =>
      Promise.all([
        fetchCloseGroups(),
        fetchLocations(),
        city ? fetchOrders(city, township) : Promise.resolve(),
      ]);

    setClosing(true);
    setClosingKey(group.key);
    try {
      const res = await fetch("/api/orders/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        messageApi.error(err?.error || "結單失敗");
        return;
      }

      // 先下載 CSV，確認檔案到手後才清除資料庫
      downloadBlob(await res.blob(), filename);

      // CSV 已成功下載，再請求刪除該分組
      const delRes = await fetch("/api/orders/close", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!delRes.ok) {
        messageApi.warning("CSV 已下載，但清除訂單失敗，請重新整理後再試");
        await refresh();
        return;
      }

      messageApi.success(`「${group.display}」結單完成，CSV 已下載`);
      await refresh();
    } catch {
      messageApi.error("結單失敗，請稍後再試");
    } finally {
      setClosing(false);
      setClosingKey(null);
    }
  };

  const handleCloseGroup = (group: CloseGroup) => {
    Modal.confirm({
      title: `確定結單「${group.display}」？`,
      icon: <ExclamationCircleFilled />,
      content: (
        <div>
          <p>此操作將：</p>
          <ol style={{ paddingLeft: 20 }}>
            <li>匯出此分組的 {group.count} 筆訂單為 CSV 下載到本機</li>
            <li>刪除資料庫中此分組的訂單資料</li>
          </ol>
          <p style={{ color: "#ff4d4f", fontWeight: 500 }}>
            ⚠️ 此操作無法復原，請確認已做好備份！
          </p>
        </div>
      ),
      okText: "確定結單",
      okType: "danger",
      cancelText: "取消",
      onOk: () => closeGroup(group),
    });
  };

  const columns: ColumnsType<Order> = [
    {
      title: "取貨號",
      key: "pickupNumber",
      width: 90,
      render: (_: unknown, order: Order) =>
        order.deliveryMethod === "delivery" || order.pickupNumber == null ? (
          "-"
        ) : (
          <Tag color="geekblue" style={{ fontSize: 16, fontWeight: 700 }}>
            {order.pickupNumber}
          </Tag>
        ),
    },
    {
      title: "客戶",
      dataIndex: "customerName",
      key: "customerName",
      width: 160,
      ellipsis: true,
    },
    {
      title: "總額",
      dataIndex: "total",
      key: "total",
      width: 110,
      render: (total: number) => (
        <Text strong style={{ color: "#cf1322" }}>
          ${total}
        </Text>
      ),
    },
    {
      title: "電話",
      dataIndex: "phone",
      key: "phone",
      width: 140,
      render: (phone: string | null) => phone ?? "-",
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
        {record.deliveryMethod === "delivery" && record.shippingAddress && (
          <Descriptions.Item label="宅配地址">
            {record.shippingAddress}
          </Descriptions.Item>
        )}
        {record.pickupSpotLabel && (
          <Descriptions.Item label="自取點">
            {record.pickupSpotLabel}
          </Descriptions.Item>
        )}
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
              title: "優惠",
              key: "promo",
              width: 120,
              render: (_: unknown, item: OrderItem) => {
                const text = describePromo(item.promoType, item.promoConfig);
                return text ? <Tag color="volcano">{text}</Tag> : "-";
              },
            },
            {
              title: "小計",
              key: "subtotal",
              width: 100,
              render: (_: unknown, item: OrderItem) => {
                const original = item.unitPrice * item.quantity;
                const discounted = item.subtotal < original;
                return (
                  <Space size={4}>
                    {discounted && (
                      <Text delete type="secondary" style={{ fontSize: 12 }}>
                        ${original}
                      </Text>
                    )}
                    <Text strong={discounted}>${item.subtotal}</Text>
                  </Space>
                );
              },
            },
          ]}
        />
      ) : (
        <Empty
          description="此訂單無明細項目"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}
    </div>
  );

  return (
    <>
      {contextHolder}
      <Spin spinning={closing} fullscreen description="結單處理中…" />
      <Card>
        <PageHeader
          title="訂單管理"
          actions={
            <Space wrap>
              <Select
                placeholder="選擇縣市"
                style={{ width: 160 }}
                value={city}
                onChange={(value) => {
                  setCity(value);
                  setTownship(undefined);
                }}
                loading={locationsLoading}
                options={[
                  ...(hasDelivery
                    ? [{ label: "宅配", value: DELIVERY_CITY }]
                    : []),
                  ...locations.map((l) => ({ label: l.city, value: l.city })),
                ]}
                notFoundContent={
                  locationsLoading ? <Spin size="small" /> : "目前沒有訂單"
                }
                showSearch
                allowClear
              />
              <Select
                placeholder="選擇地點（全部）"
                style={{ width: 160 }}
                value={township}
                onChange={setTownship}
                disabled={!city || city === DELIVERY_CITY}
                options={townshipOptions.map((t) => ({ label: t, value: t }))}
                showSearch
                allowClear
              />
              <Input
                placeholder="於結果內篩選 (客戶/電話/地址/取貨號)"
                prefix={<SearchOutlined />}
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ width: 240 }}
              />
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  fetchLocations();
                  if (city) fetchOrders(city, township);
                }}
                loading={locationsLoading || loading}
              >
                重新載入
              </Button>
              <Button
                icon={<FileWordOutlined />}
                href={`/${encodeURIComponent("標籤.docx")}`}
                download="標籤.docx"
              >
                下載標籤範本
              </Button>
              <Button
                danger
                type="primary"
                icon={<DownloadOutlined />}
                onClick={openCloseModal}
              >
                結單（依分組匯出並清除）
              </Button>
            </Space>
          }
        />

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
            💡 因使用 Neon
            免費版資料庫，建議定期使用「結單」功能匯出訂單後清除資料，以節省雲端儲存空間。
          </Text>
        </div>

        {!city ? (
          <Empty
            description="請先選擇縣市（可再選地點）以查詢訂單"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
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
              locale={{ emptyText: "此縣市/地點目前沒有訂單" }}
            />
          </Spin>
        )}
      </Card>

      <Modal
        title="結單（依分組）"
        open={closeModalOpen}
        onCancel={() => setCloseModalOpen(false)}
        footer={null}
        mask={{ closable: !closing }}
      >
        <p style={{ color: "#8c8c8c", fontSize: 13 }}>
          每個自取點與「宅配」各自成一組，下載該組 CSV 成功後才會清除該組訂單。
        </p>
        <Spin spinning={groupsLoading}>
          {closeGroups.length === 0 ? (
            <Empty
              description={groupsLoading ? "讀取中…" : "目前沒有訂單"}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            closeGroups.map((group) => (
              <div
                key={group.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 0",
                  borderBottom: "1px solid #f0f0f0",
                }}
              >
                <Space>
                  {group.method === "delivery" ? (
                    <Tag color="purple">宅配</Tag>
                  ) : (
                    <Tag color="cyan">自取</Tag>
                  )}
                  <Text>{group.display}</Text>
                  <Text type="secondary">{group.count} 筆</Text>
                </Space>
                <Button
                  danger
                  type="primary"
                  size="small"
                  icon={<DownloadOutlined />}
                  loading={closingKey === group.key}
                  disabled={closing && closingKey !== group.key}
                  onClick={() => handleCloseGroup(group)}
                >
                  下載並結單
                </Button>
              </div>
            ))
          )}
        </Spin>
      </Modal>
    </>
  );
}
