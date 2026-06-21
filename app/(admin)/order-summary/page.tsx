"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  Table,
  Select,
  Button,
  Space,
  Spin,
  Empty,
  message,
  Typography,
} from "antd";
import { ReloadOutlined, DownloadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { CityOrderMatrix } from "@/app/lib/orders";
import { fetchJson, downloadBlob } from "@/app/lib/api-client";
import { buildCsv } from "@/app/lib/csv";
import { PageHeader } from "@/app/components/page-header";

const { Text } = Typography;

type MatrixRow = CityOrderMatrix["rows"][number];

export default function OrderSummaryPage() {
  const [cities, setCities] = useState<string[]>([]);
  const [city, setCity] = useState<string | undefined>();
  const [matrix, setMatrix] = useState<CityOrderMatrix | null>(null);
  const [citiesLoading, setCitiesLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const fetchCities = useCallback(async () => {
    setCitiesLoading(true);
    try {
      const data = await fetchJson<{ cities: string[] }>("/api/orders/summary");
      setCities(data.cities);
    } catch {
      messageApi.error("讀取縣市清單失敗");
    } finally {
      setCitiesLoading(false);
    }
  }, [messageApi]);

  const fetchMatrix = useCallback(
    async (target: string) => {
      setLoading(true);
      try {
        setMatrix(
          await fetchJson<CityOrderMatrix>(
            `/api/orders/summary?city=${encodeURIComponent(target)}`,
          ),
        );
      } catch {
        messageApi.error("讀取訂單統計失敗");
      } finally {
        setLoading(false);
      }
    },
    [messageApi],
  );

  const handleDownloadCsv = useCallback(() => {
    if (!matrix || matrix.rows.length === 0) return;

    const header = ["地點", ...matrix.products];
    const bodyRows = matrix.rows.map((row) => [
      row.township,
      ...matrix.products.map((product) => row.quantities[product] ?? 0),
    ]);
    const totalRow = [
      "商品總量",
      ...matrix.products.map((product) => matrix.productTotals[product] ?? 0),
    ];

    // buildCsv 已含 UTF-8 BOM，Excel 才能正確顯示中文。
    const csv = buildCsv([header, ...bodyRows, totalRow]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, `訂單統計_${matrix.city}.csv`);
  }, [matrix]);

  useEffect(() => {
    fetchCities();
  }, [fetchCities]);

  useEffect(() => {
    if (city) fetchMatrix(city);
    else setMatrix(null);
  }, [city, fetchMatrix]);

  const columns = useMemo<ColumnsType<MatrixRow>>(() => {
    if (!matrix) return [];
    return [
      {
        title: "地點",
        dataIndex: "township",
        key: "township",
        fixed: "left",
        width: 120,
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

  return (
    <>
      {contextHolder}
      <Card>
        <PageHeader
          title="縣市訂單統計"
          actions={
            <Space>
              <Select
                placeholder="選擇縣市"
                style={{ width: 200 }}
                value={city}
                onChange={setCity}
                loading={citiesLoading}
                options={cities.map((c) => ({ label: c, value: c }))}
                notFoundContent={
                  citiesLoading ? <Spin size="small" /> : "目前沒有自取訂單"
                }
                showSearch
              />
              <Button
                icon={<ReloadOutlined />}
                loading={citiesLoading || loading}
                onClick={() => {
                  fetchCities();
                  if (city) fetchMatrix(city);
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

        {!city ? (
          <Empty
            description="請先選擇縣市以查詢訂單統計"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Spin spinning={loading}>
            <Table
              rowKey="township"
              columns={columns}
              dataSource={matrix?.rows ?? []}
              pagination={false}
              scroll={{ x: "max-content" }}
              locale={{ emptyText: "此縣市目前沒有訂單" }}
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
