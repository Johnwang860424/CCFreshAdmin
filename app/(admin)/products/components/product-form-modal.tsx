"use client";

// 新增/編輯商品視窗：表單欄位（含優惠策略動態欄位）與圖片集合管理
// （上傳、拖拉排序、移除；session 上傳未存檔即取消時自動清 Cloudinary 孤兒）。
// 儲存成功後以 onSaved 通知頁面刷新。
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Form,
  Image,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Spin,
  Tag,
  Upload,
} from "antd";
import { CloseCircleFilled, PlusOutlined } from "@ant-design/icons";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  PROMO_STRATEGIES,
  getPromoStrategy,
  type PromoConfig,
} from "@/app/lib/promotions";
import type { ProductRow as Product } from "@/app/lib/products";
import { fetchJson, postJson, putJson, deleteJson } from "@/app/lib/api-client";
import { MAX_PRODUCT_IMAGES } from "@/app/lib/product-constants";

const promoFieldName = (configKey: string) => `promo_${configKey}`;

/** 可拖拉排序的圖片縮圖；id 為圖片 URL。第一張即封面。 */
function SortableThumb({
  url,
  index,
  disabled,
  onRemove,
}: {
  url: string;
  index: number;
  disabled: boolean;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: url });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: "relative",
    width: 96,
    height: 96,
    ...(isDragging ? { zIndex: 9999 } : {}),
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        {...attributes}
        {...listeners}
        style={{
          width: "100%",
          height: "100%",
          cursor: disabled ? "not-allowed" : "move",
          touchAction: "none",
          border: "1px solid #d9d9d9",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <Image
          src={url}
          alt="product"
          preview={false}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
      {index === 0 && (
        <Tag
          color="blue"
          style={{
            position: "absolute",
            bottom: 2,
            left: 2,
            margin: 0,
            fontSize: 10,
            lineHeight: "16px",
            padding: "0 4px",
          }}
        >
          封面
        </Tag>
      )}
      {!disabled && (
        <CloseCircleFilled
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            fontSize: 18,
            color: "#ff4d4f",
            background: "#fff",
            borderRadius: "50%",
            cursor: "pointer",
          }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        />
      )}
    </div>
  );
}

export function ProductFormModal({
  open,
  editing,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** 編輯中的商品；新增時為 null。 */
  editing: Product | null;
  categories: { id: number; name: string }[];
  onClose: () => void;
  /** 新增/更新成功後回呼（頁面重新載入商品列表）。 */
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageError, setImageError] = useState("");
  const uploadedImageUrlsRef = useRef<string[]>([]);
  const [form] = Form.useForm();
  const promoType = Form.useWatch("promoType", form) as string | undefined;
  const selectedStrategy = promoType ? getPromoStrategy(promoType) : undefined;
  const [messageApi, contextHolder] = message.useMessage();

  const modalBusy = uploading || saving;

  // 開窗時帶入編輯資料（或重置為新增），並重設圖片集合與 session 上傳追蹤。
  useEffect(() => {
    if (!open) return;

    setImageUrls(editing?.images ?? []);
    setImageError("");
    uploadedImageUrlsRef.current = [];

    if (editing) {
      form.setFieldsValue({
        code: editing.code,
        name: editing.name,
        price: editing.price,
        stock: editing.stock ?? undefined,
        categoryId: editing.categoryId ?? undefined,
        spec: editing.spec ?? undefined,
        description: editing.description ?? undefined,
        promoType: editing.promoType ?? undefined,
        ...Object.fromEntries(
          Object.entries(editing.promoConfig ?? {}).map(([k, v]) => [
            promoFieldName(k),
            v,
          ]),
        ),
      });
    } else {
      form.resetFields();
    }
  }, [editing, form, open]);

  // 需按住縮圖移動些微距離才啟動拖拉，避免點擊即誤觸。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const resetAndClose = () => {
    setImageUrls([]);
    setImageError("");
    uploadedImageUrlsRef.current = [];
    onClose();
  };

  const deleteUploadedImage = (url: string) => deleteJson("/api/upload", { url });

  const handleUpload = async ({
    file,
    onSuccess,
    onError,
  }: {
    file: File | Blob | string;
    onSuccess?: (body: unknown) => void;
    onError?: (err: Error | ProgressEvent) => void;
  }) => {
    const formData = new FormData();
    formData.append("file", file as File);
    setUploading(true);
    try {
      const { url } = await fetchJson<{ url: string }>("/api/upload", {
        method: "POST",
        body: formData,
      });
      setImageUrls((prev) => [...prev, url]);
      uploadedImageUrlsRef.current = [...uploadedImageUrlsRef.current, url];
      setImageError("");
      onSuccess?.(url);
    } catch (e) {
      onError?.(e as Error);
      messageApi.error("圖片上傳失敗");
    } finally {
      setUploading(false);
    }
  };

  /**
   * 從集合移除一張圖片。若該圖為本次 session 剛上傳、尚未存檔者，立即刪 Cloudinary
   * 並移出追蹤，避免存檔前移除造成孤兒；既有（DB）圖則於儲存時由後端差集清理。
   */
  const removeImage = async (url: string) => {
    if (modalBusy) return;
    setImageUrls((prev) => prev.filter((u) => u !== url));
    if (uploadedImageUrlsRef.current.includes(url)) {
      uploadedImageUrlsRef.current = uploadedImageUrlsRef.current.filter(
        (u) => u !== url,
      );
      try {
        await deleteUploadedImage(url);
      } catch {
        // 盡力刪除；失敗不阻擋 UI（孤兒風險極低）。
      }
    }
  };

  const handleImageDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setImageUrls((prev) => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleSave = async () => {
    if (uploading) return;

    let values: {
      code: string;
      name: string;
      price: string;
      stock?: number | null;
      categoryId: number;
      spec?: string;
      description?: string;
      promoType?: string;
    } & Record<string, unknown>;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const priceNum = Number(values.price);
    const strategy = values.promoType
      ? getPromoStrategy(values.promoType)
      : undefined;
    const promoConfig: PromoConfig | null = strategy
      ? Object.fromEntries(
        strategy.fields.map((f) => [
          f.name,
          Number(values[promoFieldName(f.name)]),
        ]),
      )
      : null;
    const promoPayload = {
      promoType: values.promoType ?? null,
      promoConfig,
    };

    if (imageUrls.length === 0) {
      setImageError("請至少上傳一張商品圖片");
      messageApi.error("請至少上傳一張商品圖片");
      return;
    }

    try {
      setSaving(true);
      if (editing) {
        await putJson(`/api/products/${editing.id}`, {
          code: values.code,
          price: priceNum,
          stock: values.stock ?? null,
          imageUrls,
          categoryId: values.categoryId,
          spec: values.spec,
          description: values.description,
          ...promoPayload,
        });
        messageApi.success("商品已更新");
      } else {
        await postJson("/api/products", {
          code: values.code,
          name: values.name,
          price: priceNum,
          stock: values.stock ?? null,
          imageUrls,
          categoryId: values.categoryId,
          spec: values.spec,
          description: values.description,
          ...promoPayload,
        });
        messageApi.success("商品已新增");
      }

      resetAndClose();
      onSaved();
    } catch (e) {
      messageApi.error(
        e instanceof Error ? e.message : editing ? "更新失敗" : "新增失敗",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (modalBusy) return;

    const uploadedImageUrls = uploadedImageUrlsRef.current;
    if (uploadedImageUrls.length > 0) {
      setSaving(true);
      try {
        await Promise.all(uploadedImageUrls.map(deleteUploadedImage));
      } catch {
        messageApi.error("圖片刪除失敗，請稍後再試");
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    resetAndClose();
  };

  return (
    <>
      {contextHolder}
      <Spin spinning={uploading} fullscreen description="圖片上傳中" />
      <Modal
        title={editing ? "編輯商品" : "新增商品"}
        open={open}
        onOk={handleSave}
        onCancel={handleCancel}
        okText="儲存"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: modalBusy }}
        cancelButtonProps={{ disabled: modalBusy }}
        closable={!modalBusy}
        mask={{ closable: !modalBusy }}
        keyboard={!modalBusy}
        destroyOnHidden
        width={420}
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 16 }}
          disabled={modalBusy}
        >
          <Form.Item
            name="code"
            label="產品編號"
            rules={[
              { required: true, message: "請輸入產品編號" },
              { max: 3, message: "產品編號不可超過 3 個字" },
            ]}
          >
            <Input placeholder="例：1" maxLength={3} />
          </Form.Item>

          <Form.Item
            name="name"
            label="產品名稱"
            rules={[{ required: true, message: "請輸入產品名稱" }]}
          >
            <Input disabled={Boolean(editing)} placeholder="例：無糖豆漿" />
          </Form.Item>

          <Form.Item
            name="categoryId"
            label="分類"
            rules={[{ required: true, message: "請選擇分類" }]}
          >
            <Select
              showSearch={{
                optionFilterProp: 'label'
              }}
              placeholder="請選擇分類"
              options={categories.map((c) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>

          <Form.Item
            name="price"
            label="價格"
            rules={[
              { required: true, message: "請輸入價格" },
              { pattern: /^[1-9]\d*$/, message: "價格需為正整數" },
            ]}
          >
            <Input placeholder="例：50" />
          </Form.Item>

          <Form.Item
            name="stock"
            label="庫存"
            rules={[
              {
                validator: (_, value) => {
                  if (value === undefined || value === null || value === "") {
                    return Promise.resolve();
                  }
                  const num = Number(value);
                  if (!Number.isInteger(num) || num < 0) {
                    return Promise.reject(new Error("庫存需為 0 或正整數"));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber
              min={0}
              precision={0}
              placeholder="留空＝不限量"
              style={{ width: "100%" }}
            />
          </Form.Item>

          <Form.Item name="promoType" label="優惠方式">
            <Select
              allowClear
              placeholder="無優惠"
              options={PROMO_STRATEGIES.map((s) => ({
                label: s.label,
                value: s.type,
              }))}
            />
          </Form.Item>

          {selectedStrategy &&
            selectedStrategy.fields.map((field) => (
              <Form.Item
                key={field.name}
                name={promoFieldName(field.name)}
                label={field.label}
                tooltip={field.tooltip}
                rules={[
                  { required: true, message: `請輸入${field.label}` },
                  {
                    validator: (_, value) => {
                      const num = Number(value);
                      if (
                        !Number.isInteger(num) ||
                        num < field.min ||
                        num > field.max
                      ) {
                        return Promise.reject(
                          new Error(
                            `${field.label}需為介於 ${field.min} ~ ${field.max} 的整數`,
                          ),
                        );
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Input placeholder={field.placeholder} />
              </Form.Item>
            ))}

          <Form.Item name="spec" label="規格">
            <Input placeholder="例：500g/包" />
          </Form.Item>

          <Form.Item name="description" label="說明">
            <Input.TextArea rows={3} placeholder="商品說明（選填）" />
          </Form.Item>

          <Form.Item
            label="商品圖片"
            required
            validateStatus={imageError ? "error" : undefined}
            help={
              imageError ||
              `第一張為封面，可拖拉調整順序（最多 ${MAX_PRODUCT_IMAGES} 張）`
            }
          >
            <DndContext
              sensors={sensors}
              onDragEnd={handleImageDragEnd}
              modifiers={[restrictToParentElement]}
            >
              <SortableContext items={imageUrls} strategy={rectSortingStrategy}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {imageUrls.map((url, index) => (
                    <SortableThumb
                      key={url}
                      url={url}
                      index={index}
                      disabled={modalBusy}
                      onRemove={() => removeImage(url)}
                    />
                  ))}
                  {imageUrls.length < MAX_PRODUCT_IMAGES && (
                    <Upload
                      listType="picture-card"
                      showUploadList={false}
                      customRequest={handleUpload}
                      accept="image/*"
                      disabled={modalBusy}
                    >
                      <div>
                        {uploading ? <Spin size="small" /> : <PlusOutlined />}
                        <div style={{ marginTop: 8, fontSize: 12 }}>
                          上傳圖片
                        </div>
                      </div>
                    </Upload>
                  )}
                </div>
              </SortableContext>
            </DndContext>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
