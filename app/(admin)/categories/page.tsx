"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Button,
  Space,
  Input,
  Modal,
  Form,
  Popconfirm,
  message,
  Spin,
  Tag,
  Typography,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { CategoryRow as Category } from "@/app/lib/categories";
import { fetchJson, postJson, putJson, deleteJson } from "@/app/lib/api-client";
import { PageHeader } from "@/app/components/page-header";

const { Text } = Typography;

export default function CategoriesPage() {
  const [data, setData] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchJson<Category[]>("/api/categories"));
    } catch {
      messageApi.error("讀取分類資料失敗");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({ name: editing.name });
    } else {
      form.resetFields();
    }
  }, [editing, form, modalOpen]);

  const filtered = data.filter((item) => item.name.includes(search));

  const openModal = (record?: Category) => {
    setEditing(record ?? null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const handleSave = async () => {
    let values: { name: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    try {
      setSaving(true);
      if (editing) {
        await putJson(`/api/categories/${editing.id}`, { name: values.name });
        messageApi.success("分類已更新");
      } else {
        await postJson("/api/categories", { name: values.name });
        messageApi.success("分類已新增");
      }
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

  const handleDelete = async (id: number) => {
    try {
      setSaving(true);
      await deleteJson(`/api/categories/${id}`);
      messageApi.success("分類已刪除");
      await fetchData();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<Category> = [
    {
      title: "分類名稱",
      dataIndex: "name",
      key: "name",
      render: (name: string) => (
        <Space>
          <AppstoreOutlined style={{ color: "#1677ff" }} />
          <Text strong>{name}</Text>
        </Space>
      ),
    },
    {
      title: "商品數",
      dataIndex: "productCount",
      key: "productCount",
      width: 120,
      render: (count: number) => <Tag>{count}</Tag>,
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      align: "center",
      fixed: "right",
      render: (_: unknown, record: Category) => (
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
            disabled={record.productCount > 0}
          >
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              disabled={record.productCount > 0}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      {contextHolder}
      <Card classNames={{ body: "p-3 sm:p-6" }}>
        <PageHeader
          title="分類管理"
          actions={
            <Space wrap>
              <Input
                placeholder="搜尋分類名稱"
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
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => openModal()}
              >
                新增分類
              </Button>
            </Space>
          }
        />

        <Spin spinning={loading}>
          <Table
            sticky
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            pagination={{ defaultPageSize: 10, showSizeChanger: true }}
            scroll={{ x: "max-content" }}
          />
        </Spin>
      </Card>

      <Modal
        title={editing ? "編輯分類" : "新增分類"}
        open={modalOpen}
        onOk={handleSave}
        onCancel={closeModal}
        okText="儲存"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
        width={420}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="分類名稱"
            rules={[{ required: true, message: "請輸入分類名稱" }]}
          >
            <Input placeholder="例：蔬菜" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
