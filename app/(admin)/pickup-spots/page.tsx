"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useContext,
  createContext,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
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
  EditOutlined,
  SearchOutlined,
  ReloadOutlined,
  EnvironmentOutlined,
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
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TAIWAN_LOCATIONS } from "@/app/lib/taiwan-locations";
import type { PickupSpotRow as PickupSpot } from "@/app/lib/pickup-spots";
import { fetchJson, postJson, putJson, deleteJson } from "@/app/lib/api-client";
import { PageHeader } from "@/app/components/page-header";

const { Text } = Typography;

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

/** 可排序的表格列；id 對應 rowKey（自取點 id）。 */
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

export default function PickupSpotsPage() {
  const [data, setData] = useState<PickupSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PickupSpot | null>(null);
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

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({ city: editing.city, township: editing.township });
    } else {
      form.resetFields();
    }
  }, [modalOpen, editing, form]);

  const filtered = data.filter(
    (item) => item.city.includes(search) || item.township.includes(search),
  );

  // 排序模式下：依縣市分組，群組順序沿用 TAIWAN_LOCATIONS 既定固定序。
  const groups = useMemo(() => {
    const byCity = new Map<string, PickupSpot[]>();
    for (const spot of data) {
      const list = byCity.get(spot.city);
      if (list) list.push(spot);
      else byCity.set(spot.city, [spot]);
    }
    const cityRank = (city: string) => {
      const i = (TAIWAN_LOCATIONS as readonly string[]).indexOf(city);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...byCity.entries()]
      .sort((a, b) => cityRank(a[0]) - cityRank(b[0]) || a[0].localeCompare(b[0]))
      .map(([city, spots]) => ({ city, spots }));
  }, [data]);

  const openModal = (record?: PickupSpot) => {
    setEditing(record ?? null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
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
      if (editing) {
        // 僅送 township；縣市不可更改。
        await putJson(`/api/pickup-spots/${editing.id}`, {
          township: values.township,
        });
        messageApi.success("自取地點已更新");
      } else {
        await postJson("/api/pickup-spots", {
          city: values.city,
          township: values.township,
        });
        messageApi.success("自取地點已新增");
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
      await deleteJson(`/api/pickup-spots/${id}`);
      messageApi.success("自取地點已刪除");
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

  // 每縣市各自一個 onDragEnd：只在「同縣市群組內」調整順序並即時樂觀儲存。
  const makeDragEndHandler =
    (city: string) =>
      async ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;

        const prev = data;
        const cityItems = prev.filter((i) => i.city === city);
        const oldIndex = cityItems.findIndex((i) => i.id === active.id);
        const newIndex = cityItems.findIndex((i) => i.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;

        const reordered = arrayMove(cityItems, oldIndex, newIndex);
        // 把重排後的該縣市項目，依序填回原本屬於該縣市的位置，其餘列不動。
        let k = 0;
        const next = prev.map((i) => (i.city === city ? reordered[k++] : i));
        setData(next); // 樂觀更新

        try {
          setReordering(true);
          await putJson("/api/pickup-spots/reorder", {
            city,
            ids: reordered.map((i) => i.id),
          });
        } catch {
          setData(prev); // 失敗回滾
          messageApi.error("排序儲存失敗，已還原順序");
        } finally {
          setReordering(false);
        }
      };

  const baseColumns: ColumnsType<PickupSpot> = [
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
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openModal(record)}
          />
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

  // 排序模式：把手在前、隱藏「縣市」（已是群組標題）與「操作」欄，避免拖拉時誤觸。
  const sortColumns: ColumnsType<PickupSpot> = [
    {
      title: "排序",
      key: "sort",
      width: 64,
      align: "center",
      render: () => <DragHandle />,
    },
    {
      title: "地點",
      dataIndex: "township",
      key: "township",
      render: (township: string) => <Text>{township}</Text>,
    },
  ];

  return (
    <>
      {contextHolder}
      <Card classNames={{ body: "p-3 sm:p-6" }}>
        <PageHeader
          title="自取點管理"
          actions={
            sortMode ? (
              <Space wrap>
                <Text type="secondary">
                  拖拉左側把手調整同縣市內順序，變更即時儲存
                </Text>
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
                  placeholder="搜尋縣市或地點"
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
                  新增自取點
                </Button>
              </Space>
            )
          }
        />

        <Spin spinning={loading}>
          {sortMode ? (
            <Space orientation="vertical" size="large" style={{ width: "100%" }}>
              {groups.map(({ city, spots }) => (
                <div key={city}>
                  <Space style={{ marginBottom: 8 }}>
                    <EnvironmentOutlined style={{ color: "#1677ff" }} />
                    <Text strong>{city}</Text>
                  </Space>
                  <DndContext
                    sensors={sensors}
                    onDragEnd={makeDragEndHandler(city)}
                    modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                    autoScroll={{ threshold: { x: 0, y: 0.05 } }}
                  >
                    <SortableContext
                      items={spots.map((i) => i.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <Table
                        rowKey="id"
                        columns={sortColumns}
                        dataSource={spots}
                        pagination={false}
                        scroll={{ x: "max-content" }}
                        components={{ body: { row: SortableRow } }}
                      />
                    </SortableContext>
                  </DndContext>
                </div>
              ))}
            </Space>
          ) : (
            <Table
              rowKey="id"
              columns={baseColumns}
              dataSource={filtered}
              pagination={{ defaultPageSize: 10, showSizeChanger: true }}
              scroll={{ x: "max-content" }}
            />
          )}
        </Spin>
      </Card>

      <Modal
        title={editing ? "編輯自取地點" : "新增自取地點"}
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
            name="city"
            label="縣市"
            rules={[{ required: true, message: "請選擇縣市" }]}
          >
            <Select
              showSearch
              placeholder="請選擇縣市"
              options={cityOptions}
              optionFilterProp="label"
              disabled={!!editing}
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
