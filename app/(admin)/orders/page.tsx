"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Key } from "react";
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
  Checkbox,
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
  DollarOutlined,
  EnvironmentOutlined,
  CopyOutlined,
  CheckOutlined,
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
import { formatPickupCode } from "@/app/lib/pickup-code";
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

/**
 * 重複下訂判定鍵：客戶姓名去除頭尾空白後的字串。僅「相同姓名」視為重複——
 * 電話不比對；姓名為空（理論上必填不會發生）回傳 null，不參與判定。
 */
function orderKey(order: Order): string | null {
  const nameKey = order.customerName.trim();
  return nameKey !== "" ? nameKey : null;
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
  const [search, setSearch] = useState("");
  // 只看重複下訂：切換路線不重設（判定隨 data 重算，正確性不受影響）。
  const [dupOnly, setDupOnly] = useState(false);
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

  // 新增訂單成功跳窗狀態
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [createdOrderCode, setCreatedOrderCode] = useState<string | null>(null);

  // 修改訂單表單狀態
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [editDataLoading, setEditDataLoading] = useState(false);
  const [editForm] = Form.useForm<{ items: EditItemFormValue[] }>();
  const watchedEditItems = Form.useWatch("items", editForm);

  // 勾選出貨/匯出狀態：selectedRowKeys 為目前路線視圖中被勾選的訂單 id（跨分頁保留）。
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [selectionShipping, setSelectionShipping] = useState(false);
  const [selectionExporting, setSelectionExporting] = useState(false);

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
      // 新增訂單時固定列出所有商品，預設皆不選購（數量為 0）。
      form.setFieldsValue({
        items: prods.map((product) => ({
          productId: product.id,
          quantity: 0,
        })),
      });
    } catch {
      messageApi.error("讀取商品或取貨點清單失敗");
    } finally {
      setCreateDataLoading(false);
    }
  }, [form, messageApi]);

  const closeCreateModal = useCallback(() => {
    setCreateOpen(false);
    form.resetFields();
  }, [form]);

  // 開啟修改視窗：帶入該訂單既有明細（保留 order_items.id），並重新載入商品清單
  // 供新增列挑選——每次開窗都重抓，確保剩餘庫存/售完標示為最新（庫存隨訂單異動）。
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
      setEditDataLoading(true);
      try {
        setProducts(await fetchJson<ProductRow[]>("/api/products"));
      } catch {
        messageApi.error("讀取商品清單失敗");
      } finally {
        setEditDataLoading(false);
      }
    },
    [editForm, messageApi],
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

  const handleCreate = useCallback(async () => {
    let values: CreateOrderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 驗證失敗，antd 已標示欄位
    }
    setCreating(true);
    try {
      const items = values.items.filter((item) => Number(item.quantity) > 0);
      if (items.length === 0) {
        messageApi.error("請至少選擇一項商品並填入數量");
        return;
      }
      const res = await postJson<{
        success: boolean;
        id: number;
        pickupNumber: number | null;
        spotCode: string | null;
      }>("/api/orders", {
        customerName: values.customerName,
        phone: values.phone,
        tag: values.tag,
        deliveryMethod: values.deliveryMethod,
        pickupSpotId:
          values.deliveryMethod === "pickup" ? values.pickupSpotId : null,
        shippingAddress:
          values.deliveryMethod === "delivery" ? values.shippingAddress : null,
        note: values.note,
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })),
      });
      messageApi.success("訂單已新增");
      setCreateOpen(false);
      form.resetFields();
      const code = formatPickupCode(res.spotCode, res.pickupNumber);
      setCreatedOrderCode(code);
      setSuccessModalOpen(true);
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

  // 選定路線變動時查詢；未選則清空結果。切換路線一律清空勾選（FR-011：勾選限單一路線視圖）。
  useEffect(() => {
    setSelectedRowKeys([]);
    if (selected) fetchOrders(selected);
    else setData([]);
  }, [selected, fetchOrders]);

  // 重複下訂判定：以目前路線視圖的全部訂單（data）為母體，同一姓名鍵
  // 出現超過一筆即為重複——與搜尋字串、篩選開關無關，data 重載時隨 memo 重算。
  const dupKeys = useMemo(() => {
    const countByKey = new Map<string, number>();
    for (const order of data) {
      const key = orderKey(order);
      if (key === null) continue;
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    }
    return new Set(
      [...countByKey].filter(([, n]) => n > 1).map(([key]) => key),
    );
  }, [data]);

  // 重複下訂的訂單筆數（以訂單計，非客戶數），顯示於篩選開關。
  const dupCount = useMemo(() => {
    let n = 0;
    for (const order of data) {
      const key = orderKey(order);
      if (key !== null && dupKeys.has(key)) n++;
    }
    return n;
  }, [data, dupKeys]);

  // 是否為重複下訂：姓名鍵為 null（防禦性，姓名必填）一律不算。
  const isDup = (order: Order) => {
    const key = orderKey(order);
    return key !== null && dupKeys.has(key);
  };

  const filtered = data.filter(
    (order) =>
      (order.customerName.includes(search) ||
        (order.phone ?? "").includes(search) ||
        (order.pickupSpotLabel ?? "").includes(search) ||
        (order.shippingAddress ?? "").includes(search) ||
        (formatPickupCode(order.spotCode, order.pickupNumber)
          ?.toLowerCase()
          .includes(search.toLowerCase()) ??
          false) ||
        String(order.id).includes(search)) &&
      (!dupOnly || isDup(order)),
  );

  // 開啟篩選時讓同一客戶的訂單相鄰：以鍵首次出現於 data 的索引為組序，
  // 組內靠穩定排序維持原相對順序；未開啟時完全不動既有排序。
  if (dupOnly) {
    const firstSeen = new Map<string, number>();
    data.forEach((order, i) => {
      const key = orderKey(order);
      if (key !== null && !firstSeen.has(key)) firstSeen.set(key, i);
    });
    // dupOnly 下 filtered 內全為重複訂單（必有姓名鍵），firstSeen 必有值。
    filtered.sort(
      (a, b) => firstSeen.get(orderKey(a)!)! - firstSeen.get(orderKey(b)!)!,
    );
  }

  // 計算路線總金額與站點總金額
  const routeTotal = useMemo(() => {
    return filtered.reduce((sum, order) => sum + order.total, 0);
  }, [filtered]);

  const stationTotals = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((order) => {
      const label = order.pickupSpotLabel || (order.deliveryMethod === "delivery" ? "宅配" : "未指定自取點");
      map[label] = (map[label] || 0) + order.total;
    });
    return Object.entries(map)
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  // 表頭全選：涵蓋目前篩選結果的所有分頁（非僅目前頁）。
  const filteredKeys = filtered.map((o) => o.id);
  const selectedKeySet = new Set(selectedRowKeys);
  const allFilteredSelected =
    filteredKeys.length > 0 && filteredKeys.every((k) => selectedKeySet.has(k));
  const someFilteredSelected = filteredKeys.some((k) => selectedKeySet.has(k));

  // 勾選/取消目前篩選結果的全部訂單（跨分頁），保留篩選範圍外已勾選者不變。
  const toggleSelectAllFiltered = (checked: boolean) => {
    setSelectedRowKeys((prev) => {
      if (checked) {
        const set = new Set(prev);
        filteredKeys.forEach((k) => set.add(k));
        return [...set];
      }
      const fset = new Set<Key>(filteredKeys);
      return prev.filter((k) => !fset.has(k));
    });
  };

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

  // 出貨選取：永久清除被勾選的訂單（依 id 清單），成功後清空勾選並刷新（FR-003/009）。
  const shipSelected = async () => {
    const ids = selectedRowKeys.map(Number);
    setSelectionShipping(true);
    try {
      const { deleted } = await deleteJson<{ deleted: number }>(
        "/api/orders/selection",
        { ids },
      );
      messageApi.success(`已出貨並清除 ${deleted} 筆訂單`);
      setSelectedRowKeys([]);
      fetchRouteOptions();
      if (selected) fetchOrders(selected);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : "出貨失敗");
    } finally {
      setSelectionShipping(false);
    }
  };

  // 出貨選取前二次確認，載明筆數與無法復原警語、建議先匯出備份（FR-006）。
  const handleShipSelected = () => {
    const count = selectedRowKeys.length;
    modal.confirm({
      title: `確定出貨所選 ${count} 筆訂單？`,
      icon: <ExclamationCircleFilled />,
      width: 500,
      content: (
        <div>
          <p>此操作將永久清除所選的 {count} 筆訂單。</p>
          <p style={{ color: "#ff4d4f", fontWeight: 500 }}>
            ⚠️ 此操作無法復原！如需備份請先「匯出選取訂單」。
          </p>
        </div>
      ),
      okText: "確定出貨",
      okType: "danger",
      cancelText: "取消",
      onOk: shipSelected,
    });
  };

  // 匯出選取訂單：依 id 清單下載 xlsx（依縣市分頁），不清除資料且保留勾選（可重複，FR-004）。
  const exportSelected = async () => {
    const ids = selectedRowKeys.map(Number);
    const route = routes.find((r) => String(r.id) === selected);
    const selectedDisplay =
      selected === UNASSIGNED
        ? "未分路線"
        : selected === DELIVERY
          ? "宅配"
          : route
            ? route.name
            : "";
    const filename = safeFilename(
      `訂單_${selectedDisplay}_${taipeiDateStamp()}.xlsx`,
    );
    setSelectionExporting(true);
    try {
      const res = await fetch("/api/orders/selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        messageApi.error(err?.error || "匯出失敗");
        return;
      }
      downloadBlob(await res.blob(), filename);
      messageApi.success(`已匯出所選 ${ids.length} 筆訂單（依縣市分頁）`);
    } catch {
      messageApi.error("匯出失敗，請稍後再試");
    } finally {
      setSelectionExporting(false);
    }
  };

  const columns: ColumnsType<Order> = [
    {
      title: "取貨號",
      key: "pickupNumber",
      width: 90,
      render: (_: unknown, order: Order) => {
        const code = formatPickupCode(order.spotCode, order.pickupNumber);
        return code == null ? (
          "-"
        ) : (
          <Tag color="geekblue" style={{ fontSize: 16, fontWeight: 700 }}>
            {code}
          </Tag>
        );
      },
    },
    {
      title: "客戶",
      dataIndex: "customerName",
      key: "customerName",
      width: 160,
      ellipsis: true,
      render: (name: string, order: Order) =>
        isDup(order) ? (
          <>
            {name}
            <Tag color="orange" style={{ marginLeft: 4 }}>
              重複
            </Tag>
          </>
        ) : (
          name
        ),
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
      title: "聯絡電話",
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
                placeholder="於結果內篩選 (客戶/聯絡電話/地址/取貨號)"
                prefix={<SearchOutlined />}
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full sm:w-60"
              />
              <Checkbox
                checked={dupOnly}
                disabled={dupCount === 0}
                onChange={(e) => setDupOnly(e.target.checked)}
              >
                只看重複下訂（{dupCount} 筆）
              </Checkbox>
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
            💡 因使用 Neon 免費版資料庫，建議定期「匯出訂單」備份，再以「出貨」清除該分組資料，以節省雲端儲存空間。
          </Text>
        </div>

        {!selected ? (
          <Empty
            description="請先選擇路線以查詢訂單"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <>
            {/* 總金額與站點統計儀表板區塊 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 16,
                marginBottom: 16,
              }}
            >
              {/* 路線總金額卡片 */}
              <div
                style={{
                  background: "linear-gradient(135deg, #1890ff 0%, #722ed1 100%)",
                  borderRadius: 12,
                  padding: "20px 24px",
                  color: "#fff",
                  boxShadow: "0 4px 12px rgba(24, 144, 255, 0.15)",
                  position: "relative",
                  overflow: "hidden",
                  transition: "all 0.3s ease",
                }}
                className="hover:scale-[1.01] hover:shadow-lg"
              >
                <div style={{ opacity: 0.15, position: "absolute", right: -10, bottom: -10, fontSize: 120, lineHeight: 1 }}>
                  <DollarOutlined />
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, opacity: 0.85, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <DollarOutlined />
                  路線總金額
                </div>
                <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 8, fontFamily: "Inter, sans-serif" }}>
                  ${routeTotal.toLocaleString()}
                </div>
                <div style={{ fontSize: 13, opacity: 0.9 }}>
                  篩選結果共 <span style={{ fontWeight: 600 }}>{filtered.length}</span> 筆訂單
                </div>
              </div>

              {/* 站點總金額卡片 */}
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #f0f0f0",
                  borderRadius: 12,
                  padding: "20px 24px",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
                  display: "flex",
                  flexDirection: "column",
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600, color: "#262626", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                  <EnvironmentOutlined style={{ color: "#1890ff" }} />
                  各站點總金額
                </div>
                {stationTotals.length === 0 ? (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#bfbfbf", fontSize: 13 }}>
                    無站點資料
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {stationTotals.map(({ label, total }) => {
                      const percentage = routeTotal > 0 ? Math.round((total / routeTotal) * 100) : 0;
                      return (
                        <div
                          key={label}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            padding: "4px 8px",
                            borderRadius: 6,
                            transition: "background 0.2s",
                          }}
                          className="hover:bg-gray-50"
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                            <span style={{ fontWeight: 500, color: "#595959" }}>{label}</span>
                            <span style={{ fontWeight: 600, color: "#262626" }}>
                              ${total.toLocaleString()} ({percentage}%)
                            </span>
                          </div>
                          <div style={{ height: 6, width: "100%", background: "#f5f5f5", borderRadius: 3, overflow: "hidden" }}>
                            <div
                              style={{
                                height: "100%",
                                width: `${percentage}%`,
                                background: "linear-gradient(90deg, #1890ff 0%, #36cfc9 100%)",
                                borderRadius: 3,
                                transition: "width 0.3s ease",
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <Text>
                已選 <Text strong>{selectedRowKeys.length}</Text> 筆
              </Text>
              <Button
                icon={<DownloadOutlined />}
                disabled={selectedRowKeys.length === 0}
                loading={selectionExporting}
                onClick={exportSelected}
              >
                匯出選取訂單
              </Button>
              <Button
                danger
                type="primary"
                disabled={selectedRowKeys.length === 0}
                loading={selectionShipping}
                onClick={handleShipSelected}
              >
                出貨
              </Button>
            </div>
            <Spin spinning={loading}>
              <Table
                rowKey="id"
                columns={columns}
                dataSource={filtered}
                rowSelection={{
                  selectedRowKeys,
                  onChange: setSelectedRowKeys,
                  preserveSelectedRowKeys: true,
                  columnTitle: (
                    <Checkbox
                      checked={allFilteredSelected}
                      indeterminate={
                        !allFilteredSelected && someFilteredSelected
                      }
                      disabled={filteredKeys.length === 0}
                      onChange={(e) =>
                        toggleSelectAllFiltered(e.target.checked)
                      }
                    />
                  ),
                }}
                expandable={{
                  expandedRowRender,
                  rowExpandable: () => true,
                }}
                pagination={{ defaultPageSize: 10, showSizeChanger: true }}
                locale={{ emptyText: "此路線目前沒有訂單" }}
                scroll={{ x: "max-content" }}
              />
            </Spin>
          </>
        )}
      </Card>

      <Modal
        title="新增訂單"
        open={createOpen}
        onOk={handleCreate}
        onCancel={closeCreateModal}
        okText="建立訂單"
        cancelText="取消"
        confirmLoading={creating}
        width={720}
        style={{ top: 20 }}
        destroyOnHidden
      >
        <Spin spinning={createDataLoading}>
          <Form
            form={form}
            layout="vertical"
            initialValues={{
              tag: "網站",
              deliveryMethod: "pickup",
              items: [],
            }}
          >
            <Form.Item
              label="客戶姓名"
              name="customerName"
              rules={[{ required: true, message: "請輸入客戶姓名" }]}
            >
              <Input placeholder="客戶姓名" maxLength={100} autoFocus />
            </Form.Item>

            <Space size="middle" className="w-full" wrap>
              <Form.Item label="聯絡電話" name="phone">
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

            <div>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>商品明細</div>
              {products.length === 0 && !createDataLoading ? (
                <Empty description="尚無商品" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                products.map((product, index) => (
                  <div
                    key={product.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 16,
                      alignItems: "center",
                      padding: "8px 0",
                      borderBottom: "1px solid #f0f0f0",
                    }}
                  >
                    <div>
                      <div>
                        {product.name}
                        {product.stock === 0 && (
                          <Tag color="red" style={{ marginLeft: 8 }}>
                            售完
                          </Tag>
                        )}
                      </div>
                      <Text type="secondary">
                        ${product.price}
                        {product.promoSummary ? ` · ${product.promoSummary}` : ""}
                        {product.stock !== null && product.stock > 0
                          ? ` · 剩餘 ${product.stock}`
                          : ""}
                      </Text>
                    </div>
                    <Form.Item name={["items", index, "productId"]} hidden>
                      <InputNumber />
                    </Form.Item>
                    <Form.Item
                      name={["items", index, "quantity"]}
                      rules={[{ required: true, message: "請輸入數量" }]}
                      style={{ marginBottom: 0 }}
                    >
                      <InputNumber
                        min={0}
                        precision={0}
                        disabled={product.stock === 0}
                        aria-label={`${product.name} 數量`}
                        style={{ width: 80 }}
                      />
                    </Form.Item>
                  </div>
                ))
              )}
            </div>

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
        style={{ top: 20 }}
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
                      <div
                        key={field.key}
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "8px",
                          alignItems: "flex-start",
                          marginBottom: 12,
                        }}
                      >
                        <Form.Item name={[field.name, "itemId"]} hidden>
                          <Input />
                        </Form.Item>
                        <Form.Item name={[field.name, "productName"]} hidden>
                          <Input />
                        </Form.Item>
                        {itemId != null ? (
                          <div style={{ flex: "1 1 280px", minWidth: 0, paddingTop: 4 }}>
                            <Text>{productName}</Text>
                          </div>
                        ) : (
                          <Form.Item
                            name={[field.name, "productId"]}
                            rules={[{ required: true, message: "請選擇商品" }]}
                            style={{ marginBottom: 0, flex: "1 1 280px" }}
                          >
                            <Select
                              placeholder="選擇商品"
                              showSearch={{ optionFilterProp: "label" }}
                              style={{ width: "100%" }}
                              options={products.map((p) => ({
                                label: `${p.name}（$${p.price}${p.promoSummary ? ` · ${p.promoSummary}` : ""
                                  }${p.stock !== null
                                    ? ` · ${p.stock === 0 ? "售完" : `剩餘 ${p.stock}`}`
                                    : ""
                                  }）`,
                                value: p.id,
                                disabled: p.stock === 0,
                              }))}
                              notFoundContent="尚無商品"
                            />
                          </Form.Item>
                        )}
                        <div style={{ display: "flex", gap: "8px", flex: "0 0 auto", alignItems: "center" }}>
                          <Form.Item
                            name={[field.name, "quantity"]}
                            rules={[{ required: true, message: "請輸入數量" }]}
                            style={{ marginBottom: 0 }}
                          >
                            <InputNumber min={1} precision={0} placeholder="數量" style={{ width: 80 }} />
                          </Form.Item>
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => remove(field.name)}
                            style={{ height: 32 }}
                          />
                        </div>
                      </div>
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

      <Modal
        open={successModalOpen}
        footer={null}
        onCancel={() => setSuccessModalOpen(false)}
        width={400}
        centered
        destroyOnHidden
      >
        <div style={{ textAlign: "center", padding: "20px 0 10px 0" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              backgroundColor: "#f6ffed",
              border: "1px solid #b7eb8f",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px auto",
            }}
          >
            <CheckOutlined style={{ fontSize: 32, color: "#52c41a" }} />
          </div>

          <Typography.Title level={4} style={{ marginBottom: 8 }}>
            訂單建立成功
          </Typography.Title>

          <div
            style={{
              backgroundColor: "#f5f5f5",
              border: "1px solid #d9d9d9",
              borderRadius: 8,
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 24,
            }}
          >
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 2 }}>取貨號</div>
              <span style={{ fontSize: 22, fontWeight: 700, fontFamily: "Inter, monospace", color: "#262626" }}>
                {createdOrderCode}
              </span>
            </div>
            <Button
              type="primary"
              icon={<CopyOutlined />}
              onClick={() => {
                if (createdOrderCode) {
                  navigator.clipboard.writeText(createdOrderCode);
                  messageApi.success("已複製取貨號");
                }
              }}
            >
              複製
            </Button>
          </div>

          <Button
            type="default"
            size="large"
            block
            onClick={() => setSuccessModalOpen(false)}
          >
            確定
          </Button>
        </div>
      </Modal>
    </>
  );
}
