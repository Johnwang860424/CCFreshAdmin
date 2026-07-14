"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Key } from "react";
import {
  Card,
  Typography,
  Button,
  Space,
  Input,
  Select,
  App,
  Spin,
  Empty,
  Checkbox,
} from "antd";
import {
  SearchOutlined,
  ReloadOutlined,
  DownloadOutlined,
  ExclamationCircleFilled,
  FileWordOutlined,
  PlusOutlined,
  WarningOutlined,
  CarOutlined,
} from "@ant-design/icons";
import type { OrderRow as Order } from "@/app/lib/orders";
import { fetchJson, deleteJson, downloadBlob } from "@/app/lib/api-client";
import { safeFilename, taipeiDateStamp } from "@/app/lib/csv";
import { formatPickupCode } from "@/app/lib/pickup-code";
import {
  orderKey,
  duplicateNameKeys,
  countDuplicateOrders,
  sortDuplicatesAdjacent,
} from "@/app/domain/duplicate-orders";
import { PageHeader } from "@/app/components/page-header";
import { CreateOrderModal } from "./components/create-order-modal";
import { EditOrderModal } from "./components/edit-order-modal";
import { OrderSuccessModal } from "./components/order-success-modal";
import { OrderTotalsCards } from "./components/order-totals-cards";
import { OrdersTable } from "./components/orders-table";
import { BatchAdjustmentModal } from "./components/batch-adjustment-modal";

const { Text } = Typography;

/** 路線篩選下拉的特殊值：宅配（無取貨點/路線）、未分路線（取貨點未指定路線）。 */
const DELIVERY = "__delivery__";
const UNASSIGNED = "unassigned";

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

  // 新增訂單視窗與成功跳窗狀態（表單與清單載入由 CreateOrderModal 自理）。
  const [createOpen, setCreateOpen] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [createdOrderCode, setCreatedOrderCode] = useState<string | null>(null);

  // 修改訂單視窗狀態（表單與商品載入由 EditOrderModal 自理）。
  const [editOpen, setEditOpen] = useState(false);
  const [editOrder, setEditOrder] = useState<Order | null>(null);

  // 勾選出貨/匯出狀態：selectedRowKeys 為目前路線視圖中被勾選的訂單 id（跨分頁保留）。
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);
  const [selectionShipping, setSelectionShipping] = useState(false);
  const [selectionExporting, setSelectionExporting] = useState(false);
  const [batchAdjustmentOpen, setBatchAdjustmentOpen] = useState(false);

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

  // 路線清單與目前分組一起刷新（新增/修改/刪除/出貨後共用的收尾）。
  const refresh = useCallback(() => {
    fetchRouteOptions();
    if (selected) fetchOrders(selected);
  }, [fetchRouteOptions, fetchOrders, selected]);

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
  const dupKeys = useMemo(() => duplicateNameKeys(data), [data]);

  // 重複下訂的訂單筆數（以訂單計，非客戶數），顯示於篩選開關。
  const dupCount = useMemo(
    () => countDuplicateOrders(data, dupKeys),
    [data, dupKeys],
  );

  // 是否為重複下訂：姓名鍵為 null（防禦性，姓名必填）一律不算。
  const isDup = (order: Order) => {
    const key = orderKey(order);
    return key !== null && dupKeys.has(key);
  };

  const baseFiltered = data.filter(
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

  // 開啟篩選時讓同一客戶的訂單相鄰（組序＝鍵首次出現於 data 的索引）；
  // 未開啟時完全不動既有排序。
  const filtered = dupOnly
    ? sortDuplicatesAdjacent(baseFiltered, data)
    : baseFiltered;

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

  // 刪除單筆訂單（明細一併清除）；成功後刷新路線清單與目前分組。
  const removeOrder = async (order: Order) => {
    try {
      await deleteJson(`/api/orders/${order.id}`);
      messageApi.success("訂單已刪除");
      refresh();
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
      refresh();
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
                onClick={refresh}
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
                onClick={() => setCreateOpen(true)}
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
            <OrderTotalsCards
              routeTotal={routeTotal}
              orderCount={filtered.length}
              stationTotals={stationTotals}
            />

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
                icon={<WarningOutlined />}
                disabled={data.length === 0}
                onClick={() => setBatchAdjustmentOpen(true)}
              >
                商品缺貨調整
              </Button>
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
                icon={<CarOutlined />}
                disabled={selectedRowKeys.length === 0}
                loading={selectionShipping}
                onClick={handleShipSelected}
              >
                出貨
              </Button>
            </div>
            <Spin spinning={loading}>
              <OrdersTable
                data={filtered}
                isDup={isDup}
                selectedRowKeys={selectedRowKeys}
                onSelectionChange={setSelectedRowKeys}
                onEdit={(order) => {
                  setEditOrder(order);
                  setEditOpen(true);
                }}
                onDelete={removeOrder}
              />
            </Spin>
          </>
        )}
      </Card>

      <CreateOrderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(code) => {
          setCreateOpen(false);
          setCreatedOrderCode(code);
          setSuccessModalOpen(true);
          refresh();
        }}
      />

      <EditOrderModal
        open={editOpen}
        order={editOrder}
        onClose={() => {
          setEditOpen(false);
          setEditOrder(null);
        }}
        onSaved={refresh}
      />

      <BatchAdjustmentModal
        open={batchAdjustmentOpen}
        orders={data}
        scope={
          selected === DELIVERY
            ? { method: "delivery", routeId: null }
            : {
              method: "pickup",
              routeId:
                selected === UNASSIGNED || selected === undefined
                  ? null
                  : Number(selected),
            }
        }
        routeLabel={
          selected === DELIVERY
            ? "宅配"
            : selected === UNASSIGNED
              ? "未分路線"
              : routes.find((route) => String(route.id) === selected)?.name ?? ""
        }
        onClose={() => setBatchAdjustmentOpen(false)}
        onSaved={refresh}
      />

      <OrderSuccessModal
        open={successModalOpen}
        pickupCode={createdOrderCode}
        onClose={() => setSuccessModalOpen(false)}
      />
    </>
  );
}
