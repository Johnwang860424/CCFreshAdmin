"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Typography,
  Table,
  Button,
  Space,
  Input,
  Select,
  Modal,
  Form,
  Popconfirm,
  message,
  Spin,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  EnvironmentOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { TAIWAN_LOCATIONS, type TaiwanCity } from "@/app/lib/taiwan-locations";

const { Title, Text } = Typography;

interface PickupSpot {
  id: number;
  city: string;
  township: string;
}

export default function PickupSpotsPage() {
  const [data, setData] = useState<PickupSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const selectedCity = Form.useWatch<TaiwanCity | undefined>("city", form);
  const [messageApi, contextHolder] = message.useMessage();
  const cityOptions = Object.keys(TAIWAN_LOCATIONS).map((city) => ({
    label: city,
    value: city,
  }));
  const townshipOptions = selectedCity
    ? TAIWAN_LOCATIONS[selectedCity].map((township) => ({
        label: township,
        value: township,
      }))
    : [];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pickup-spots");
      if (!res.ok) throw new Error("Failed to fetch");
      const spots: PickupSpot[] = await res.json();
      setData(spots);
    } catch {
      messageApi.error("讀取自取地點資料失敗");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = data.filter(
    (item) =>
      item.city.includes(search) || item.township.includes(search)
  );

  const openModal = () => {
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const res = await fetch("/api/pickup-spots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: values.city,
          township: values.township,
        }),
      });
      if (!res.ok) throw new Error("Create failed");
      messageApi.success("自取地點已新增");

      closeModal();
      await fetchData();
    } catch {
      messageApi.error("新增失敗");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      setSaving(true);
      const res = await fetch(`/api/pickup-spots/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      messageApi.success("自取地點已刪除");
      await fetchData();
    } catch {
      messageApi.error("刪除失敗");
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<PickupSpot> = [
    {
      title: "縣市",
      dataIndex: "city",
      key: "city",
      width: 160,
      render: (city: string) => (
        <Space>
          <EnvironmentOutlined style={{ color: "#1677ff" }} />
          <Text strong>{city}</Text>
        </Space>
      ),
    },
    {
      title: "鄉鎮",
      dataIndex: "township",
      key: "township",
      render: (township: string) => <Text>{township}</Text>,
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      align: "center",
      render: (_: unknown, record: PickupSpot) => (
        <Space>
          <Popconfirm
            title="確定刪除？"
            description={`將刪除「${record.city} ${record.township}」`}
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
            自取點管理
          </Title>
          <Space>
            <Input
              placeholder="搜尋縣市或鄉鎮"
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
              新增自取點
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
        title="新增自取地點"
        open={modalOpen}
        onOk={handleSave}
        onCancel={closeModal}
        okText="儲存"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
        width={420}
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 16 }}
          preserve={false}
        >
          <Form.Item
            name="city"
            label="縣市"
            rules={[{ required: true, message: "請選擇縣市" }]}
          >
            <Select
              showSearch
              placeholder="請選擇縣市"
              options={cityOptions}
              optionFilterProp="label"
              onChange={() => form.setFieldValue("township", undefined)}
            />
          </Form.Item>

          <Form.Item
            name="township"
            label="鄉鎮"
            rules={[{ required: true, message: "請選擇鄉鎮" }]}
          >
            <Select
              showSearch
              disabled={!selectedCity}
              placeholder={selectedCity ? "請選擇鄉鎮" : "請先選擇縣市"}
              options={townshipOptions}
              optionFilterProp="label"
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
