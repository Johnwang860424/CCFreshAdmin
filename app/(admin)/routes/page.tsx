"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  Tag,
  Typography,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
  ReloadOutlined,
  NodeIndexOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { RouteRow as RouteItem } from "@/app/lib/routes";
import type { PickupSpotRow as PickupSpot } from "@/app/lib/pickup-spots";
import { fetchJson, postJson, putJson, deleteJson } from "@/app/lib/api-client";
import { PageHeader } from "@/app/components/page-header";

const { Text } = Typography;

/** 未分路線虛擬列的 key（非真實路線，不可改名/刪除）。 */
const UNASSIGNED = "unassigned";

/** 路線表的列：真實路線或「未分路線」虛擬列，皆帶其自取點。 */
interface RouteTableRow {
  key: string;
  id: number | null; // null = 未分路線
  name: string;
  isVirtual: boolean;
  spots: PickupSpot[];
}

/** 自取點顯示名稱：縣市 + 地點。 */
function spotLabel(s: PickupSpot): string {
  return `${s.city} ${s.township}`;
}

export default function RoutesPage() {
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [spots, setSpots] = useState<PickupSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // 路線新增/改名（編輯時可一併選取所屬自取點）modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RouteItem | null>(null);
  const [form] = Form.useForm<{ name: string; spotIds?: number[] }>();

  const [messageApi, contextHolder] = message.useMessage();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [routeList, spotList] = await Promise.all([
        fetchJson<RouteItem[]>("/api/routes"),
        fetchJson<PickupSpot[]>("/api/pickup-spots"),
      ]);
      setRoutes(routeList);
      setSpots(spotList);
    } catch {
      messageApi.error("讀取路線資料失敗");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const spotById = useMemo(
    () => new Map(spots.map((s) => [s.id, s])),
    [spots],
  );

  // 組出表格列：真實路線 + 「未分路線」虛擬列（有未分配自取點時才顯示）。
  const tableRows = useMemo<RouteTableRow[]>(() => {
    const spotsByRoute = new Map<number, PickupSpot[]>();
    const unassigned: PickupSpot[] = [];
    for (const s of spots) {
      if (s.routeId == null) unassigned.push(s);
      else {
        if (!spotsByRoute.has(s.routeId)) spotsByRoute.set(s.routeId, []);
        spotsByRoute.get(s.routeId)!.push(s);
      }
    }
    const rows: RouteTableRow[] = routes
      .filter((r) => r.name.includes(search))
      .map((r) => ({
        key: String(r.id),
        id: r.id,
        name: r.name,
        isVirtual: false,
        spots: spotsByRoute.get(r.id) ?? [],
      }));
    if (unassigned.length > 0 && "未分路線".includes(search)) {
      rows.push({
        key: UNASSIGNED,
        id: null,
        name: "未分路線",
        isVirtual: true,
        spots: unassigned,
      });
    }
    return rows;
  }, [routes, spots, search]);

  // 編輯路線時的自取點選項：未分路線與「本路線」可選；屬於其他路線者停用（避免被重複選取）。
  const spotOptions = useMemo(() => {
    const currentId = editing?.id ?? null;
    return spots.map((s) => {
      const takenByOther = s.routeId != null && s.routeId !== currentId;
      return {
        value: s.id,
        label: takenByOther
          ? `${spotLabel(s)}（已屬 ${s.routeName}）`
          : spotLabel(s),
        disabled: takenByOther,
      };
    });
  }, [spots, editing]);

  const openModal = (record?: RouteItem) => {
    setEditing(record ?? null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      const currentSpotIds = spots
        .filter((s) => s.routeId === editing.id)
        .map((s) => s.id);
      form.setFieldsValue({ name: editing.name, spotIds: currentSpotIds });
    } else {
      form.resetFields();
    }
  }, [editing, form, modalOpen, spots]);

  const handleSave = async () => {
    let values: { name: string; spotIds?: number[] };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      setSaving(true);
      if (editing) {
        if (values.name !== editing.name) {
          await putJson(`/api/routes/${editing.id}`, { name: values.name });
        }
        // 比對自取點選取差異：新增者設 route_id = 本路線，移除者設 route_id = null。
        const selected = new Set(values.spotIds ?? []);
        const original = new Set(
          spots.filter((s) => s.routeId === editing.id).map((s) => s.id),
        );
        const toAssign = [...selected].filter((id) => !original.has(id));
        const toUnassign = [...original].filter((id) => !selected.has(id));
        await Promise.all([
          ...toAssign.map((id) =>
            putJson(`/api/pickup-spots/${id}`, {
              township: spotById.get(id)!.township,
              routeId: editing.id,
            }),
          ),
          ...toUnassign.map((id) =>
            putJson(`/api/pickup-spots/${id}`, {
              township: spotById.get(id)!.township,
              routeId: null,
            }),
          ),
        ]);
        messageApi.success("路線已更新");
      } else {
        await postJson("/api/routes", { name: values.name });
        messageApi.success("路線已新增");
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
      await deleteJson(`/api/routes/${id}`);
      messageApi.success("路線已刪除");
      await fetchData();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnsType<RouteTableRow> = [
    {
      title: "路線名稱",
      dataIndex: "name",
      key: "name",
      width: 200,
      render: (name: string, record) =>
        record.isVirtual ? (
          <Space>
            <NodeIndexOutlined style={{ color: "#bfbfbf" }} />
            <Text type="secondary">{name}</Text>
          </Space>
        ) : (
          <Space>
            <NodeIndexOutlined style={{ color: "#1677ff" }} />
            <Text strong>{name}</Text>
          </Space>
        ),
    },
    {
      title: "自取點",
      key: "spots",
      render: (_: unknown, record) =>
        record.spots.length === 0 ? (
          <Text type="secondary">（無）</Text>
        ) : (
          <Space size={[4, 4]} wrap>
            {record.spots.map((s) => (
              <Tag
                key={s.id}
                color={record.isVirtual ? "default" : "blue"}
              >
                {spotLabel(s)}
              </Tag>
            ))}
          </Space>
        ),
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      align: "center",
      render: (_: unknown, record) =>
        record.isVirtual || record.id == null ? null : (
          <Space>
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() =>
                openModal({
                  id: record.id as number,
                  name: record.name,
                  spotCount: record.spots.length,
                })
              }
            />
            <Popconfirm
              title="確定刪除？"
              description={`將刪除「${record.name}」`}
              onConfirm={() => handleDelete(record.id as number)}
              okText="確定"
              cancelText="取消"
              disabled={record.spots.length > 0}
            >
              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
                disabled={record.spots.length > 0}
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
          title="路線管理"
          actions={
            <Space wrap>
              <Input
                placeholder="搜尋路線名稱"
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
                新增路線
              </Button>
            </Space>
          }
        />

        <Spin spinning={loading}>
          <Table
            rowKey="key"
            columns={columns}
            dataSource={tableRows}
            pagination={{ defaultPageSize: 10, showSizeChanger: true }}
            scroll={{ x: "max-content" }}
          />
        </Spin>
      </Card>

      <Modal
        title={editing ? "編輯路線" : "新增路線"}
        open={modalOpen}
        onOk={handleSave}
        onCancel={closeModal}
        okText="儲存"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
        width={480}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="路線名稱"
            rules={[{ required: true, message: "請輸入路線名稱" }]}
          >
            <Input placeholder="例：北區 A 線" />
          </Form.Item>

          {editing && (
            <Form.Item
              name="spotIds"
              label="所屬自取點"
              tooltip="已屬於其他路線的自取點無法選取（每個自取點僅能屬於一條路線）"
            >
              <Select
                mode="multiple"
                allowClear
                showSearch
                placeholder="選取此路線的自取點"
                options={spotOptions}
                optionFilterProp="label"
                notFoundContent="尚無自取點"
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
