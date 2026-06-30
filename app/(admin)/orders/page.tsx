"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  Typography,
  Table,
  Button,
  Space,
  Input,
  InputNumber,
  Select,
  Tag,
  Modal,
  Form,
  Alert,
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
  PlusOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import {
  getPromoStrategy,
  calcLineSubtotal,
  type PromoConfig,
} from "@/app/lib/promotions";
import type {
  OrderRow as Order,
  OrderItemRow as OrderItem,
  CloseGroupSummary as CloseGroup,
} from "@/app/lib/orders";
import type { ProductRow } from "@/app/lib/products";
import type { PickupSpotRow } from "@/app/lib/pickup-spots";
import { fetchJson, postJson, downloadBlob } from "@/app/lib/api-client";
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

/** 路線篩選下拉的特殊值：宅配（無取貨點/路線）、未分路線（取貨點未指定路線）。 */
const DELIVERY = "__delivery__";
const UNASSIGNED = "unassigned";

/** 來源標籤選項（與後端 ORDER_TAGS 對應）；預設「網站」。 */
const TAG_OPTIONS = ["網站", "FB", "Line"] as const;

/** 來源標籤的顯示色。 */
function tagColor(tag: string): string {
  if (tag === "FB") return "blue";
  if (tag === "Line") return "green";
  return "default";
}

/** 新增訂單表單的明細列。 */
interface OrderItemFormValue {
  productId?: number;
  quantity?: number;
}

/** 新增訂單表單值。 */
interface CreateOrderFormValues {
  customerName: string;
  phone?: string;
  tag: string;
  deliveryMethod: "pickup" | "delivery";
  pickupSpotId?: number;
  shippingAddress?: string;
  note?: string;
  items: OrderItemFormValue[];
}

export default function OrdersPage() {
  const [routes, setRoutes] = useState<{ id: number; name: string }[]>([]);
  const [hasUnassigned, setHasUnassigned] = useState(false);
  const [hasDelivery, setHasDelivery] = useState(false);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [selected, setSelected] = useState<string | undefined>();
  const [data, setData] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeGroups, setCloseGroups] = useState<CloseGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [messageApi, contextHolder] = message.useMessage();

  // 新增訂單表單狀態
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [pickupSpots, setPickupSpots] = useState<PickupSpotRow[]>([]);
  const [createDataLoading, setCreateDataLoading] = useState(false);
  const [form] = Form.useForm<CreateOrderFormValues>();
  const watchedMethod = Form.useWatch("deliveryMethod", form);
  const watchedItems = Form.useWatch("items", form);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  // 依目前表單明細，以共用 calcLineSubtotal 即時估算總額（與後端計算邏輯一致）。
  const estimatedTotal = useMemo(() => {
    if (!watchedItems) return 0;
    return watchedItems.reduce((sum, item) => {
      const product = item?.productId
        ? productById.get(item.productId)
        : undefined;
      const qty = Number(item?.quantity);
      if (!product || !Number.isInteger(qty) || qty <= 0) return sum;
      const promo =
        product.promoType && product.promoConfig
          ? { type: product.promoType, config: product.promoConfig }
          : null;
      return sum + calcLineSubtotal(promo, product.price, qty);
    }, 0);
  }, [watchedItems, productById]);

  const openCreateModal = useCallback(async () => {
    setCreateOpen(true);
    setCreateDataLoading(true);
    try {
      const [prods, spots] = await Promise.all([
        fetchJson<ProductRow[]>("/api/products"),
        fetchJson<PickupSpotRow[]>("/api/pickup-spots"),
      ]);
      setProducts(prods);
      setPickupSpots(spots);
    } catch {
      messageApi.error("讀取商品或取貨點清單失敗");
    } finally {
      setCreateDataLoading(false);
    }
  }, [messageApi]);

  const closeCreateModal = useCallback(() => {
    setCreateOpen(false);
    form.resetFields();
  }, [form]);

  // 進到畫面時僅取得有訂單的路線清單（含未分路線/宅配旗標），不載入全部訂單。
  const fetchRouteOptions = useCallback(async () => {
    setRoutesLoading(true);
    try {
      const data = await fetchJson<{
        routes: { id: number; name: string }[];
        hasUnassigned: boolean;
        hasDelivery: boolean;
      }>("/api/orders");
      setRoutes(data.routes);
      setHasUnassigned(data.hasUnassigned);
      setHasDelivery(data.hasDelivery);
    } catch {
      messageApi.error("讀取路線清單失敗");
    } finally {
      setRoutesLoading(false);
    }
  }, [messageApi]);

  // 依選定的路線（含未分路線/宅配）查詢訂單。
  const fetchOrders = useCallback(
    async (target: string) => {
      setLoading(true);
      try {
        let url: string;
        if (target === DELIVERY) {
          url = "/api/orders?method=delivery";
        } else if (target === UNASSIGNED) {
          url = "/api/orders?route=unassigned";
        } else {
          url = `/api/orders?route=${encodeURIComponent(target)}`;
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

  const handleCreate = useCallback(async () => {
    let values: CreateOrderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 驗證失敗，antd 已標示欄位
    }
    setCreating(true);
    try {
      await postJson("/api/orders", {
        customerName: values.customerName,
        phone: values.phone,
        tag: values.tag,
        deliveryMethod: values.deliveryMethod,
        pickupSpotId:
          values.deliveryMethod === "pickup" ? values.pickupSpotId : null,
        shippingAddress:
          values.deliveryMethod === "delivery" ? values.shippingAddress : null,
        note: values.note,
        items: values.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
      });
      messageApi.success("訂單已新增");
      setCreateOpen(false);
      form.resetFields();
      // 重新整理路線清單；若目前正檢視某分組，連同訂單一起刷新。
      fetchRouteOptions();
      if (selected) fetchOrders(selected);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : "新增訂單失敗");
    } finally {
      setCreating(false);
    }
  }, [form, messageApi, fetchRouteOptions, fetchOrders, selected]);

  useEffect(() => {
    fetchRouteOptions();
  }, [fetchRouteOptions]);

  // 選定路線變動時查詢；未選則清空結果
  useEffect(() => {
    if (selected) fetchOrders(selected);
    else setData([]);
  }, [selected, fetchOrders]);

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
      routeId: group.routeId,
    });
    const filename = safeFilename(
      `orders_${group.display}_${taipeiDateStamp()}.csv`,
    );

    const refresh = () =>
      Promise.all([
        fetchCloseGroups(),
        fetchRouteOptions(),
        selected ? fetchOrders(selected) : Promise.resolve(),
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
      title: "來源",
      dataIndex: "tag",
      key: "tag",
      width: 90,
      render: (tag: string) => <Tag color={tagColor(tag)}>{tag || "網站"}</Tag>,
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
        {record.routeName && (
          <Descriptions.Item label="路線">
            {record.routeName}
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
          scroll={{ x: "max-content" }}
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
      <Card classNames={{ body: "p-3 sm:p-6" }}>
        <PageHeader
          title="訂單管理"
          actions={
            <Space wrap>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreateModal}
              >
                新增訂單
              </Button>
              <Select
                placeholder="選擇路線"
                className="w-full sm:w-44"
                value={selected}
                onChange={setSelected}
                loading={routesLoading}
                options={[
                  ...routes.map((r) => ({
                    label: r.name,
                    value: String(r.id),
                  })),
                  ...(hasUnassigned
                    ? [{ label: "未分路線", value: UNASSIGNED }]
                    : []),
                  ...(hasDelivery
                    ? [{ label: "宅配", value: DELIVERY }]
                    : []),
                ]}
                notFoundContent={
                  routesLoading ? <Spin size="small" /> : "目前沒有訂單"
                }
                showSearch={{
                  optionFilterProp: 'label'
                }}
                allowClear
              />
              <Input
                placeholder="於結果內篩選 (客戶/電話/地址/取貨號)"
                prefix={<SearchOutlined />}
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full sm:w-60"
              />
              <Button
                icon={<ReloadOutlined />}
                onClick={() => {
                  fetchRouteOptions();
                  if (selected) fetchOrders(selected);
                }}
                loading={routesLoading || loading}
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
                結單（依路線匯出並清除）
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

        {!selected ? (
          <Empty
            description="請先選擇路線以查詢訂單"
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
              pagination={{ defaultPageSize: 10, showSizeChanger: true }}
              locale={{ emptyText: "此路線目前沒有訂單" }}
              scroll={{ x: "max-content" }}
            />
          </Spin>
        )}
      </Card>

      <Modal
        title="結單（依路線）"
        open={closeModalOpen}
        onCancel={() => {
          if (!closing) setCloseModalOpen(false);
        }}
        footer={null}
      >
        <p style={{ color: "#8c8c8c", fontSize: 13 }}>
          每條路線、「未分路線」與「宅配」各自成一組，下載該組 CSV
          成功後才會清除該組訂單。
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
                    <Tag color="cyan">路線</Tag>
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

      <Modal
        title="新增訂單"
        open={createOpen}
        onOk={handleCreate}
        onCancel={closeCreateModal}
        okText="建立訂單"
        cancelText="取消"
        confirmLoading={creating}
        width={720}
        destroyOnHidden
      >
        <Spin spinning={createDataLoading}>
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              tag: "網站",
              deliveryMethod: "pickup",
              items: [{ quantity: 1 }],
            }}
          >
            <Form.Item
              label="客戶姓名"
              name="customerName"
              rules={[{ required: true, message: "請輸入客戶姓名" }]}
            >
              <Input placeholder="客戶姓名" maxLength={100} />
            </Form.Item>

            <Space size="middle" className="w-full" wrap>
              <Form.Item label="電話" name="phone">
                <Input placeholder="選填" />
              </Form.Item>
              <Form.Item
                label="來源"
                name="tag"
                rules={[{ required: true }]}
              >
                <Select
                  className="w-32"
                  options={TAG_OPTIONS.map((t) => ({ label: t, value: t }))}
                />
              </Form.Item>
              <Form.Item
                label="取貨方式"
                name="deliveryMethod"
                rules={[{ required: true }]}
              >
                <Select
                  className="w-32"
                  options={[
                    { label: "自取", value: "pickup" },
                    { label: "宅配", value: "delivery" },
                  ]}
                />
              </Form.Item>
            </Space>

            {watchedMethod === "delivery" ? (
              <Form.Item
                label="宅配地址"
                name="shippingAddress"
                rules={[{ required: true, message: "請輸入宅配地址" }]}
              >
                <Input placeholder="收件地址" />
              </Form.Item>
            ) : (
              <>
                {pickupSpots.length === 0 && !createDataLoading && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="目前沒有可用的取貨點，請先於「自取地點」建立後，再新增自取訂單。"
                  />
                )}
                <Form.Item
                  label="取貨點"
                  name="pickupSpotId"
                  rules={[{ required: true, message: "請選擇取貨點" }]}
                >
                  <Select
                    placeholder="選擇取貨點"
                    showSearch={{
                      optionFilterProp: 'label'
                    }}
                    options={pickupSpots.map((s) => ({
                      label: `${s.city} ${s.township}`,
                      value: s.id,
                    }))}
                    notFoundContent="尚無取貨點"
                  />
                </Form.Item>
              </>
            )}

            <Form.List name="items">
              {(fields, { add, remove }) => (
                <div>
                  <div style={{ marginBottom: 8, fontWeight: 500 }}>商品明細</div>
                  {fields.map((field) => (
                    <Space
                      key={field.key}
                      align="baseline"
                      style={{ display: "flex", marginBottom: 8 }}
                    >
                      <Form.Item
                        name={[field.name, "productId"]}
                        rules={[{ required: true, message: "請選擇商品" }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Select
                          placeholder="選擇商品"
                          showSearch={{
                            optionFilterProp: 'label'
                          }}
                          style={{ width: 360 }}
                          options={products.map((p) => ({
                            label: `${p.name}（$${p.price}${p.promoSummary ? ` · ${p.promoSummary}` : ""
                              }）`,
                            value: p.id,
                          }))}
                          notFoundContent="尚無商品"
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "quantity"]}
                        rules={[{ required: true, message: "請輸入數量" }]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber min={1} precision={0} placeholder="數量" />
                      </Form.Item>
                      {fields.length > 1 && (
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => remove(field.name)}
                        />
                      )}
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    onClick={() => add({ quantity: 1 })}
                    icon={<PlusOutlined />}
                    block
                  >
                    新增商品
                  </Button>
                </div>
              )}
            </Form.List>

            <Form.Item label="備註" name="note" style={{ marginTop: 16 }}>
              <Input.TextArea rows={2} placeholder="選填" />
            </Form.Item>

            <div style={{ textAlign: "right" }}>
              <Text type="secondary" style={{ marginRight: 8 }}>
                預估總額
              </Text>
              <Text strong style={{ fontSize: 18, color: "#cf1322" }}>
                ${estimatedTotal}
              </Text>
            </div>
          </Form>
        </Spin>
      </Modal>
    </>
  );
}
