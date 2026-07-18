"use client";

import { useCallback, useMemo } from "react";
import type { OrderRow as Order } from "@/app/lib/orders";
import { formatPickupCode } from "@/app/lib/pickup-code";
import {
  countDuplicateOrders,
  duplicateNameKeys,
  orderKey,
  sortDuplicatesAdjacent,
} from "@/app/domain/duplicate-orders";

export function useOrderView(data: Order[], search: string, dupOnly: boolean) {
  const duplicateKeys = useMemo(() => duplicateNameKeys(data), [data]);
  const duplicateCount = useMemo(
    () => countDuplicateOrders(data, duplicateKeys),
    [data, duplicateKeys],
  );

  const isDuplicate = useCallback((order: Order) => {
    const key = orderKey(order);
    return key !== null && duplicateKeys.has(key);
  }, [duplicateKeys]);

  const filtered = useMemo(() => {
    const normalizedSearch = search.toLowerCase();
    const matches = data.filter(
      (order) =>
        (order.customerName.includes(search) ||
          (order.phone ?? "").includes(search) ||
          (order.pickupSpotLabel ?? "").includes(search) ||
          (order.shippingAddress ?? "").includes(search) ||
          (formatPickupCode(order.spotCode, order.pickupNumber, order.tag)
            ?.toLowerCase()
            .includes(normalizedSearch) ??
            false) ||
          String(order.id).includes(search)) &&
        (!dupOnly || isDuplicate(order)),
    );
    return dupOnly ? sortDuplicatesAdjacent(matches, data) : matches;
  }, [data, dupOnly, isDuplicate, search]);

  const routeTotal = useMemo(
    () => filtered.reduce((sum, order) => sum + order.total, 0),
    [filtered],
  );

  const stationTotals = useMemo(() => {
    const totals = new Map<string, number>();
    filtered.forEach((order) => {
      const label =
        order.pickupSpotLabel ??
        (order.deliveryMethod === "delivery" ? "宅配" : "未知自取點");
      totals.set(label, (totals.get(label) ?? 0) + order.total);
    });
    return [...totals].map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  return {
    duplicateCount,
    filtered,
    isDuplicate,
    routeTotal,
    stationTotals,
  };
}
