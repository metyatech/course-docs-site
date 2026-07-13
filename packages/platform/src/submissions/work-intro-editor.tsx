'use client';

import { useEffect, useState } from 'react';
import styles from './submissions.module.css';
import { normalizeIntroInput } from './intro-utils.js';

type WorkIntroEditorProps = {
  intro: string | undefined;
  isDisabled: boolean;
  onSave: (intro: string | null) => Promise<void>;
};

const MAX_INTRO_LENGTH = 400;

export default function WorkIntroEditor({ intro, isDisabled, onSave }: WorkIntroEditorProps) {
  const [draft, setDraft] = useState(intro ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDraft(intro ?? '');
  }, [intro]);

  useEffect(() => {
    if (!isOpen) {
      setFormSuccess(null);
      setFormError(null);
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (isDisabled || isSaving) {
      return;
    }

    setIsSaving(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      await onSave(normalizeIntroInput(draft));
      setFormSuccess('保存しました。');
      setFormError(null);
      setIsOpen(false);
    } catch (error) {
      if (error instanceof Error) {
        setFormError(error.message);
      } else {
        setFormError('紹介文の保存に失敗しました。');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={styles.introEditor}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionHeaderSpacer} />
        <div className={styles.actionRow}>
          {!isOpen ? (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => setIsOpen(true)}
              disabled={isDisabled}
              data-testid="work-intro-open"
            >
              編集
            </button>
          ) : (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => setIsOpen(false)}
              disabled={isSaving}
            >
              閉じる
            </button>
          )}
        </div>
      </div>

      {isOpen ? (
        <div className={styles.editorPanel}>
          <label className={styles.commentLabel}>
            紹介文を編集
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, MAX_INTRO_LENGTH))}
              className={styles.commentTextarea}
              placeholder="作品の説明や頑張ったところを書いてください"
              maxLength={MAX_INTRO_LENGTH}
              disabled={isDisabled || isSaving}
              data-testid="work-intro-input"
            />
          </label>
          {formError && <p className={styles.formError}>{formError}</p>}
          {formSuccess && <p className={styles.formSuccess}>{formSuccess}</p>}
          {isDisabled && (
            <p className={styles.formError}>紹介文の編集機能がまだ設定されていません。</p>
          )}
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={styles.commentButton}
              onClick={handleSave}
              disabled={isDisabled || isSaving}
              data-testid="work-intro-save"
            >
              {isSaving ? '保存中...' : '紹介文を保存'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
