"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Typography, Button, Space, Input, message, Spin } from "antd";
import {
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  SortAscendingOutlined,
} from "@ant-design/icons";
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent } from "@dnd-kit/core";
import type { ProductRow as Product } from "@/app/lib/products";
import { fetchJson, putJson, deleteJson } from "@/app/lib/api-client";
import { PageHeader } from "@/app/components/page-header";
import { ProductFormModal } from "./components/product-form-modal";
import { ProductsTable } from "./components/products-table";

const { Text } = Typography;

interface Category {
  id: number;
  name: string;
}

/** 排序模式：front＝前台（消費者）排序 sort_order；summary＝路線訂單統計排序 summary_sort_order。 */
type SortMode = "none" | "front" | "summary";

export default function ProductsPage() {
  const [data, setData] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("none");
  const [reordering, setReordering] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchJson<Product[]>("/api/products"));
    } catch {
      messageApi.error("讀取商品資料失敗");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  const fetchCategories = useCallback(async () => {
    try {
      setCategories(await fetchJson<Category[]>("/api/categories"));
    } catch {
      messageApi.error("讀取分類資料失敗");
    }
  }, [messageApi]);

  useEffect(() => {
    fetchData();
    fetchCategories();
  }, [fetchData, fetchCategories]);

  const filtered = data.filter((item) => item.name.includes(search));

  const openModal = (record?: Product) => {
    setEditing(record ?? null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteJson(`/api/products/${id}`);
      messageApi.success("商品已刪除");
      await fetchData();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : "刪除失敗");
    }
  };

  // 進入排序模式：清空搜尋；統計排序模式先把列表改依統計順序（summarySortOrder）顯示。
  const enterSortMode = (mode: Exclude<SortMode, "none">) => {
    setSearch("");
    if (mode === "summary") {
      setData((prev) =>
        [...prev].sort(
          (a, b) => a.summarySortOrder - b.summarySortOrder || a.id - b.id,
        ),
      );
    }
    setSortMode(mode);
  };

  // 離開排序模式：統計排序模式曾把列表改為統計順序，重新載入以還原前台順序。
  const finishSortMode = () => {
    if (sortMode === "summary") fetchData();
    setSortMode("none");
  };

  // 排序模式拖拉結束：樂觀更新列表順序並儲存（依模式寫入前台或統計排序），失敗回滾。
  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const prev = data;
    const oldIndex = prev.findIndex((i) => i.id === active.id);
    const newIndex = prev.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(prev, oldIndex, newIndex);
    setData(next); // 樂觀更新

    const endpoint =
      sortMode === "summary"
        ? "/api/products/reorder-summary"
        : "/api/products/reorder";
    try {
      setReordering(true);
      await putJson(endpoint, { ids: next.map((i) => i.id) });
    } catch {
      setData(prev); // 失敗回滾
      messageApi.error("排序儲存失敗，已還原順序");
    } finally {
      setReordering(false);
    }
  };

  return (
    <>
      {contextHolder}
      <Card classNames={{ body: "p-3 sm:p-6" }}>
        <PageHeader
          title="商品管理"
          actions={
            sortMode !== "none" ? (
              <Space wrap>
                <Text type="secondary">
                  拖拉左側把手調整
                  {sortMode === "summary" ? "統計排序" : "前台排序"}
                  ，變更即時儲存
                </Text>
                <Button
                  type="primary"
                  icon={<SortAscendingOutlined />}
                  loading={reordering}
                  onClick={finishSortMode}
                >
                  完成排序
                </Button>
              </Space>
            ) : (
              <Space wrap>
                <Input
                  placeholder="搜尋產品名稱"
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
                  onClick={() => enterSortMode("front")}
                >
                  前台排序
                </Button>
                <Button
                  icon={<SortAscendingOutlined />}
                  onClick={() => enterSortMode("summary")}
                >
                  統計排序
                </Button>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => openModal()}
                >
                  新增商品
                </Button>
              </Space>
            )
          }
        />

        <Spin spinning={loading}>
          <ProductsTable
            data={sortMode !== "none" ? data : filtered}
            sortMode={sortMode !== "none"}
            onEdit={openModal}
            onDelete={handleDelete}
            onReorderDragEnd={handleDragEnd}
          />
        </Spin>
      </Card>

      <ProductFormModal
        open={modalOpen}
        editing={editing}
        categories={categories}
        onClose={closeModal}
        onSaved={fetchData}
      />
    </>
  );
}
