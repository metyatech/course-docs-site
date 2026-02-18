'use client';

import { ShowMore } from '@re-dev/react-truncate';
import { Info, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import styles from './submissions.module.css';
import type { WorkComment } from './work-data-mappers.js';

type WorkCommentsProps = {
  comments: WorkComment[];
  isDisabled: boolean;
  isAdmin: boolean;
  onSubmit: (name: string, message: string) => Promise<void>;
  onDelete: (commentId: string, studentId: string) => Promise<void>;
};

const MAX_COMMENT_LENGTH = 200;
const MAX_NAME_LENGTH = 40;
const NAME_STORAGE_KEY = 'work-comment-display-name';
const NAME_EVENT = 'work-comment-display-name';

export default function WorkComments({
  comments,
  isDisabled,
  isAdmin,
  onSubmit,
  onDelete,
}: WorkCommentsProps) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = window.localStorage.getItem(NAME_STORAGE_KEY);
    if (stored) {
      setName(stored.slice(0, MAX_NAME_LENGTH));
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== NAME_STORAGE_KEY) {
        return;
      }
      setName((event.newValue ?? '').slice(0, MAX_NAME_LENGTH));
    };

    const handleNameEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail as { name?: string };
      if (typeof detail?.name !== 'string') {
        return;
      }
      setName(detail.name.slice(0, MAX_NAME_LENGTH));
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(NAME_EVENT, handleNameEvent);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(NAME_EVENT, handleNameEvent);
    };
  }, []);

  const handleNameChange = (nextName: string) => {
    setName(nextName);
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(NAME_STORAGE_KEY, nextName);
    window.dispatchEvent(new CustomEvent(NAME_EVENT, { detail: { name: nextName } }));
  };

  const handleDelete = async (commentId: string, studentId: string) => {
    if (!isAdmin) {
      return;
    }

    try {
      await onDelete(commentId, studentId);
    } catch (error) {
      if (error instanceof Error) {
        setFormError(error.message);
      } else {
        setFormError('削除に失敗しました。');
      }
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isDisabled || isSubmitting) {
      return;
    }

    const trimmedMessage = message.trim();
    const trimmedName = name.trim();

    if (!trimmedMessage) {
      setFormError('コメントを入力してください。');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(trimmedName, trimmedMessage);
      setMessage('');
      setFormError(null);
    } catch (error) {
      if (error instanceof Error) {
        setFormError(error.message);
      } else {
        setFormError('コメントの送信に失敗しました。');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={styles.commentsSection}>
      <div className={styles.commentComposer}>
        <form className={styles.commentComposerForm} onSubmit={handleSubmit}>
          <div className={styles.commentComposerHeader}>
            <div className={styles.commentAvatar} aria-hidden="true" />
            <label className={styles.commentNameLabel}>
              表示名
              <input
                type="text"
                value={name}
                onChange={(event) => handleNameChange(event.target.value.slice(0, MAX_NAME_LENGTH))}
                className={styles.commentNameInput}
                placeholder="例: たろう"
                maxLength={MAX_NAME_LENGTH}
                disabled={isDisabled || isSubmitting}
                data-testid="comment-name"
              />
            </label>
          </div>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, MAX_COMMENT_LENGTH))}
            className={styles.commentTextarea}
            placeholder="良かったところや感想を書いてください"
            maxLength={MAX_COMMENT_LENGTH}
            required
            disabled={isDisabled || isSubmitting}
            data-testid="comment-message"
          />
          {formError && <p className={styles.formError}>{formError}</p>}
          {isDisabled && <p className={styles.formError}>コメント機能がまだ設定されていません。</p>}
          <div className={styles.commentComposerActions}>
            <span className={styles.commentCounter}>{MAX_COMMENT_LENGTH - message.length}</span>
            <button
              type="submit"
              className={styles.commentButton}
              data-testid="comment-submit"
              disabled={isDisabled || isSubmitting}
            >
              {isSubmitting ? '送信中...' : '投稿'}
            </button>
          </div>
        </form>
      </div>

      <div className={styles.contentBlock}>
        {comments.length === 0 ? (
          <p className={styles.placeholder}>コメントはまだありません。</p>
        ) : (
          <ul className={styles.commentList} data-testid="comment-list">
            {comments.map((comment) => {
              const shouldClamp =
                comment.message.length > 160 || comment.message.split('\n').length > 3;
              const isExpanded = expandedComments[comment.id] ?? false;

              return (
                <li key={comment.id} className={styles.commentItem}>
                  <div className={styles.commentBody} data-testid="comment-body">
                    <ShowMore
                      lines={shouldClamp ? 6 : 0}
                      more="続きを読む"
                      less="折りたたむ"
                      anchorClass={styles.commentExpandLink}
                      expanded={isExpanded}
                      onToggle={(nextExpanded) =>
                        setExpandedComments((prev) => ({
                          ...prev,
                          [comment.id]: nextExpanded,
                        }))
                      }
                    >
                      {comment.message}
                    </ShowMore>
                  </div>
                  <div className={styles.commentControls}>
                    <button
                      type="button"
                      className={styles.commentAuthorToggle}
                      aria-label="表示名を表示"
                      data-testid="comment-author-toggle"
                    >
                      <span className={styles.visuallyHidden}>表示名</span>
                      <Info className={styles.commentAuthorIcon} aria-hidden="true" />
                    </button>
                    {isAdmin ? (
                      <button
                        type="button"
                        className={styles.commentDeleteButton}
                        onClick={() => handleDelete(comment.id, comment.studentId)}
                        aria-label="コメントを削除"
                        data-testid="comment-delete"
                      >
                        <span className={styles.visuallyHidden}>削除</span>
                        <Trash2 className={styles.commentDeleteIcon} aria-hidden="true" />
                      </button>
                    ) : null}
                    <span className={styles.commentAuthorName} data-testid="comment-author">
                      {comment.authorName}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
