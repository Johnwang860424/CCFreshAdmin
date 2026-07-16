"use client";

// 新增訂單視窗：自載商品/取貨點清單、即時預估總額、送出（含重複下單兩段式確認）。
// 成功後以 onCreated(取貨號) 通知頁面（頁面負責關窗、開成功跳窗與刷新列表）。
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Typography,
} from "antd";
import { calcLineSubtotal } from "@/app/lib/promotions";
import type { ProductRow } from "@/app/lib/products";
import type { PickupSpotRow } from "@/app/lib/pickup-spots";
import { fetchJson, postJson, ApiError } from "@/app/lib/api-client";
import { formatPickupCode } from "@/app/lib/pickup-code";
import { OrderItemsGrid } from "./order-items-grid";

const { Text } = Typography;

/** 來源標籤選項（與後端 ORDER_TAGS 對應）；預設「網站」。 */
const TAG_OPTIONS = ["網站", "FB", "Line"] as const;
const ORDER_SOURCE_STORAGE_KEY = "orders:create:last-source";

function getCachedOrderSource(): (typeof TAG_OPTIONS)[number] {
  try {
    const cachedSource = window.localStorage.getItem(ORDER_SOURCE_STORAGE_KEY);
    return TAG_OPTIONS.find((source) => source === cachedSource) ?? TAG_OPTIONS[0];
  } catch {
    return TAG_OPTIONS[0];
  }
}

function cacheOrderSource(source: string) {
  try {
    window.localStorage.setItem(ORDER_SOURCE_STORAGE_KEY, source);
  } catch {
    // localStorage may be unavailable (for example, in a restricted browser mode).
  }
}

/** 新增訂單表單的明細列。 */
interface OrderItemFormValue {
  productId?: number;
  quantity?: number;
}

/** 「未分路線」在路線選單中的替代值（routes.id 為正整數，不會衝突）。 */
const UNASSIGNED_ROUTE = -1;

/** 新增訂單表單值。 */
interface CreateOrderFormValues {
  customerName: string;
  phone?: string;
  tag: string;
  deliveryMethod: "pickup" | "delivery";
  /** 僅供前端過濾取貨點，不隨訂單送出；-1 = 未分路線。 */
  routeId?: number;
  pickupSpotId?: number;
  shippingAddress?: string;
  note?: string;
  items: OrderItemFormValue[];
}

export function CreateOrderModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** 建立成功後回呼，帶入取貨號顯示字串（formatPickupCode 的結果）。 */
  onCreated: (pickupCode: string | null) => void;
}) {
  const { modal, message: messageApi } = App.useApp();
  const [creating, setCreating] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [pickupSpots, setPickupSpots] = useState<PickupSpotRow[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [form] = Form.useForm<CreateOrderFormValues>();
  const watchedMethod = Form.useWatch("deliveryMethod", form);
  const watchedRouteId = Form.useWatch("routeId", form);
  const watchedItems = Form.useWatch("items", form);

  // 每次開窗重載商品與取貨點清單，確保剩餘庫存/售完標示為最新。
  useEffect(() => {
    if (!open) return;
    form.setFieldValue("tag", getCachedOrderSource());
    let cancelled = false;
    (async () => {
      setDataLoading(true);
      try {
        const [prods, spots] = await Promise.all([
          fetchJson<ProductRow[]>("/api/products"),
          fetchJson<PickupSpotRow[]>("/api/pickup-spots"),
        ]);
        if (cancelled) return;
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
        if (!cancelled) messageApi.error("讀取商品或取貨點清單失敗");
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, form, messageApi]);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  // 路線選項：由取貨點清單去重推導（依取貨點順序首見排序），未分路線以 -1 表示排在最後。
  const routeOptions = useMemo(() => {
    const seen = new Map<number, string>();
    let hasUnassigned = false;
    for (const spot of pickupSpots) {
      if (spot.routeId == null) hasUnassigned = true;
      else if (!seen.has(spot.routeId))
        seen.set(spot.routeId, spot.routeName ?? `路線 ${spot.routeId}`);
    }
    const options = [...seen].map(([value, label]) => ({ value, label }));
    if (hasUnassigned)
      options.push({ value: UNASSIGNED_ROUTE, label: "未分路線" });
    return options;
  }, [pickupSpots]);

  // 取貨點選項：僅列出所選路線內的取貨點（未選路線時為空）。
  const spotOptions = useMemo(() => {
    if (watchedRouteId == null) return [];
    return pickupSpots
      .filter((s) => (s.routeId ?? UNASSIGNED_ROUTE) === watchedRouteId)
      .map((s) => ({ label: `${s.city} ${s.township}`, value: s.id }));
  }, [pickupSpots, watchedRouteId]);

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

  const handleCancel = useCallback(() => {
    form.resetFields();
    onClose();
  }, [form, onClose]);

  // 送出新增訂單並執行成功收尾；confirmDuplicate 為重複下單警示確認後的重送旗標。
  const submitOrder = useCallback(
    async (values: CreateOrderFormValues, confirmDuplicate?: boolean) => {
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
        ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
      });
      messageApi.success("訂單已新增");
      form.resetFields();
      onCreated(formatPickupCode(res.spotCode, res.pickupNumber));
    },
    [form, messageApi, onCreated],
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
      await submitOrder(values);
    } catch (err) {
      // 同路線分組已有同名訂單：後端回 409 requiresConfirmation，
      // 開確認視窗、確認後帶 confirmDuplicate: true 重送；取消則保留表單。
      const needsConfirm =
        err instanceof ApiError &&
        (err.body as { requiresConfirmation?: boolean } | null)
          ?.requiresConfirmation === true;
      if (needsConfirm) {
        modal.confirm({
          content: "系統偵測到您可能已有訂單，請確認是否為重複下單",
          okText: "仍要建立",
          cancelText: "取消",
          onOk: async () => {
            try {
              await submitOrder(values, true);
            } catch (err2) {
              messageApi.error(
                err2 instanceof Error ? err2.message : "新增訂單失敗",
              );
            }
          },
        });
      } else {
        messageApi.error(err instanceof Error ? err.message : "新增訂單失敗");
      }
    } finally {
      setCreating(false);
    }
  }, [form, submitOrder, modal, messageApi]);

  return (
    <Modal
      title="新增訂單"
      open={open}
      onOk={handleCreate}
      onCancel={handleCancel}
      okText="建立訂單"
      cancelText="取消"
      confirmLoading={creating}
      width="96vw"
      style={{ top: 20 }}
      destroyOnHidden
    >
      <Spin spinning={dataLoading}>
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
                style={{ width: 128 }}
                options={TAG_OPTIONS.map((t) => ({ label: t, value: t }))}
                onChange={cacheOrderSource}
              />
            </Form.Item>
            <Form.Item
              label="取貨方式"
              name="deliveryMethod"
              rules={[{ required: true }]}
            >
              <Select
                style={{ width: 128 }}
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
              {pickupSpots.length === 0 && !dataLoading && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="目前沒有可用的取貨點，請先於「自取地點」建立後，再新增自取訂單。"
                />
              )}
              <Space size="middle" className="w-full" wrap>
                <Form.Item
                  label="路線"
                  name="routeId"
                  rules={[{ required: true, message: "請選擇路線" }]}
                >
                  <Select
                    style={{ width: 300 }}
                    placeholder="選擇路線"
                    showSearch={{
                      optionFilterProp: 'label'
                    }}
                    options={routeOptions}
                    // 換路線時清空已選取貨點，避免留下不屬於該路線的選擇。
                    onChange={() =>
                      form.setFieldValue("pickupSpotId", undefined)
                    }
                    notFoundContent="尚無路線"
                  />
                </Form.Item>
                <Form.Item
                  label="取貨點"
                  name="pickupSpotId"
                  rules={[{ required: true, message: "請選擇取貨點" }]}
                >
                  <Select
                    style={{ width: 400 }}
                    placeholder={
                      watchedRouteId == null ? "請先選擇路線" : "選擇取貨點"
                    }
                    disabled={watchedRouteId == null}
                    showSearch={{
                      optionFilterProp: 'label'
                    }}
                    options={spotOptions}
                    notFoundContent="此路線尚無取貨點"
                  />
                </Form.Item>
              </Space>
            </>
          )}

          <OrderItemsGrid
            loading={dataLoading}
            rows={products.map((product, index) => ({
              key: product.id,
              index,
              code: product.code,
              name: product.name,
              soldOut: product.stock === 0,
              inputDisabled: product.stock === 0,
              hiddenFields: (
                <Form.Item name={["items", index, "productId"]} hidden>
                  <InputNumber />
                </Form.Item>
              ),
            }))}
          />

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
  );
}
