import type { KeyboardEvent, FocusEvent } from "react";

/**
 * 限制鍵盤輸入，僅允許數字 0-9、系統控制鍵及修飾鍵組合 (Ctrl/Cmd)
 */
export function limitDigitsOnly(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key.length > 1) return; // 允許 Backspace, Tab, Enter, 箭頭鍵等
  if (e.ctrlKey || e.metaKey) return; // 允許複製、貼上、全選等組合鍵
  if (!/^\d$/.test(e.key)) {
    e.preventDefault();
  }
}

/**
 * 聚焦時選取輸入框內所有文字，使用 setTimeout 避免 mouseup 清除選取
 */
export function selectAllOnFocus(e: FocusEvent<HTMLInputElement>) {
  const input = e.target;
  setTimeout(() => {
    if (input) {
      input.select();
    }
  }, 0);
}
