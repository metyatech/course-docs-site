"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin-mode-footer-toggle.module.css";

const STATUS_PATH = "/api/admin/mode/";
const ADMIN_SESSION_CHANGED_EVENT = "course-docs-admin-session-changed";

type AdminModeUnavailableReason =
  | "no-admin-capability"
  | "missing-admin-mode-token"
  | "missing-admin-session-secret"
  | "invalid-admin-session-secret"
  | "admin-token-must-differ-from-session-secret"
  | null;

type AdminModeStatus = {
  available: boolean;
  configured: boolean;
  enabled: boolean;
  capabilities: { commentModeration: boolean };
  tokenConfigured: boolean;
  sessionSecretConfigured: boolean;
  sessionSecretValid: boolean;
  secretsDistinct: boolean;
  unavailableReason: AdminModeUnavailableReason;
  setupHint: string | null;
};

const defaultStatus: AdminModeStatus = {
  available: false,
  configured: false,
  enabled: false,
  capabilities: { commentModeration: false },
  tokenConfigured: false,
  sessionSecretConfigured: false,
  sessionSecretValid: false,
  secretsDistinct: false,
  unavailableReason: null,
  setupHint: null,
};

const readJson = async <T,>(response: Response, fallback: T): Promise<T> => {
  try {
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
};

const notifyAdminSessionChanged = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ADMIN_SESSION_CHANGED_EVENT));
};

export default function AdminModeFooterToggle() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<AdminModeStatus>(defaultStatus);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadStatus = async () => {
      const response = await fetch(STATUS_PATH, { cache: "no-store" });
      const nextStatus = await readJson<AdminModeStatus>(response, defaultStatus);
      if (response.ok) setStatus(nextStatus);
    };
    void loadStatus();
  }, []);

  const triggerClassName = useMemo(
    () => (status.enabled ? `${styles.trigger} ${styles.triggerActive}` : styles.trigger),
    [status.enabled],
  );

  if (!status.available) {
    return null;
  }

  const handleEnable = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setMessage("管理者コードを入力してください。");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(STATUS_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: trimmed }),
      });
      const nextStatus = await readJson<AdminModeStatus>(response, defaultStatus);
      setStatus(nextStatus);
      if (response.status === 401) {
        setMessage("管理者コードが一致しません。");
        return;
      }
      if (nextStatus.enabled) {
        setToken("");
        setOpen(false);
        notifyAdminSessionChanged();
        router.refresh();
        return;
      }
      if (nextStatus.setupHint) {
        setMessage(nextStatus.setupHint);
        return;
      }
      setMessage("管理者モードは有効化できませんでした。");
    } finally {
      setPending(false);
    }
  };

  const handleDisable = async () => {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(STATUS_PATH, { method: "DELETE" });
      const nextStatus = await readJson<AdminModeStatus>(response, defaultStatus);
      setStatus(nextStatus);
      setToken("");
      setOpen(false);
      notifyAdminSessionChanged();
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setOpen((current) => !current)}
      >
        {status.enabled ? "管理者モード中" : "管理者"}
      </button>
      {open ? (
        <div className={styles.panel}>
          <p className={styles.heading}>管理者モード</p>
          <p className={styles.copy}>
            管理者コードを確認すると、このブラウザで管理者モードが一時的に有効になります。
          </p>
          {message ? <p className={styles.status}>{message}</p> : null}
          <label className={styles.label}>
            管理者コード
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className={styles.input}
              placeholder="管理者コードを入力"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleEnable();
                }
              }}
            />
          </label>
          <div className={styles.actions}>
            {status.enabled ? (
              <button
                type="button"
                className={styles.action}
                onClick={() => void handleDisable()}
                disabled={pending}
              >
                {pending ? "処理中..." : "解除"}
              </button>
            ) : (
              <button
                type="button"
                className={`${styles.action} ${styles.primary}`}
                onClick={() => void handleEnable()}
                disabled={pending}
              >
                {pending ? "処理中..." : "有効化"}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
