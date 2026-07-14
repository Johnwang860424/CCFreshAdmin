"use client";

// 拖拉排序：dnd-kit + antd Table 自訂列。
// 供商品管理與自取點管理的「排序模式」表格共用：
// Table 傳 components={{ body: { row: SortableRow } }}，把手欄 render <DragHandle />。
import {
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import { Button } from "antd";
import { HolderOutlined } from "@ant-design/icons";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface RowContextProps {
  setActivatorNodeRef?: (element: HTMLElement | null) => void;
  listeners?: Record<string, (event: unknown) => void>;
}
const RowContext = createContext<RowContextProps>({});

/** 排序模式下的拖拉把手；只有按住此把手才會觸發拖拉。 */
export function DragHandle() {
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

/** 可排序的表格列；id 對應 rowKey（實體 id）。 */
export function SortableRow(
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
