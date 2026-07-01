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
  App,
  Spin,
  Descriptions,
  Empty,
  Popconfirm,
} from "antd";
import {
  SearchOutlined,
  ReloadOutlined,
  DownloadOutlined,
  ExclamationCircleFilled,
  FileWordOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
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
import {
  fetchJson,
  postJson,
  putJson,
  deleteJson,
  downloadBlob,
} from "@/app/lib/api-client";
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

/**
 * 修改訂單的明細列：
 * - 既有明細帶 `itemId`（＋唯讀顯示用 `productName`），保留原快照僅改數量。
 * - 新增明細帶 `productId`（自商品清單挑選）。
 */
interface EditItemFormValue {
  itemId?: number;
  productName?: string;
  productId?: number;
  quantity?: number;
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
  const { modal, message: messageApi } = App.useApp();

  // 新增訂單表單狀態
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [pickupSpots, setPickupSpots] = useState<PickupSpotRow[]>([]);
  const [createDataLoading, setCreateDataLoading] = useState(false);
  const [form] = Form.useForm<CreateOrderFormValues>();
  const watchedMethod = Form.useWatch("deliveryMethod", form);
  const watchedItems = Form.useWatch("items", form);

  // 修改訂單表單狀態
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [editDataLoading, setEditDataLoading] = useState(false);
  const [editForm] = Form.useForm<{ items: EditItemFormValue[] }>();
  const watchedEditItems = Form.useWatch("items", editForm);

  // 匯出 CSV 進行中的分組 key（與出貨的 closingKey 分開，兩動作獨立）
  const [exportingKey, setExportingKey] = useState<string | null>(null);

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

  // 編輯中訂單的既有明細（依 order_items.id），供既有列改量時以原快照估算小計。
  const editItemById = useMemo(
    () => new Map((editOrder?.items ?? []).map((i) => [i.id, i])),
    [editOrder],
  );

  // 編輯視窗即時預估總額：既有列用原快照、新增列用商品現價（與後端計算一致）。
  const estimatedEditTotal = useMemo(() => {
    if (!watchedEditItems) return 0;
    return watchedEditItems.reduce((sum, row) => {
      const qty = Number(row?.quantity);
      if (!Number.isInteger(qty) || qty <= 0) return sum;
      if (row?.itemId != null) {
        const it = editItemById.get(row.itemId);
        if (!it) return sum;
        const promo =
          it.promoType && it.promoConfig
            ? { type: it.promoType, config: it.promoConfig }
            : null;
        return sum + calcLineSubtotal(promo, it.unitPrice, qty);
      }
      const product = row?.productId ? productById.get(row.productId) : undefined;
      if (!product) return sum;
      const promo =
        product.promoType && product.promoConfig
          ? { type: product.promoType, config: product.promoConfig }
          : null;
      return sum + calcLineSubtotal(promo, product.price, qty);
    }, 0);
  }, [watchedEditItems, editItemById, productById]);

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

  // 開啟修改視窗：帶入該訂單既有明細（保留 order_items.id），並確保已載入商品清單供新增列挑選。
  const openEditModal = useCallback(
    async (order: Order) => {
      setEditOrder(order);
      editForm.setFieldsValue({
        items: order.items.map((i) => ({
          itemId: i.id,
          productName: i.productName,
          quantity: i.quantity,
        })),
      });
      setEditOpen(true);
      if (products.length === 0) {
        setEditDataLoading(true);
        try {
          setProducts(await fetchJson<ProductRow[]>("/api/products"));
        } catch {
          messageApi.error("讀取商品清單失敗");
        } finally {
          setEditDataLoading(false);
        }
      }
    },
    [editForm, products.length, messageApi],
  );

  const closeEditModal = useCallback(() => {
    setEditOpen(false);
    setEditOrder(null);
    editForm.resetFields();
  }, [editForm]);

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

  const handleUpdate = useCallback(async () => {
    if (!editOrder) return;
    let values: { items: EditItemFormValue[] };
    try {
      values = await editForm.validateFields();
    } catch {
      return; // 驗證失敗，antd 已標示欄位
    }
    const items = (values.items ?? []).map((row) =>
      row.itemId != null
        ? { id: row.itemId, quantity: row.quantity }
        : { productId: row.productId, quantity: row.quantity },
    );
    if (items.length === 0) {
      messageApi.error("訂單至少需保留一項明細，如需清空請改用刪除訂單");
      return;
    }
    setEditing(true);
    try {
      await putJson(`/api/orders/${editOrder.id}`, { items });
      messageApi.success("訂單已更新");
      closeEditModal();
      fetchRouteOptions();
      if (selected) fetchOrders(selected);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : "修改訂單失敗");
    } finally {
      setEditing(false);
    }
  }, [
    editOrder,
    editForm,
    messageApi,
    closeEditModal,
    fetchRouteOptions,
    fetchOrders,
    selected,
  ]);

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

  // 刪除單筆訂單（明細一併清除）；成功後刷新路線清單與目前分組。
  const removeOrder = async (order: Order) => {
    try {
      await deleteJson(`/api/orders/${order.id}`);
      messageApi.success("訂單已刪除");
      fetchRouteOptions();
      if (selected) fetchOrders(selected);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : "刪除訂單失敗");
    }
  };

  // 匯出 CSV：僅下載該分組 CSV，不清除任何資料，可重複匯出。
  const exportGroupCsv = async (group: CloseGroup) => {
    const body = JSON.stringify({
      method: group.method,
      routeId: group.routeId,
    });
    const filename = safeFilename(
      `orders_${group.display}_${taipeiDateStamp()}.xlsx`,
    );
    setExportingKey(group.key);
    try {
      const res = await fetch("/api/orders/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        messageApi.error(err?.error || "匯出失敗");
        return;
      }
      downloadBlob(await res.blob(), filename);
      messageApi.success(`「${group.display}」已匯出（依縣市分頁）`);
    } catch {
      messageApi.error("匯出失敗，請稍後再試");
    } finally {
      setExportingKey(null);
    }
  };

  // 出貨：永久清除該分組訂單，不下載 CSV。
  const shipGroup = async (group: CloseGroup) => {
    const body = JSON.stringify({
      method: group.method,
      routeId: group.routeId,
    });
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
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        messageApi.error(err?.error || "出貨失敗");
        return;
      }
      messageApi.success(`「${group.display}」已出貨並清除`);
      await refresh();
    } catch {
      messageApi.error("出貨失敗，請稍後再試");
    } finally {
      setClosing(false);
      setClosingKey(null);
    }
  };

  const handleShipGroup = (group: CloseGroup) => {
    modal.confirm({
      title: `確定出貨「${group.display}」？`,
      icon: <ExclamationCircleFilled />,
      content: (
        <div>
          <p>此操作將永久清除此分組的 {group.count} 筆訂單。</p>
          <p style={{ color: "#ff4d4f", fontWeight: 500 }}>
            ⚠️ 此操作無法復原！如需備份請先「匯出 CSV」。
          </p>
        </div>
      ),
      okText: "確定出貨",
      okType: "danger",
      cancelText: "取消",
      onOk: () => shipGroup(group),
    });
  };

  const columns: ColumnsType<Order> = [
    {
      title: "取貨號",
      key: "pickupNumber",
      width: 90,
      render: (_: unknown, order: Order) =>
        order.pickupNumber == null ? (
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
    {
      title: "操作",
      key: "actions",
      width: 120,
      align: "center",
      fixed: "right",
      render: (_: unknown, order: Order) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEditModal(order)}
          />
          <Popconfirm
            title="確定刪除？"
            description={`將刪除訂單「#${order.id} (${order.customerName})」`}
            onConfirm={() => removeOrder(order)}
            okText="確定"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
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
      <Spin spinning={closing} fullscreen description="出貨處理中…" />
      <Card classNames={{ body: "p-3 sm:p-6" }}>
        <PageHeader
          title="訂單管理"
          actions={
            <Space wrap>
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
                出貨 / 匯出 CSV
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreateModal}
              >
                新增訂單
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
            免費版資料庫，建議每檔完成後先「匯出 CSV」備份，再以「出貨」清除該分組資料，以節省雲端儲存空間。
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
        title="出貨 / 匯出 CSV（依路線）"
        open={closeModalOpen}
        onCancel={() => {
          if (!closing) setCloseModalOpen(false);
        }}
        footer={null}
      >
        <p style={{ color: "#8c8c8c", fontSize: 13 }}>
          每條路線、「未分路線」與「宅配」各自成一組。「匯出 CSV」僅下載、不清除資料且可重複；
          「出貨」永久清除該組訂單且不下載 CSV，無法復原。
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
                <Space>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    loading={exportingKey === group.key}
                    onClick={() => exportGroupCsv(group)}
                  >
                    匯出 CSV
                  </Button>
                  <Button
                    danger
                    type="primary"
                    size="small"
                    loading={closingKey === group.key}
                    disabled={closing && closingKey !== group.key}
                    onClick={() => handleShipGroup(group)}
                  >
                    出貨
                  </Button>
                </Space>
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

      <Modal
        title={
          editOrder
            ? `修改訂單 #${editOrder.id}（${editOrder.customerName}）`
            : "修改訂單"
        }
        open={editOpen}
        onOk={handleUpdate}
        onCancel={closeEditModal}
        okText="儲存"
        cancelText="取消"
        confirmLoading={editing}
        width={720}
        destroyOnHidden
      >
        <Spin spinning={editDataLoading}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title="僅可修改商品明細；客戶與取貨資訊不變。既有品項改量沿用原價，新增品項以商品現價計算。"
          />
          <Form form={editForm} layout="vertical">
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <div>
                  <div style={{ marginBottom: 8, fontWeight: 500 }}>
                    商品明細
                  </div>
                  {fields.map((field) => {
                    const itemId = editForm.getFieldValue([
                      "items",
                      field.name,
                      "itemId",
                    ]);
                    const productName = editForm.getFieldValue([
                      "items",
                      field.name,
                      "productName",
                    ]);
                    return (
                      <Space
                        key={field.key}
                        align="baseline"
                        style={{ display: "flex", marginBottom: 8 }}
                      >
                        <Form.Item name={[field.name, "itemId"]} hidden>
                          <Input />
                        </Form.Item>
                        <Form.Item name={[field.name, "productName"]} hidden>
                          <Input />
                        </Form.Item>
                        {itemId != null ? (
                          <div style={{ width: 360 }}>
                            <Text>{productName}</Text>
                          </div>
                        ) : (
                          <Form.Item
                            name={[field.name, "productId"]}
                            rules={[{ required: true, message: "請選擇商品" }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Select
                              placeholder="選擇商品"
                              showSearch={{ optionFilterProp: "label" }}
                              style={{ width: 360 }}
                              options={products.map((p) => ({
                                label: `${p.name}（$${p.price}${p.promoSummary ? ` · ${p.promoSummary}` : ""
                                  }）`,
                                value: p.id,
                              }))}
                              notFoundContent="尚無商品"
                            />
                          </Form.Item>
                        )}
                        <Form.Item
                          name={[field.name, "quantity"]}
                          rules={[{ required: true, message: "請輸入數量" }]}
                          style={{ marginBottom: 0 }}
                        >
                          <InputNumber min={1} precision={0} placeholder="數量" />
                        </Form.Item>
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => remove(field.name)}
                        />
                      </Space>
                    );
                  })}
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

            <div style={{ textAlign: "right", marginTop: 16 }}>
              <Text type="secondary" style={{ marginRight: 8 }}>
                預估總額
              </Text>
              <Text strong style={{ fontSize: 18, color: "#cf1322" }}>
                ${estimatedEditTotal}
              </Text>
            </div>
          </Form>
        </Spin>
      </Modal>
    </>
  );
}
