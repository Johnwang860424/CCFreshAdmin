"use client";

// 修改訂單視窗：僅可修改商品明細（既有列沿用原快照改量、新增列以商品現價計）。
// 每次開窗重載商品清單供新增列挑選；儲存成功後以 onSaved 通知頁面刷新。
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Spin,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { calcLineSubtotal } from "@/app/lib/promotions";
import type { OrderRow as Order } from "@/app/lib/orders";
import type { ProductRow } from "@/app/lib/products";
import { fetchJson, putJson } from "@/app/lib/api-client";

const { Text } = Typography;

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

  // 開窗時帶入該訂單既有明細（保留 order_items.id），並重新載入商品清單
  // 供新增列挑選——每次開窗都重抓，確保剩餘庫存/售完標示為最新（庫存隨訂單異動）。
  useEffect(() => {
    if (!open || !order) return;
    form.setFieldsValue({
      items: order.items.map((i) => ({
        itemId: i.id,
        productName: i.productName,
        quantity: i.quantity,
      })),
    });
    let cancelled = false;
    (async () => {
      setDataLoading(true);
      try {
        const prods = await fetchJson<ProductRow[]>("/api/products");
        if (!cancelled) setProducts(prods);
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
    const items = (values.items ?? []).map((row) =>
      row.itemId != null
        ? { id: row.itemId, quantity: row.quantity }
        : { productId: row.productId, quantity: row.quantity },
    );
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
      width={720}
      style={{ top: 20 }}
      destroyOnHidden
    >
      <Spin spinning={dataLoading}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="僅可修改商品明細；客戶與取貨資訊不變。既有品項改量沿用原價，新增品項以商品現價計算。"
        />
        <Form form={form} layout="vertical">
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <div>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>
                  商品明細
                </div>
                {fields.map((field) => {
                  const itemId = form.getFieldValue([
                    "items",
                    field.name,
                    "itemId",
                  ]);
                  const productName = form.getFieldValue([
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
              ${estimatedTotal}
            </Text>
          </div>
        </Form>
      </Spin>
    </Modal>
  );
}
