"use client";

// 訂單列表：主表格（含跨分頁全選、展開明細列、編輯/刪除操作）。
// 篩選/排序由頁面完成後以 data 傳入；勾選狀態由頁面持有（跨表格與出貨/匯出動作共用）。
import type { Key } from "react";
import {
  Button,
  Checkbox,
  Descriptions,
  Empty,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { getPromoStrategy, type PromoConfig } from "@/app/lib/promotions";
import type {
  OrderRow as Order,
  OrderItemRow as OrderItem,
} from "@/app/lib/orders";
import { formatPickupCode } from "@/app/lib/pickup-code";

const { Text } = Typography;

/** 將明細的促銷快照轉成顯示文字（找不到對應策略時不顯示） */
function describePromo(
  promoType: string | null,
  promoConfig: PromoConfig | null,
): string | null {
  if (!promoType || !promoConfig) return null;
  const strategy = getPromoStrategy(promoType);
  if (!strategy) return null;
  return strategy.describe(promoConfig);
}

/** 來源標籤的顯示色。 */
function tagColor(tag: string): string {
  if (tag === "FB") return "blue";
  if (tag === "Line") return "green";
  return "default";
}

/** 展開列：取貨資訊 + 明細品項小表格。 */
function expandedRowRender(record: Order) {
  return (
    <div style={{ padding: "0 16px" }}>
      <Descriptions
        size="small"
        column={1}
        style={{ marginBottom: record.items.length > 0 ? 12 : 0 }}
      >
        {record.deliveryMethod === "delivery" && record.shippingAddress && (
          <Descriptions.Item label="宅配地址">
            {record.shippingAddress}
          </Descriptions.Item>
        )}
        {record.pickupSpotLabel && (
          <Descriptions.Item label="自取點">
            {record.pickupSpotLabel}
          </Descriptions.Item>
        )}
        {record.routeName && (
          <Descriptions.Item label="路線">
            {record.routeName}
          </Descriptions.Item>
        )}
        {record.note && (
          <Descriptions.Item label="備註">{record.note}</Descriptions.Item>
        )}
      </Descriptions>
      {record.items.length > 0 ? (
        <Table
          sticky
          rowKey="id"
          dataSource={record.items}
          pagination={false}
          size="small"
          columns={[
            {
              title: "商品",
              dataIndex: "productName",
              key: "productName",
            },
            {
              title: "單價",
              dataIndex: "unitPrice",
              key: "unitPrice",
              width: 80,
              render: (v: number) => `$${v}`,
            },
            {
              title: "數量",
              dataIndex: "quantity",
              key: "quantity",
              width: 60,
              render: (quantity: number) =>
                quantity === 0 ? <Tag color="red">0/無法供貨</Tag> : quantity,
            },
            {
              title: "優惠",
              key: "promo",
              width: 120,
              render: (_: unknown, item: OrderItem) => {
                const text = describePromo(item.promoType, item.promoConfig);
                return text ? <Tag color="volcano">{text}</Tag> : "-";
              },
            },
            {
              title: "小計",
              key: "subtotal",
              width: 100,
              render: (_: unknown, item: OrderItem) => {
                const original = item.unitPrice * item.quantity;
                const discounted = item.subtotal < original;
                return (
                  <Space size={4}>
                    {discounted && (
                      <Text delete type="secondary" style={{ fontSize: 12 }}>
                        ${original}
                      </Text>
                    )}
                    <Text strong={discounted}>${item.subtotal}</Text>
                  </Space>
                );
              },
            },
          ]}
          scroll={{ x: "max-content" }}
        />
      ) : (
        <Empty
          description="此訂單無明細項目"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      )}
    </div>
  );
}

export function OrdersTable({
  data,
  isDup,
  selectedRowKeys,
  onSelectionChange,
  onEdit,
  onDelete,
}: {
  /** 已篩選（且必要時已排序）的訂單。 */
  data: Order[];
  /** 是否為重複下訂（客戶欄加註「重複」標籤）。 */
  isDup: (order: Order) => boolean;
  /** 勾選的訂單 id（跨分頁保留，由頁面持有）。 */
  selectedRowKeys: Key[];
  onSelectionChange: (keys: Key[]) => void;
  onEdit: (order: Order) => void;
  onDelete: (order: Order) => void;
}) {
  // 表頭全選：涵蓋目前篩選結果的所有分頁（非僅目前頁）。
  const dataKeys = data.map((o) => o.id);
  const selectedKeySet = new Set(selectedRowKeys);
  const allSelected =
    dataKeys.length > 0 && dataKeys.every((k) => selectedKeySet.has(k));
  const someSelected = dataKeys.some((k) => selectedKeySet.has(k));

  // 勾選/取消目前篩選結果的全部訂單（跨分頁），保留篩選範圍外已勾選者不變。
  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      const set = new Set(selectedRowKeys);
      dataKeys.forEach((k) => set.add(k));
      onSelectionChange([...set]);
    } else {
      const dset = new Set<Key>(dataKeys);
      onSelectionChange(selectedRowKeys.filter((k) => !dset.has(k)));
    }
  };

  const columns: ColumnsType<Order> = [
    {
      title: "取貨號",
      key: "pickupNumber",
      width: 90,
      render: (_: unknown, order: Order) => {
        const code = formatPickupCode(order.spotCode, order.pickupNumber, order.tag);
        return code == null ? (
          "-"
        ) : (
          <Tag color="geekblue" style={{ fontSize: 16, fontWeight: 700 }}>
            {code}
          </Tag>
        );
      },
    },
    {
      title: "客戶",
      dataIndex: "customerName",
      key: "customerName",
      width: 160,
      ellipsis: true,
      render: (name: string, order: Order) =>
        isDup(order) ? (
          <>
            {name}
            <Tag color="orange" style={{ marginLeft: 4 }}>
              重複
            </Tag>
          </>
        ) : (
          name
        ),
    },
    {
      title: "來源",
      dataIndex: "tag",
      key: "tag",
      width: 90,
      render: (tag: string) => <Tag color={tagColor(tag)}>{tag || "網站"}</Tag>,
    },
    {
      title: "總額",
      dataIndex: "total",
      key: "total",
      width: 110,
      render: (total: number) => (
        <Text strong style={{ color: "#cf1322" }}>
          ${total}
        </Text>
      ),
    },
    {
      title: "聯絡電話",
      dataIndex: "phone",
      key: "phone",
      width: 140,
      render: (phone: string | null) => phone ?? "-",
    },
    {
      title: "建立時間",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (createdAt: string) =>
        new Date(createdAt).toLocaleString("zh-TW", {
          timeZone: "Asia/Taipei",
        }),
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      align: "center",
      fixed: "right",
      render: (_: unknown, order: Order) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => onEdit(order)}
          />
          <Popconfirm
            title="確定刪除？"
            description={`將刪除訂單「#${order.id} (${order.customerName})」`}
            onConfirm={() => onDelete(order)}
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
    <Table
      sticky
      rowKey="id"
      columns={columns}
      dataSource={data}
      rowSelection={{
        selectedRowKeys,
        onChange: onSelectionChange,
        preserveSelectedRowKeys: true,
        columnTitle: (
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && someSelected}
            disabled={dataKeys.length === 0}
            onChange={(e) => toggleSelectAll(e.target.checked)}
          />
        ),
      }}
      expandable={{
        expandedRowRender,
        rowExpandable: () => true,
      }}
      pagination={{ defaultPageSize: 10, showSizeChanger: true }}
      locale={{ emptyText: "此路線目前沒有訂單" }}
      scroll={{ x: "max-content" }}
    />
  );
}
