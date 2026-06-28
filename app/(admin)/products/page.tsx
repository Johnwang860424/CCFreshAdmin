"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useContext,
  createContext,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
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
  Form,
  Popconfirm,
  message,
  Spin,
  Image,
  Upload,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  ShoppingOutlined,
  PictureOutlined,
  CloseCircleFilled,
  HolderOutlined,
  SortAscendingOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  PROMO_STRATEGIES,
  getPromoStrategy,
  type PromoConfig,
} from "@/app/lib/promotions";
import type { ProductRow as Product } from "@/app/lib/products";
import { fetchJson, postJson, putJson, deleteJson } from "@/app/lib/api-client";
import { PageHeader } from "@/app/components/page-header";

const { Text } = Typography;

interface Category {
  id: number;
  name: string;
}

const promoFieldName = (configKey: string) => `promo_${configKey}`;

// ── 拖拉排序：dnd-kit + antd Table 自訂列 ──────────────────────────────
interface RowContextProps {
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
  listeners?: Record<string, (event: unknown) => void>;
}
const RowContext = createContext<RowContextProps>({});

/** 排序模式下的拖拉把手；只有按住此把手才會觸發拖拉。 */
function DragHandle() {
  const { setActivatorNodeRef, listeners } = useContext(RowContext);
  return (
    <Button
      type="text"
      size="small"
      icon={<HolderOutlined />}
      style={{ cursor: "move", touchAction: "none" }}
      ref={setActivatorNodeRef}
      {...listeners}
    />
  );
}

/** 可排序的表格列；id 對應 rowKey（商品 id）。 */
function SortableRow(
  props: HTMLAttributes<HTMLTableRowElement> & { "data-row-key": number },
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props["data-row-key"] });

  const style: CSSProperties = {
    ...props.style,
    transform: CSS.Translate.toString(transform),
    transition,
    ...(isDragging ? { position: "relative", zIndex: 9999 } : {}),
  };

  const contextValue = useMemo<RowContextProps>(
    () => ({
      setActivatorNodeRef,
      listeners: listeners as RowContextProps["listeners"],
    }),
    [setActivatorNodeRef, listeners],
  );

  return (
    <RowContext.Provider value={contextValue}>
      <tr {...props} ref={setNodeRef} style={style} {...attributes} />
    </RowContext.Provider>
  );
}

export default function ProductsPage() {
  const [data, setData] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [currentImageUrl, setCurrentImageUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const uploadedImageUrlsRef = useRef<string[]>([]);
  const [form] = Form.useForm();
  const promoType = Form.useWatch("promoType", form) as string | undefined;
  const selectedStrategy = promoType ? getPromoStrategy(promoType) : undefined;
  const [messageApi, contextHolder] = message.useMessage();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchJson<Product[]>("/api/products"));
    } catch {
      messageApi.error("讀取商品資料失敗");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  const fetchCategories = useCallback(async () => {
    try {
      setCategories(await fetchJson<Category[]>("/api/categories"));
    } catch {
      messageApi.error("讀取分類資料失敗");
    }
  }, [messageApi]);

  useEffect(() => {
    fetchData();
    fetchCategories();
  }, [fetchData, fetchCategories]);

  useEffect(() => {
    if (!modalOpen) return;

    if (editing) {
      form.setFieldsValue({
        name: editing.name,
        price: editing.price,
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
  }, [editing, form, modalOpen]);

  const filtered = data.filter((item) => item.name.includes(search));
  const modalBusy = uploading || saving;

  const openModal = (record?: Product) => {
    setEditing(record ?? null);
    setCurrentImageUrl(record?.imageUrl ?? "");
    setImageError("");
    uploadedImageUrlsRef.current = [];
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setCurrentImageUrl("");
    setImageError("");
    uploadedImageUrlsRef.current = [];
  };

  const deleteUploadedImage = useCallback(
    (url: string) => deleteJson("/api/upload", { url }),
    [],
  );

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
      setCurrentImageUrl(url);
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

  const handleSave = async () => {
    if (uploading) return;

    let values: {
      name: string;
      price: string;
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

    if (!currentImageUrl) {
      setImageError("請上傳商品圖片");
      messageApi.error("請上傳商品圖片");
      return;
    }

    try {
      setSaving(true);
      if (editing) {
        await putJson(`/api/products/${editing.id}`, {
          price: priceNum,
          imageUrl: currentImageUrl,
          oldImageUrl: editing.imageUrl,
          categoryId: values.categoryId,
          spec: values.spec,
          description: values.description,
          ...promoPayload,
        });
        messageApi.success("商品已更新");
      } else {
        await postJson("/api/products", {
          name: values.name,
          price: priceNum,
          imageUrl: currentImageUrl,
          categoryId: values.categoryId,
          spec: values.spec,
          description: values.description,
          ...promoPayload,
        });
        messageApi.success("商品已新增");
      }

      uploadedImageUrlsRef.current = [];
      closeModal();
      await fetchData();
    } catch (e) {
      messageApi.error(
        e instanceof Error ? e.message : editing ? "更新失敗" : "新增失敗",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleModalCancel = async () => {
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

    closeModal();
  };

  const handleDelete = async (id: number) => {
    try {
      setSaving(true);
      await deleteJson(`/api/products/${id}`);
      messageApi.success("商品已刪除");
      await fetchData();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setSaving(false);
    }
  };

  // 需按住把手移動些微距離才啟動拖拉，避免點擊把手即誤觸。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const prev = data;
    const oldIndex = prev.findIndex((i) => i.id === active.id);
    const newIndex = prev.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(prev, oldIndex, newIndex);
    setData(next); // 樂觀更新

    try {
      setReordering(true);
      await putJson("/api/products/reorder", { ids: next.map((i) => i.id) });
    } catch {
      setData(prev); // 失敗回滾
      messageApi.error("排序儲存失敗，已還原順序");
    } finally {
      setReordering(false);
    }
  };

  const dragHandleColumn: ColumnsType<Product>[number] = {
    title: "排序",
    key: "sort",
    width: 64,
    align: "center",
    render: () => <DragHandle />,
  };

  const columns: ColumnsType<Product> = [
    {
      title: "圖片",
      dataIndex: "imageUrl",
      key: "imageUrl",
      width: 100,
      render: (imageUrl: string) =>
        imageUrl ? (
          <Image
            src={imageUrl}
            alt="product"
            width={60}
            height={60}
            style={{ objectFit: "cover", borderRadius: 4 }}
          />
        ) : (
          <div
            style={{
              width: 60,
              height: 60,
              background: "#f0f0f0",
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PictureOutlined style={{ color: "#bfbfbf", fontSize: 24 }} />
          </div>
        ),
    },
    {
      title: "產品名稱",
      dataIndex: "name",
      key: "name",
      render: (name: string) => (
        <Space>
          <ShoppingOutlined style={{ color: "#1677ff" }} />
          <Text strong>{name}</Text>
        </Space>
      ),
    },
    {
      title: "分類",
      dataIndex: "categoryName",
      key: "categoryName",
      width: 120,
      render: (categoryName: string | null) =>
        categoryName ? (
          <Tag color="blue">{categoryName}</Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "規格",
      dataIndex: "spec",
      key: "spec",
      width: 120,
      render: (spec: string | null) =>
        spec ? <Text>{spec}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: "價格",
      dataIndex: "price",
      key: "price",
      width: 120,
      render: (price: number) => <Text>{price}</Text>,
    },
    {
      title: "優惠",
      key: "promo",
      width: 160,
      render: (_: unknown, record: Product) =>
        record.promoSummary ? (
          <Tag color="red">{record.promoSummary}</Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      align: "center",
      render: (_: unknown, record: Product) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openModal(record)}
          />
          <Popconfirm
            title="確定刪除？"
            description={`將刪除「${record.name}」`}
            onConfirm={() => handleDelete(record.id)}
            okText="確定"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 排序模式：把手在前、隱藏「操作」欄，避免拖拉時誤觸編輯/刪除。
  const sortColumns: ColumnsType<Product> = [
    dragHandleColumn,
    ...columns.filter((c) => c.key !== "actions"),
  ];

  return (
    <>
      {contextHolder}
      <Spin spinning={uploading} fullscreen description="圖片上傳中" />
      <Card classNames={{ body: "p-3 sm:p-6" }}>
        <PageHeader
          title="商品管理"
          actions={
            sortMode ? (
              <Space wrap>
                <Text type="secondary">拖拉左側把手調整順序，變更即時儲存</Text>
                <Button
                  type="primary"
                  icon={<SortAscendingOutlined />}
                  loading={reordering}
                  onClick={() => setSortMode(false)}
                >
                  完成排序
                </Button>
              </Space>
            ) : (
              <Space wrap>
                <Input
                  placeholder="搜尋產品名稱"
                  prefix={<SearchOutlined />}
                  allowClear
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full sm:w-56"
                />
                <Button
                  icon={<ReloadOutlined />}
                  onClick={fetchData}
                  loading={loading}
                >
                  重新載入
                </Button>
                <Button
                  icon={<SortAscendingOutlined />}
                  onClick={() => {
                    setSearch("");
                    setSortMode(true);
                  }}
                >
                  排序
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => openModal()}
                >
                  新增商品
                </Button>
              </Space>
            )
          }
        />

        <Spin spinning={loading}>
          {sortMode ? (
            <DndContext
              sensors={sensors}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              autoScroll={{ threshold: { x: 0, y: 0.05 } }}
            >
              <SortableContext
                items={data.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <Table
                  rowKey="id"
                  columns={sortColumns}
                  dataSource={data}
                  pagination={false}
                  scroll={{ x: "max-content" }}
                  components={{ body: { row: SortableRow } }}
                />
              </SortableContext>
            </DndContext>
          ) : (
            <Table
              rowKey="id"
              columns={columns}
              dataSource={filtered}
              pagination={{ pageSize: 10, showSizeChanger: true }}
              scroll={{ x: "max-content" }}
            />
          )}
        </Spin>
      </Card>

      <Modal
        title={editing ? "編輯商品" : "新增商品"}
        open={modalOpen}
        onOk={handleSave}
        onCancel={handleModalCancel}
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
              showSearch
              placeholder="請選擇分類"
              optionFilterProp="label"
              options={categories.map((c) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>

          <Form.Item
            name="price"
            label="價格"
            rules={[
              { required: true, message: "請輸入價格" },
              { pattern: /^\d+$/, message: "價格需為非負整數" },
            ]}
          >
            <Input placeholder="例：50" />
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
            help={imageError || undefined}
          >
            <Upload
              listType="picture-card"
              showUploadList={false}
              customRequest={handleUpload}
              accept="image/*"
              disabled={modalBusy}
            >
              {currentImageUrl ? (
                <div
                  style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                  }}
                >
                  <Image
                    src={currentImageUrl}
                    alt="product"
                    preview={false}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      borderRadius: 4,
                    }}
                  />
                  <CloseCircleFilled
                    style={{
                      position: "absolute",
                      top: -8,
                      right: -8,
                      fontSize: 18,
                      color: "#ff4d4f",
                      background: "#fff",
                      borderRadius: "50%",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (uploading) return;
                      setCurrentImageUrl("");
                      setImageError("請上傳商品圖片");
                    }}
                  />
                </div>
              ) : (
                <div>
                  {uploading ? <Spin size="small" /> : <PlusOutlined />}
                  <div style={{ marginTop: 8, fontSize: 12 }}>上傳圖片</div>
                </div>
              )}
            </Upload>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
