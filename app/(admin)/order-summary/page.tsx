"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  Table,
  Select,
  DatePicker,
  Button,
  Space,
  Spin,
  Empty,
  message,
  Typography,
} from "antd";
import { ReloadOutlined, DownloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import type { RouteOrderMatrix } from "@/app/lib/orders";
import type { RouteRow } from "@/app/lib/routes";
import type { ProductRow } from "@/app/lib/products";
import { fetchJson, downloadBlob } from "@/app/lib/api-client";
import { buildCsv } from "@/app/lib/csv";
import { PageHeader } from "@/app/components/page-header";

const { Text } = Typography;
const { RangePicker } = DatePicker;

type MatrixRow = RouteOrderMatrix["rows"][number];

/** 路線下拉的特殊值：全部路線 / 未分路線。 */
const ALL = "all";
const UNASSIGNED = "unassigned";

export default function OrderSummaryPage() {
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [route, setRoute] = useState<string>(ALL);
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([
    dayjs(),
    dayjs(),
  ]);
  const [matrix, setMatrix] = useState<RouteOrderMatrix | null>(null);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  // 全部路線且未指定日期 → 兩條件皆缺，不執行查詢（擇一必填）。
  const noCriteria = route === ALL && !range;

  const fetchRoutes = useCallback(async () => {
    setRoutesLoading(true);
    try {
      const data = await fetchJson<{ routes: { id: number; name: string }[] }>(
        "/api/orders/summary",
      );
      setRoutes(data.routes as RouteRow[]);
    } catch {
      messageApi.error("讀取路線清單失敗");
    } finally {
      setRoutesLoading(false);
    }
  }, [messageApi]);

  const fetchMatrix = useCallback(async () => {
    if (noCriteria) {
      setMatrix(null);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ route });
      if (range) {
        params.set("from", range[0].format("YYYY-MM-DD"));
        params.set("to", range[1].format("YYYY-MM-DD"));
      }
      setMatrix(
        await fetchJson<RouteOrderMatrix>(
          `/api/orders/summary?${params.toString()}`,
        ),
      );
    } catch {
      messageApi.error("讀取訂單統計失敗");
    } finally {
      setLoading(false);
    }
  }, [route, range, noCriteria, messageApi]);

  /** 目前條件對應的顯示名稱（標題/檔名用）。 */
  const routeLabel = useMemo(() => {
    if (route === ALL) return "全部路線";
    if (route === UNASSIGNED) return "未分路線";
    return routes.find((r) => String(r.id) === route)?.name ?? "路線";
  }, [route, routes]);

  const handleDownloadCsv = useCallback(async () => {
    if (!matrix || matrix.rows.length === 0) return;

    try {
      const allProducts = await fetchJson<ProductRow[]>("/api/products");

      const header = [
        "產品名稱",
        "訂單數量",
        "出貨數量",
        "剩餘數量",
        "售出數量",
        "單價",
        "小計",
      ];

      const bodyRows = allProducts.map((product, idx) => {
        const rowIndex = idx + 2;
        return [
          product.name,
          matrix.productTotals[product.name] ?? 0,
          "",
          "",
          `=C${rowIndex}-D${rowIndex}`,
          product.price,
          `=E${rowIndex}*F${rowIndex}`,
        ];
      });

      const csv = buildCsv([header, ...bodyRows]);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const dateLabel = range
        ? `${range[0].format("YYYYMMDD")}-${range[1].format("YYYYMMDD")}`
        : "全部日期";
      downloadBlob(blob, `訂單統計_${routeLabel}_${dateLabel}.csv`);
    } catch {
      messageApi.error("讀取商品清單失敗，無法下載 CSV");
    }
  }, [matrix, range, routeLabel, messageApi]);

  useEffect(() => {
    fetchRoutes();
  }, [fetchRoutes]);

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

  const columns = useMemo<ColumnsType<MatrixRow>>(() => {
    if (!matrix) return [];
    return [
      {
        title: "取貨點",
        dataIndex: "label",
        key: "label",
        fixed: "left",
        width: 160,
        render: (v: string) => <Text strong>{v}</Text>,
      },
      ...matrix.products.map((product) => ({
        title: product,
        key: product,
        align: "center" as const,
        render: (_: unknown, row: MatrixRow) => row.quantities[product] ?? 0,
      })),
    ];
  }, [matrix]);

  const routeOptions = [
    { label: "全部路線", value: ALL },
    ...routes.map((r) => ({ label: r.name, value: String(r.id) })),
    { label: "未分路線", value: UNASSIGNED },
  ];

  return (
    <>
      {contextHolder}
      <Card classNames={{ body: "p-3 sm:p-6" }}>
        <PageHeader
          title="路線訂單統計"
          actions={
            <Space wrap>
              <Select
                showSearch={{
                  optionFilterProp: 'label'
                }}
                className="w-full sm:w-[180px]"
                value={route}
                onChange={setRoute}
                loading={routesLoading}
                options={routeOptions}
              />
              <RangePicker
                value={range}
                onChange={(v) =>
                  setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)
                }
                allowClear
                className="w-full sm:w-auto"
              />
              <Button
                icon={<ReloadOutlined />}
                loading={routesLoading || loading}
                onClick={() => {
                  fetchRoutes();
                  fetchMatrix();
                }}
              >
                重新載入
              </Button>
              <Button
                icon={<DownloadOutlined />}
                disabled={!matrix || matrix.rows.length === 0}
                onClick={handleDownloadCsv}
              >
                下載 CSV
              </Button>
            </Space>
          }
        />

        {noCriteria ? (
          <Empty
            description="請至少指定路線或日期以查詢訂單統計"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Spin spinning={loading}>
            <Table
              sticky
              rowKey="pickupSpotId"
              columns={columns}
              dataSource={matrix?.rows ?? []}
              pagination={false}
              scroll={{ x: "max-content" }}
              locale={{ emptyText: "此條件目前沒有訂單" }}
              summary={() => {
                if (!matrix || matrix.rows.length === 0) return null;
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: "#fafafa" }}>
                      <Table.Summary.Cell index={0}>
                        <Text strong style={{ color: "#cf1322" }}>
                          商品總量
                        </Text>
                      </Table.Summary.Cell>
                      {matrix.products.map((product, i) => (
                        <Table.Summary.Cell
                          key={product}
                          index={i + 1}
                          align="center"
                        >
                          <Text strong style={{ color: "#cf1322" }}>
                            {matrix.productTotals[product] ?? 0}
                          </Text>
                        </Table.Summary.Cell>
                      ))}
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </Spin>
        )}
      </Card>
    </>
  );
}
