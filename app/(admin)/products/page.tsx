"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";

const { Title, Text } = Typography;

interface Product {
  id: number;
  name: string;
  price: number;
  imageUrl: string;
  categoryId: number | null;
  categoryName: string | null;
  spec: string | null;
  description: string | null;
}

interface Category {
  id: number;
  name: string;
}

export default function ProductsPage() {
  const [data, setData] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [currentImageUrl, setCurrentImageUrl] = useState("");
  const [imageError, setImageError] = useState("");
  const uploadedImageUrlsRef = useRef<string[]>([]);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error("Failed to fetch");
      const products: Product[] = await res.json();
      setData(products);
    } catch {
      messageApi.error("讀取商品資料失敗");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) throw new Error("Failed to fetch");
      const cats: Category[] = await res.json();
      setCategories(cats);
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

  const deleteUploadedImage = useCallback(async (url: string) => {
    const res = await fetch("/api/upload", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error("Delete uploaded image failed");
  }, []);

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
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json();
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
    };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const priceNum = Number(values.price);

    if (!currentImageUrl) {
      setImageError("請上傳商品圖片");
      messageApi.error("請上傳商品圖片");
      return;
    }

    try {
      setSaving(true);
      if (editing) {
        const res = await fetch(`/api/products/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            price: priceNum,
            imageUrl: currentImageUrl,
            oldImageUrl: editing.imageUrl,
            categoryId: values.categoryId,
            spec: values.spec,
            description: values.description,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "更新失敗");
        }
        messageApi.success("商品已更新");
      } else {
        const res = await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.name,
            price: priceNum,
            imageUrl: currentImageUrl,
            categoryId: values.categoryId,
            spec: values.spec,
            description: values.description,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "新增失敗");
        }
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
      const res = await fetch(`/api/products/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "刪除失敗");
      }
      messageApi.success("商品已刪除");
      await fetchData();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setSaving(false);
    }
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
        categoryName ? <Tag color="blue">{categoryName}</Tag> : <Text type="secondary">—</Text>,
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

  return (
    <>
      {contextHolder}
      <Spin spinning={uploading} fullscreen description="圖片上傳中" />
      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <Title level={3} style={{ margin: 0 }}>
            商品管理
          </Title>
          <Space>
            <Input
              placeholder="搜尋產品名稱"
              prefix={<SearchOutlined />}
              allowClear
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 220 }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={fetchData}
              loading={loading}
            >
              重新載入
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => openModal()}
            >
              新增商品
            </Button>
          </Space>
        </div>

        <Spin spinning={loading}>
          <Table
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            pagination={{ pageSize: 10, showSizeChanger: true }}
          />
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
