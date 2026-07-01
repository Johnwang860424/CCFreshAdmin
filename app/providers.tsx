"use client";

import { SessionProvider } from "next-auth/react";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { App as AntdApp } from "antd";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AntdRegistry>
        <AntdApp>{children}</AntdApp>
      </AntdRegistry>
    </SessionProvider>
  );
}
