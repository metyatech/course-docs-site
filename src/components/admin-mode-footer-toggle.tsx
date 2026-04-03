"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin-mode-footer-toggle.module.css";

const STORAGE_KEY = "admin-comment-token";
const TOKEN_EVENT = "admin-token";
const STATUS_PATH = "/api/admin/mode/";

type ProtectedLink = {
  href: string;
  label: string;
};

type AdminModeUnavailableReason = "missing-admin-mode-token" | "no-protected-links" | null;

type AdminModeStatus = {
  configured: boolean;
  enabled: boolean;
  protectedLinks: ProtectedLink[];
  publicFallbackPath: string;
  tokenConfigured: boolean;
  unavailableReason: AdminModeUnavailableReason;
  setupHint: string | null;
};

const defaultStatus: AdminModeStatus = {
  configured: false,
  enabled: false,
  protectedLinks: [],
  publicFallbackPath: "/docs/intro",
  tokenConfigured: false,
  unavailableReason: null,
  setupHint: null,
};

const dispatchAdminToken = (token: string) => {
  window.dispatchEvent(new CustomEvent(TOKEN_EVENT, { detail: { token } }));
};

const persistAdminToken = (token: string) => {
  if (token) {
    window.sessionStorage.setItem(STORAGE_KEY, token);
  } else {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
  dispatchAdminToken(token);
};

const readJson = async <T,>(response: Response, fallback: T) => {
  try {
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
};

const matchesProtectedPath = (pathname: string, protectedLinks: ProtectedLink[]) =>
  protectedLinks.some((link) => pathname === link.href || pathname.startsWith(`${link.href}/`));

const getMissingTokenMessage = (status: AdminModeStatus) =>
  status.unavailableReason === "missing-admin-mode-token" ? status.setupHint : null;

export default function AdminModeFooterToggle() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<AdminModeStatus>(defaultStatus);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      setToken(stored);
    }

    const loadStatus = async () => {
      const response = await fetch(STATUS_PATH, { cache: "no-store" });
      const nextStatus = await readJson<AdminModeStatus>(response, defaultStatus);
      if (response.ok) {
        setStatus(nextStatus);
        setMessage(getMissingTokenMessage(nextStatus));
      }
    };

    void loadStatus();
  }, []);

  const triggerClassName = useMemo(
    () => (status.enabled ? `${styles.trigger} ${styles.triggerActive}` : styles.trigger),
    [status.enabled],
  );

  const handleSave = async (nextToken = token) => {
    const trimmed = nextToken.trim();
    setPending(true);
    setMessage(null);

    persistAdminToken(trimmed);

    try {
      if (!trimmed) {
        const response = await fetch(STATUS_PATH, { method: "DELETE" });
        const nextStatus = await readJson<AdminModeStatus>(response, defaultStatus);
        setStatus(nextStatus);
        setOpen(false);
        setMessage(getMissingTokenMessage(nextStatus));

        if (
          matchesProtectedPath(window.location.pathname, nextStatus.protectedLinks) &&
          nextStatus.publicFallbackPath
        ) {
          window.location.assign(nextStatus.publicFallbackPath);
          return;
        }

        router.refresh();
        return;
      }

      const response = await fetch(STATUS_PATH, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: trimmed }),
      });
      const nextStatus = await readJson<AdminModeStatus>(response, defaultStatus);

      if (response.status === 401) {
        setStatus(nextStatus);
        setMessage("管理者モードは有効化できませんでした。コードを確認してください。");
        return;
      }

      setStatus(nextStatus);

      if (nextStatus.enabled) {
        setOpen(false);
        router.refresh();
        return;
      }

      const missingTokenMessage = getMissingTokenMessage(nextStatus);
      if (missingTokenMessage) {
        setMessage(missingTokenMessage);
        return;
      }

      if (!nextStatus.configured) {
        setMessage("コードは保存しました。管理者モード対象ページはこのサイトでは未設定です。");
      }
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
            管理者コードを保存すると、管理者向けページの閲覧とコメント管理に使えます。
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
                  void handleSave();
                }
              }}
            />
          </label>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.action} ${styles.primary}`}
              onClick={() => void handleSave()}
              disabled={pending}
            >
              {pending ? "処理中..." : "保存"}
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                setToken("");
                void handleSave("");
              }}
              disabled={pending}
            >
              解除
            </button>
          </div>
          {status.enabled && status.protectedLinks.length > 0 ? (
            <ul className={styles.links}>
              {status.protectedLinks.map((link) => (
                <li key={link.href} className={styles.linkItem}>
                  <a className={styles.link} href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
