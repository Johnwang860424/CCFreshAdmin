"use client";

// 新增訂單成功跳窗：顯示取貨號並提供一鍵複製。
import { App, Button, Modal, Typography } from "antd";
import { CheckOutlined, CopyOutlined } from "@ant-design/icons";

export function OrderSuccessModal({
  open,
  pickupCode,
  onClose,
}: {
  open: boolean;
  /** 取貨號顯示字串（formatPickupCode 的結果）；null 顯示空值。 */
  pickupCode: string | null;
  onClose: () => void;
}) {
  const { message: messageApi } = App.useApp();

  return (
    <Modal
      open={open}
      footer={null}
      onCancel={onClose}
      width={400}
      centered
      destroyOnHidden
    >
      <div style={{ textAlign: "center", padding: "20px 0 10px 0" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            backgroundColor: "#f6ffed",
            border: "1px solid #b7eb8f",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px auto",
          }}
        >
          <CheckOutlined style={{ fontSize: 32, color: "#52c41a" }} />
        </div>

        <Typography.Title level={4} style={{ marginBottom: 8 }}>
          訂單建立成功
        </Typography.Title>

        <div
          style={{
            backgroundColor: "#f5f5f5",
            border: "1px solid #d9d9d9",
            borderRadius: 8,
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 12, color: "#8c8c8c", marginBottom: 2 }}>取貨號</div>
            <span style={{ fontSize: 22, fontWeight: 700, fontFamily: "Inter, monospace", color: "#262626" }}>
              {pickupCode}
            </span>
          </div>
          <Button
            type="primary"
            icon={<CopyOutlined />}
            onClick={() => {
              if (pickupCode) {
                navigator.clipboard.writeText(pickupCode);
                messageApi.success("已複製取貨號");
              }
            }}
          >
            複製
          </Button>
        </div>

        <Button type="default" size="large" block onClick={onClose}>
          確定
        </Button>
      </div>
    </Modal>
  );
}
