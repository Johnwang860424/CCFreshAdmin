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
  Tag,
  Typography,
  Tabs,
  Badge,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
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
  const [activeTab, setActiveTab] = useState<string>("");
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

  // 取得目前有自取點的所有縣市，依照 API 回來的城市順序。
  const activeCities = useMemo(() => {
    return Array.from(new Set(data.map((item) => item.city)));
  }, [data]);

  // 當載入資料後，若目前的 activeTab 不在有資料的縣市中，自動切換至第一個有資料的縣市。
  useEffect(() => {
    if (activeCities.length > 0) {
      const hasActiveTab = activeCities.includes(activeTab);
      if (!hasActiveTab) {
        setActiveTab(activeCities[0]);
      }
    } else {
      setActiveTab("");
    }
  }, [activeCities, activeTab]);

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({
        city: editing.city,
        township: editing.township,
      });
    } else {
      form.resetFields();
      if (activeTab) {
        form.setFieldsValue({ city: activeTab });
      }
    }
  }, [modalOpen, editing, form, activeTab]);

  const spotsInActiveTab = useMemo(() => {
    return data.filter((item) => item.city === activeTab);
  }, [data, activeTab]);

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
        // 縣市不可更改；此頁僅改地點，所屬路線於「路線管理」頁調整（不送 routeId）。
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
        setActiveTab(values.city);
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

  // 只在「目前選擇縣市內」調整順序並即時樂觀儲存（此排序供前台顧客選點使用）。
  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const prev = data;
    const cityItems = prev.filter((i) => i.city === activeTab);
    const oldIndex = cityItems.findIndex((i) => i.id === active.id);
    const newIndex = cityItems.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(cityItems, oldIndex, newIndex);
    // 把重排後的該縣市項目，依序填回原本屬於該縣市的位置，其餘列不動。
    let k = 0;
    const next = prev.map((i) => (i.city === activeTab ? reordered[k++] : i));
    setData(next); // 樂觀更新

    try {
      setReordering(true);
      await putJson("/api/pickup-spots/reorder", {
        city: activeTab,
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
      title: "地點",
      dataIndex: "township",
      key: "township",
      render: (township: string) => (
        <Space>
          <EnvironmentOutlined style={{ color: "#1677ff" }} />
          <Text>{township}</Text>
        </Space>
      ),
    },
    {
      title: "所屬路線",
      dataIndex: "routeName",
      key: "routeName",
      width: 160,
      render: (routeName: string | null) =>
        routeName ? (
          <Tag color="blue">{routeName}</Tag>
        ) : (
          <Tag>未分路線</Tag>
        ),
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

  // 排序模式：把手在前、隱藏「操作」欄，避免拖拉時誤觸。
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
    {
      title: "所屬路線",
      dataIndex: "routeName",
      key: "routeName",
      width: 160,
      render: (routeName: string | null) =>
        routeName ? <Tag color="blue">{routeName}</Tag> : <Tag>未分路線</Tag>,
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
                  拖拉左側把手調整目前縣市內順序，變更即時儲存
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
                <Button
                  icon={<ReloadOutlined />}
                  onClick={fetchData}
                  loading={loading}
                >
                  重新載入
                </Button>
                <Button
                  icon={<SortAscendingOutlined />}
                  disabled={spotsInActiveTab.length <= 1}
                  onClick={() => {
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

        {/* 縣市分組 Tabs（此排序供前台顧客選點使用） */}
        {activeCities.length > 0 && (
          <div className="mb-6">
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={activeCities.map((city) => {
                const count = data.filter((item) => item.city === city).length;
                return {
                  key: city,
                  disabled: sortMode,
                  label: (
                    <Space size="small">
                      <EnvironmentOutlined
                        style={{
                          color: activeTab === city ? "#1677ff" : "inherit",
                        }}
                      />
                      <span>{city}</span>
                      <Badge count={count}
                        color={activeTab === city ? "#1677ff" : "#000000ff"}
                      />
                    </Space>
                  ),
                };
              })}
            />
          </div>
        )}
        <Spin spinning={loading}>
          {sortMode ? (
            <div key={activeTab}>
              <DndContext
                sensors={sensors}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                autoScroll={{ threshold: { x: 0, y: 0.05 } }}
              >
                <SortableContext
                  items={spotsInActiveTab.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <Table
                    rowKey="id"
                    columns={sortColumns}
                    dataSource={spotsInActiveTab}
                    pagination={false}
                    scroll={{ x: "max-content" }}
                    components={{ body: { row: SortableRow } }}
                  />
                </SortableContext>
              </DndContext>
            </div>
          ) : (
            <Table
              rowKey="id"
              columns={baseColumns}
              dataSource={spotsInActiveTab}
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
              showSearch={{
                optionFilterProp: 'label'
              }}
              placeholder="請選擇縣市"
              options={cityOptions}
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
