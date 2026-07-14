"use client";

// 商品列表：一般模式（含操作欄）與排序模式（拖拉把手、隱藏操作欄）共用同一組欄位。
// 排序的樂觀更新/回滾由頁面處理，此處僅回報 onReorderDragEnd。
import {
  Button,
  Image,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PictureOutlined,
  ShoppingOutlined,
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
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ProductRow as Product } from "@/app/lib/products";
import { DragHandle, SortableRow } from "@/app/components/sortable-table-row";

const { Text } = Typography;

export function ProductsTable({
  data,
  sortMode,
  onEdit,
  onDelete,
  onReorderDragEnd,
}: {
  /** 一般模式為篩選結果；排序模式為完整清單（進入排序時頁面已清空搜尋）。 */
  data: Product[];
  sortMode: boolean;
  onEdit: (product: Product) => void;
  onDelete: (id: number) => void;
  /** 排序模式拖拉結束（頁面負責 arrayMove、樂觀更新與失敗回滾）。 */
  onReorderDragEnd: (event: DragEndEvent) => void;
}) {
  // 需按住把手移動些微距離才啟動拖拉，避免點擊把手即誤觸。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

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
      title: "產品編號",
      dataIndex: "code",
      key: "code",
      width: 100,
      render: (code: string) => <Text>{code}</Text>,
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
      title: "庫存",
      dataIndex: "stock",
      key: "stock",
      width: 100,
      render: (stock: number | null) =>
        stock === null ? (
          <Text type="secondary">不限量</Text>
        ) : stock === 0 ? (
          <Tag color="red">售完</Tag>
        ) : (
          <Text>{stock}</Text>
        ),
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
      fixed: "right",
      render: (_: unknown, record: Product) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => onEdit(record)}
          />
          <Popconfirm
            title="確定刪除？"
            description={`將刪除「${record.name}」`}
            onConfirm={() => onDelete(record.id)}
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

  if (sortMode) {
    return (
      <DndContext
        sensors={sensors}
        onDragEnd={onReorderDragEnd}
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
    );
  }

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={data}
      pagination={{ defaultPageSize: 10, showSizeChanger: true }}
      scroll={{ x: "max-content" }}
    />
  );
}
