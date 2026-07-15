"use client";

// 修改訂單視窗：商品明細與新增訂單共用同一格線畫面（全部商品左右並列），
// 既有品項帶入原數量（沿用原快照僅改量），其餘商品數量 0；改回 0 即移除該品項。
// 每次開窗重載商品清單，確保剩餘庫存/售完標示為最新；儲存成功後以 onSaved 通知頁面。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Form, InputNumber, Modal, Spin, Typography } from "antd";
import { calcLineSubtotal } from "@/app/lib/promotions";
import type { OrderRow as Order, OrderItemRow } from "@/app/lib/orders";
import type { ProductRow } from "@/app/lib/products";
import { fetchJson, putJson } from "@/app/lib/api-client";
import { OrderItemsGrid } from "./order-items-grid";

const { Text } = Typography;

/**
 * 修改訂單的明細列（與商品格線一一對應）：
 * - 帶 `itemId` → 既有 `order_items` 明細，保留原快照僅改數量（0 = 移除）。
 * - 僅帶 `productId` → 可加購的商品列，數量 > 0 時以商品現價建立新明細。
 */
interface EditItemFormValue {
  itemId?: number;
  productId?: number;
  quantity?: number;
}

/** 把訂單既有明細分成「可對應到商品清單的列」與「其餘列（商品已刪除或重複品項）」。 */
function partitionItems(items: OrderItemRow[]) {
  const byProduct = new Map<number, OrderItemRow>();
  const extras: OrderItemRow[] = [];
  for (const it of items) {
    if (it.productId != null && !byProduct.has(it.productId)) {
      byProduct.set(it.productId, it);
    } else {
      extras.push(it);
    }
  }
  return { byProduct, extras };
}

export function EditOrderModal({
  open,
  order,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** 編輯中的訂單；關窗時為 null。 */
  order: Order | null;
  onClose: () => void;
  /** 儲存成功後回呼（頁面刷新路線清單與目前分組）。 */
  onSaved: () => void;
}) {
  const { message: messageApi } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [form] = Form.useForm<{ items: EditItemFormValue[] }>();
  const watchedItems = Form.useWatch("items", form);

  // 開窗時重載商品清單（庫存隨訂單異動，每次都重抓），再把全部商品列成表單明細：
  // 訂單既有品項帶 itemId＋原數量，其餘商品數量 0；無法對應商品的既有明細附加在尾端。
  useEffect(() => {
    if (!open || !order) return;
    let cancelled = false;
    (async () => {
      setDataLoading(true);
      try {
        const prods = await fetchJson<ProductRow[]>("/api/products");
        if (cancelled) return;
        setProducts(prods);
        const { byProduct, extras } = partitionItems(order.items);
        form.setFieldsValue({
          items: [
            ...prods.map((p) => {
              const existing = byProduct.get(p.id);
              return {
                itemId: existing?.id,
                productId: p.id,
                quantity: existing?.quantity ?? 0,
              };
            }),
            ...extras.map((it) => ({ itemId: it.id, quantity: it.quantity })),
          ],
        });
      } catch {
        if (!cancelled) messageApi.error("讀取商品清單失敗");
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, order, form, messageApi]);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  // 編輯中訂單的既有明細（依 order_items.id），供既有列改量時以原快照估算小計。
  const itemById = useMemo(
    () => new Map((order?.items ?? []).map((i) => [i.id, i])),
    [order],
  );

  // 商品格線列：與表單 items 陣列同序（商品清單在前、無法對應商品的既有明細在後）。
  const gridRows = useMemo(() => {
    const { byProduct, extras } = partitionItems(order?.items ?? []);
    return [
      ...products.map((p, index) => ({
        key: `p-${p.id}`,
        index,
        code: p.code,
        name: p.name,
        soldOut: p.stock === 0,
        // 售完商品不可新加入，但既有品項仍可調量（含調回 0 移除）。
        inputDisabled: p.stock === 0 && !byProduct.has(p.id),
        hiddenFields: (
          <>
            <Form.Item name={["items", index, "itemId"]} hidden>
              <InputNumber />
            </Form.Item>
            <Form.Item name={["items", index, "productId"]} hidden>
              <InputNumber />
            </Form.Item>
          </>
        ),
      })),
      ...extras.map((it, i) => ({
        key: `i-${it.id}`,
        index: products.length + i,
        name: it.productName,
        hiddenFields: (
          <Form.Item
            name={["items", products.length + i, "itemId"]}
            hidden
          >
            <InputNumber />
          </Form.Item>
        ),
      })),
    ];
  }, [products, order]);

  // 即時預估總額：既有列用原快照、新增列用商品現價（與後端計算一致）。
  const estimatedTotal = useMemo(() => {
    if (!watchedItems) return 0;
    return watchedItems.reduce((sum, row) => {
      const qty = Number(row?.quantity);
      if (!Number.isInteger(qty) || qty <= 0) return sum;
      if (row?.itemId != null) {
        const it = itemById.get(row.itemId);
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
  }, [watchedItems, itemById, productById]);

  const handleCancel = useCallback(() => {
    form.resetFields();
    onClose();
  }, [form, onClose]);

  const handleUpdate = useCallback(async () => {
    if (!order) return;
    let values: { items: EditItemFormValue[] };
    try {
      values = await form.validateFields();
    } catch {
      return; // 驗證失敗，antd 已標示欄位
    }
    // 只送出數量 > 0 的列：既有列以 id、其餘以 productId；未送出的既有列即移除。
    const items = (values.items ?? []).flatMap((row) => {
      const qty = Number(row.quantity);
      if (!Number.isInteger(qty) || qty <= 0) return [];
      return [
        row.itemId != null
          ? { id: row.itemId, quantity: qty }
          : { productId: row.productId, quantity: qty },
      ];
    });
    if (items.length === 0) {
      messageApi.error("訂單至少需保留一項明細，如需清空請改用刪除訂單");
      return;
    }
    setSaving(true);
    try {
      await putJson(`/api/orders/${order.id}`, { items });
      messageApi.success("訂單已更新");
      form.resetFields();
      onClose();
      onSaved();
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : "修改訂單失敗");
    } finally {
      setSaving(false);
    }
  }, [order, form, messageApi, onClose, onSaved]);

  return (
    <Modal
      title={
        order
          ? `修改訂單 #${order.id}（${order.customerName}）`
          : "修改訂單"
      }
      open={open}
      onOk={handleUpdate}
      onCancel={handleCancel}
      okText="儲存"
      cancelText="取消"
      confirmLoading={saving}
      width="96vw"
      style={{ top: 20 }}
      destroyOnHidden
    >
      <Spin spinning={dataLoading}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="僅可修改商品數量；客戶與取貨資訊不變。既有品項改量沿用原價，新加入品項以商品現價計算；數量改為 0 即移除該品項。"
        />
        <Form form={form} layout="vertical">
          <OrderItemsGrid loading={dataLoading} rows={gridRows} />

          <div style={{ textAlign: "right", marginTop: 16 }}>
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
  );
}
