"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Card,
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
  Typography,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  EnvironmentOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { TAIWAN_LOCATIONS } from "@/app/lib/taiwan-locations";
import type { PickupSpotRow as PickupSpot } from "@/app/lib/pickup-spots";
import { fetchJson, postJson, deleteJson } from "@/app/lib/api-client";
import { PageHeader } from "@/app/components/page-header";

const { Text } = Typography;

export default function PickupSpotsPage() {
  const [data, setData] = useState<PickupSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const cityOptions = TAIWAN_LOCATIONS.map((city) => ({
    label: city,
    value: city,
  }));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchJson<PickupSpot[]>("/api/pickup-spots"));
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
    (item) => item.city.includes(search) || item.township.includes(search),
  );

  const openModal = () => {
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
  };

  const handleSave = async () => {
    let values: { city: string; township: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      setSaving(true);
      await postJson("/api/pickup-spots", {
        city: values.city,
        township: values.township,
      });
      messageApi.success("自取地點已新增");
      closeModal();
      await fetchData();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      setSaving(true);
      await deleteJson(`/api/pickup-spots/${id}`);
      messageApi.success("自取地點已刪除");
      await fetchData();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "刪除失敗");
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
      title: "地點",
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
        <PageHeader
          title="自取點管理"
          actions={
            <Space>
              <Input
                placeholder="搜尋縣市或地點"
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
          }
        />

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
            />
          </Form.Item>

          <Form.Item
            name="township"
            label="地點"
            rules={[{ required: true, message: "請輸入地點" }]}
          >
            <Input placeholder="請輸入地點" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
