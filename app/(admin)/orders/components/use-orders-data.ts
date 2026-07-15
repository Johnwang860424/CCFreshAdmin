"use client";

import { useCallback, useEffect, useState } from "react";
import type { OrderRow as Order } from "@/app/lib/orders";
import { fetchJson } from "@/app/lib/api-client";

export const DELIVERY = "__delivery__";
export const UNASSIGNED = "unassigned";

interface RouteOption {
  id: number;
  name: string;
}

interface RouteOptionsResponse {
  routes: RouteOption[];
  hasUnassigned: boolean;
  hasDelivery: boolean;
}

export function useOrdersData(reportError: (message: string) => void) {
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [hasUnassigned, setHasUnassigned] = useState(false);
  const [hasDelivery, setHasDelivery] = useState(false);
  const [routesLoading, setRoutesLoading] = useState(true);
  const [selected, setSelected] = useState<string>();
  const [data, setData] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRouteOptions = useCallback(async () => {
    setRoutesLoading(true);
    try {
      const result = await fetchJson<RouteOptionsResponse>("/api/orders");
      setRoutes(result.routes);
      setHasUnassigned(result.hasUnassigned);
      setHasDelivery(result.hasDelivery);
    } catch {
      reportError("讀取路線選項失敗");
    } finally {
      setRoutesLoading(false);
    }
  }, [reportError]);

  const fetchOrders = useCallback(async (target: string) => {
    setLoading(true);
    try {
      const url =
        target === DELIVERY
          ? "/api/orders?method=delivery"
          : target === UNASSIGNED
            ? "/api/orders?route=unassigned"
            : "/api/orders?route=" + encodeURIComponent(target);
      setData(await fetchJson<Order[]>(url));
    } catch {
      reportError("讀取訂單資料失敗");
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  const refresh = useCallback(() => {
    void fetchRouteOptions();
    if (selected) void fetchOrders(selected);
  }, [fetchOrders, fetchRouteOptions, selected]);

  useEffect(() => {
    void fetchRouteOptions();
  }, [fetchRouteOptions]);

  useEffect(() => {
    if (selected) void fetchOrders(selected);
    else setData([]);
  }, [fetchOrders, selected]);

  return {
    routes,
    hasUnassigned,
    hasDelivery,
    routesLoading,
    selected,
    setSelected,
    data,
    loading,
    refresh,
  };
}
