'use client';

import { useEffect, useState } from 'react';
import styles from './submissions.module.css';

type AdminFooterToggleProps = {
  onOpen?: () => void;
};

export default function AdminFooterToggle({ onOpen }: AdminFooterToggleProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');

  useEffect(() => {
    const stored = window.sessionStorage.getItem('admin-comment-token');
    if (stored) {
      setToken(stored);
    }
  }, []);

  const handleSave = () => {
    const trimmed = token.trim();
    if (trimmed) {
      window.sessionStorage.setItem('admin-comment-token', trimmed);
    } else {
      window.sessionStorage.removeItem('admin-comment-token');
    }
    window.dispatchEvent(new CustomEvent('admin-token', { detail: { token: trimmed } }));
    setOpen(false);
  };

  return (
    <div className={styles.adminFooter}>
      <button
        type="button"
        className={styles.adminFooterButton}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next && onOpen) {
            onOpen();
          }
        }}
      >
        管理者
      </button>
      {open && (
        <div className={styles.adminFooterPanel}>
          <label className={styles.adminFooterLabel}>
            管理者コード
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className={styles.adminFooterInput}
              placeholder="管理者コードを入力"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleSave();
                }
              }}
            />
          </label>
          <button type="button" className={styles.adminFooterSave} onClick={handleSave}>
            保存
          </button>
        </div>
      )}
    </div>
  );
}
