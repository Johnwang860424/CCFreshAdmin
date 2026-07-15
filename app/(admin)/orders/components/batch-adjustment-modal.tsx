"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, App, InputNumber, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { OrderItemRow, OrderRow } from "@/app/lib/orders";
import { postJson } from "@/app/lib/api-client";
import { calcLineSubtotal } from "@/app/lib/promotions";
import { formatPickupCode } from "@/app/lib/pickup-code";

const { Text } = Typography;

export interface BatchAdjustmentScope {
  method: "pickup" | "delivery";
  routeId: number | null;
}

interface AdjustmentRow {
  key: number;
  order: OrderRow;
  item: OrderItemRow;
}

export function BatchAdjustmentModal({
  open,
  orders,
  scope,
  routeLabel,
  onClose,
  onSaved,
}: {
  open: boolean;
  orders: OrderRow[];
  scope: BatchAdjustmentScope;
  routeLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = App.useApp();
  const [productId, setProductId] = useState<number>();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);

  const productOptions = useMemo(() => {
    const stats = new Map<number, { name: string; quantity: number; orders: Set<number> }>();
    for (const order of orders) {
      for (const item of order.items) {
        if (item.productId === null || item.quantity <= 0) continue;
        const current = stats.get(item.productId) ?? {
          name: item.productName,
          quantity: 0,
          orders: new Set<number>(),
        };
        current.quantity += item.quantity;
        current.orders.add(order.id);
        stats.set(item.productId, current);
      }
    }
    return [...stats.entries()]
      .map(([value, stat]) => ({
        value,
        label: `${stat.name}（${stat.orders.size} 筆訂單，共 ${stat.quantity} 件）`,
        name: stat.name,
        quantity: stat.quantity,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-TW"));
  }, [orders]);
  const rows = useMemo<AdjustmentRow[]>(() => {
    if (productId === undefined) return [];
    return orders.flatMap((order) =>
      order.items
        .filter((item) => item.productId === productId && item.quantity > 0)
        .map((item) => ({ key: item.id, order, item })),
    );
  }, [orders, productId]);

  useEffect(() => {
    if (!open) return;
    setProductId(undefined);
    setQuantities({});
  }, [open]);

  useEffect(() => {
    setQuantities(Object.fromEntries(rows.map((row) => [row.item.id, row.item.quantity])));
  }, [rows]);
  const lineSubtotal = (row: AdjustmentRow, quantity: number) => {
    const promo = row.item.promoType && row.item.promoConfig
      ? { type: row.item.promoType, config: row.item.promoConfig }
      : null;
    return calcLineSubtotal(promo, row.item.unitPrice, quantity);
  };

  const changedRows = rows.filter(
    (row) => (quantities[row.item.id] ?? row.item.quantity) < row.item.quantity,
  );
  const originalQuantity = rows.reduce((sum, row) => sum + row.item.quantity, 0);
  const adjustedQuantity = rows.reduce(
    (sum, row) => sum + (quantities[row.item.id] ?? row.item.quantity),
    0,
  );
  const amountDifference = changedRows.reduce((sum, row) => {
    const next = quantities[row.item.id] ?? row.item.quantity;
    return sum + row.item.subtotal - lineSubtotal(row, next);
  }, 0);
  const orderDelta = new Map<number, number>();
  for (const row of changedRows) {
    const next = quantities[row.item.id] ?? row.item.quantity;
    orderDelta.set(
      row.order.id,
      (orderDelta.get(row.order.id) ?? 0) + lineSubtotal(row, next) - row.item.subtotal,
    );
  }
  const handleSubmit = async () => {
    if (productId === undefined || changedRows.length === 0) return;
    setSaving(true);
    try {
      const result = await postJson<{ updatedItems: number; updatedOrders: number }>(
        "/api/orders/batch-adjustment",
        {
          productId,
          ...scope,
          changes: changedRows.map((row) => ({
            orderId: row.order.id,
            orderItemId: row.item.id,
            expectedQuantity: row.item.quantity,
            newQuantity: quantities[row.item.id],
          })),
        },
      );
      message.success(`已調整 ${result.updatedOrders} 筆訂單、${result.updatedItems} 筆明細`);
      onClose();
      onSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "批次調整失敗");
    } finally {
      setSaving(false);
    }
  };
  const columns: ColumnsType<AdjustmentRow> = [
    {
      title: "取貨號",
      width: 90,
      render: (_, row) => formatPickupCode(row.order.spotCode, row.order.pickupNumber) ?? "-",
    },
    {
      title: "客戶",
      width: 150,
      render: (_, row) => row.order.customerName,
    },
    {
      title: "原數量",
      width: 90,
      align: "right",
      render: (_, row) => row.item.quantity,
    },
    {
      title: "調整後",
      width: 120,
      render: (_, row) => (
        <InputNumber
          min={0}
          max={row.item.quantity}
          precision={0}
          value={quantities[row.item.id] ?? row.item.quantity}
          onChange={(value) =>
            setQuantities((current) => ({
              ...current,
              [row.item.id]: typeof value === "number" ? value : row.item.quantity,
            }))
          }
        />
      ),
    },
    {
      title: "調整後金額",
      width: 180,
      render: (_, row) => {
        const quantity = quantities[row.item.id] ?? row.item.quantity;
        const subtotal = lineSubtotal(row, quantity);
        const total = row.order.total + (orderDelta.get(row.order.id) ?? 0);
        return (
          <Space orientation="vertical" size={0}>
            <Text>明細 ${subtotal}</Text>
            <Text type="secondary">訂單 ${total}</Text>
          </Space>
        );
      },
    },
  ];
  return (
    <Modal
      title={`商品缺貨調整｜${routeLabel}`}
      open={open}
      width={1050}
      style={{ top: 20 }}
      okText="確認批次調整"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: productId === undefined || changedRows.length === 0 }}
      onOk={handleSubmit}
      onCancel={onClose}
      destroyOnHidden
    >
      <Alert
        type="warning"
        showIcon
        title="此操作只會調整訂單數量與金額，不會修改商品庫存。數量調成 0 的明細仍會保留。"
        style={{ marginBottom: 16 }}
      />
      <div style={{ marginBottom: 16 }}>
        <Text strong>缺貨商品</Text>
        <Select
          style={{ width: "100%", marginTop: 8 }}
          placeholder="請選擇需要調整的商品"
          showSearch={{ optionFilterProp: "label" }}
          value={productId}
          options={productOptions}
          onChange={setProductId}
          notFoundContent="此路線沒有可調整的商品"
        />
      </div>
      {productId !== undefined && (
        <Alert
          type={changedRows.length > 0 ? "info" : "success"}
          style={{ marginBottom: 16 }}
          title={
            <Space wrap>
              <span>商品總數：{originalQuantity} → {adjustedQuantity}</span>
              <Tag color="orange">減少 {originalQuantity - adjustedQuantity}</Tag>
              <span>影響 {new Set(changedRows.map((row) => row.order.id)).size} 筆訂單</span>
              <Text type="danger">金額減少 ${amountDifference}</Text>
            </Space>
          }
        />
      )}
      {productId !== undefined && (
        <Table
          sticky
          rowKey="key"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={{ defaultPageSize: 10, showSizeChanger: true }}
          scroll={{ x: "max-content", y: 480 }}
          locale={{ emptyText: "沒有可調整的訂單明細" }}
        />
      )}
    </Modal>
  );
}
