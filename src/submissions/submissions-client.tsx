'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './submissions.module.css';
import type { StudentWorksData } from './types.js';
import WorkComments from './work-comments.js';
import { getBrowserSupabaseClient } from './supabase-client.js';
import {
  mapWorkComments,
  mapWorkIntros,
  type WorkCommentMap,
  type WorkIntroMap,
} from './work-data-mappers.js';
import WorkIntroEditor from './work-intro-editor.js';

type SubmissionsClientProps = {
  studentWorks: StudentWorksData;
};

const SYNC_INTERVAL_MS = 15000;

const formatSupabaseError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return '保存に失敗しました。';
  }

  const maybeError = error as {
    message?: string;
    details?: string | null;
    hint?: string | null;
    code?: string | null;
  };
  const parts = [
    maybeError.message,
    maybeError.details,
    maybeError.hint,
    maybeError.code ? `code=${maybeError.code}` : null,
  ].filter((value): value is string => Boolean(value));

  if (parts.length === 0) {
    return '保存に失敗しました。';
  }

  return parts.join(' / ');
};

const buildWorkUrl = (baseUrl: string, workPath: string | null) => {
  if (!workPath) {
    return null;
  }

  if (!baseUrl) {
    return `/student-works/${workPath}`;
  }

  const trimmedBase = baseUrl.replace(/\/+$/, '');
  return `${trimmedBase}/${workPath}`;
};

export default function SubmissionsClient({ studentWorks }: SubmissionsClientProps) {
  const studentWorksData = studentWorks.years;
  const availableYears = useMemo(
    () => Object.keys(studentWorksData).sort().reverse(),
    [studentWorksData],
  );
  const [selectedYear, setSelectedYear] = useState<string>(availableYears[0] ?? '');

  useEffect(() => {
    if (typeof window === 'undefined' || availableYears.length === 0) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const yearFromUrl = params.get('year');

    if (yearFromUrl && studentWorksData[yearFromUrl]) {
      setSelectedYear(yearFromUrl);
    } else {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, studentWorksData]);

  const handleYearChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const year = event.target.value;
    setSelectedYear(year);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('year', year);
      window.history.pushState({}, '', url.toString());
    }
  };

  const studentWorksInYear = useMemo(
    () => (selectedYear ? studentWorksData[selectedYear] || [] : []),
    [selectedYear, studentWorksData],
  );
  const worksBaseUrl =
    process.env.NEXT_PUBLIC_WORKS_BASE_URL ?? 'https://metyatech.github.io/programming-course-docs';
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [introMap, setIntroMap] = useState<WorkIntroMap>({});
  const [commentMap, setCommentMap] = useState<WorkCommentMap>({});
  const [dataError, setDataError] = useState<string | null>(null);
  const supabaseMissing = !supabase;
  const [adminToken, setAdminToken] = useState('');
  const [activeCommentStudentId, setActiveCommentStudentId] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTheme, setDrawerTheme] = useState<'light' | 'dark'>('light');
  const studentIds = useMemo(
    () => studentWorksInYear.map((work) => work.studentId),
    [studentWorksInYear],
  );

  const fetchIntros = useCallback(async () => {
    if (!supabase || !selectedYear || studentIds.length === 0) {
      setIntroMap({});
      return;
    }

    const { data, error } = await supabase
      .from('work_intros')
      .select('student_id,intro,updated_at')
      .eq('year', selectedYear)
      .in('student_id', studentIds);

    if (error) {
      setDataError('紹介文の読み込みに失敗しました。');
      return;
    }

    setIntroMap(mapWorkIntros(data ?? []));
  }, [selectedYear, studentIds, supabase]);

  const fetchComments = useCallback(async () => {
    if (!supabase || !selectedYear || studentIds.length === 0) {
      setCommentMap({});
      return;
    }

    const { data, error } = await supabase
      .from('work_comments')
      .select('id,student_id,author_name,message,created_at')
      .eq('year', selectedYear)
      .in('student_id', studentIds)
      .order('created_at', { ascending: false });

    if (error) {
      setDataError('コメントの読み込みに失敗しました。');
      return;
    }

    setCommentMap(mapWorkComments(data ?? []));
  }, [selectedYear, studentIds, supabase]);

  const refreshAll = useCallback(async () => {
    setDataError(null);
    await Promise.all([fetchIntros(), fetchComments()]);
  }, [fetchComments, fetchIntros]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!supabase || !selectedYear) {
      return;
    }

    const introChannel = supabase
      .channel(`work-intros-${selectedYear}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_intros',
          filter: `year=eq.${selectedYear}`,
        },
        () => {
          fetchIntros();
        },
      )
      .subscribe();

    const commentChannel = supabase
      .channel(`work-comments-${selectedYear}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_comments',
          filter: `year=eq.${selectedYear}`,
        },
        () => {
          fetchComments();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(introChannel);
      supabase.removeChannel(commentChannel);
    };
  }, [fetchComments, fetchIntros, selectedYear, supabase]);

  useEffect(() => {
    if (typeof window === 'undefined' || !selectedYear) {
      return;
    }

    const refresh = () => {
      void refreshAll();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh();
      }
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const intervalId = window.setInterval(refresh, SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [refreshAll, selectedYear]);

  const submitComment = useCallback(
    async (studentId: string, name: string, message: string) => {
      if (!supabase || !selectedYear) {
        throw new Error('Supabase is not configured.');
      }

      const { data, error } = await supabase
        .from('work_comments')
        .insert({
          year: selectedYear,
          student_id: studentId,
          author_name: name.trim() ? name.trim() : null,
          message,
        })
        .select('id,student_id,author_name,message,created_at');

      if (error) {
        throw new Error(formatSupabaseError(error));
      }

      const inserted = data?.[0];
      if (inserted) {
        setCommentMap((prev) => ({
          ...prev,
          [studentId]: [
            {
              id: inserted.id,
              studentId: inserted.student_id,
              authorName: inserted.author_name?.trim() || '匿名',
              message: inserted.message,
              createdAt: inserted.created_at,
            },
            ...(prev[studentId] ?? []),
          ],
        }));
      }
    },
    [selectedYear, supabase],
  );

  const deleteComment = useCallback(
    async (commentId: string, studentId: string) => {
      if (!adminToken.trim()) {
        throw new Error('管理者コードが未設定です。');
      }

      const response = await fetch(`/api/admin/comments/${commentId}`, {
        method: 'DELETE',
        headers: {
          'x-admin-token': adminToken.trim(),
        },
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || '削除に失敗しました。');
      }

      setCommentMap((prev) => ({
        ...prev,
        [studentId]: (prev[studentId] ?? []).filter((comment) => comment.id !== commentId),
      }));
      await fetchComments();
    },
    [adminToken, fetchComments],
  );

  const saveIntro = useCallback(
    async (studentId: string, intro: string | null) => {
      if (!supabase || !selectedYear) {
        throw new Error('Supabase is not configured.');
      }

      const { data, error } = await supabase
        .from('work_intros')
        .upsert({
          year: selectedYear,
          student_id: studentId,
          intro,
          updated_at: new Date().toISOString(),
        })
        .select('student_id,intro,updated_at');

      if (error) {
        throw new Error(formatSupabaseError(error));
      }

      const saved = data?.[0];
      if (saved) {
        setIntroMap((prev) => ({
          ...prev,
          [studentId]: saved.intro ?? undefined,
        }));
      }
    },
    [selectedYear, supabase],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = window.sessionStorage.getItem('admin-comment-token');
    if (stored) {
      setAdminToken(stored);
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { token?: string };
      setAdminToken(detail?.token ?? '');
    };

    window.addEventListener('admin-token', handler);
    return () => {
      window.removeEventListener('admin-token', handler);
    };
  }, []);

  const activeCommentWork = activeCommentStudentId
    ? studentWorksInYear.find((work) => work.studentId === activeCommentStudentId)
    : null;
  const activeComments = activeCommentWork ? (commentMap[activeCommentWork.studentId] ?? []) : [];

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.body.style.overflow = activeCommentWork ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [activeCommentWork]);

  useEffect(() => {
    if (!activeCommentWork) {
      setIsDrawerOpen(false);
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveCommentStudentId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeCommentWork]);

  useEffect(() => {
    if (!activeCommentWork) {
      return;
    }

    setIsDrawerOpen(false);
    const frameId = window.requestAnimationFrame(() => {
      setIsDrawerOpen(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeCommentWork]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const resolveTheme = () => {
      const html = document.documentElement;
      const body = document.body;
      const dataTheme = html.getAttribute('data-theme') ?? body.getAttribute('data-theme');

      if (dataTheme === 'dark' || dataTheme === 'light') {
        return dataTheme;
      }

      if (html.classList.contains('dark') || body.classList.contains('dark')) {
        return 'dark';
      }

      if (html.classList.contains('light') || body.classList.contains('light')) {
        return 'light';
      }

      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const updateTheme = () => {
      setDrawerTheme(resolveTheme());
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => updateTheme();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleMediaChange);
    } else {
      mediaQuery.addListener(handleMediaChange);
    }

    return () => {
      observer.disconnect();
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMediaChange);
      } else {
        mediaQuery.removeListener(handleMediaChange);
      }
    };
  }, []);

  return (
    <main className={styles.submissionsMain}>
      <div className={styles.container}>
        <h1 className={styles.title}>提出作品一覧</h1>

        {availableYears.length === 0 ? (
          <div className={styles.noData}>
            <p>提出作品がまだありません。</p>
          </div>
        ) : (
          <>
            <div className={styles.controls}>
              <label htmlFor="year-select" className={styles.label}>
                年度:
              </label>
              <select
                id="year-select"
                value={selectedYear}
                onChange={handleYearChange}
                className={styles.select}
              >
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}年度
                  </option>
                ))}
              </select>
              <span className={styles.count}>({studentWorksInYear.length}件の提出)</span>
            </div>

            {studentWorksInYear.length === 0 ? (
              <div className={styles.noData}>
                <p>{selectedYear}年度の提出作品がありません。</p>
              </div>
            ) : (
              <div className={styles.grid}>
                {studentWorksInYear.map((work) => {
                  const workUrl = buildWorkUrl(worksBaseUrl, work.workPath);
                  const intro = introMap[work.studentId];
                  const comments = commentMap[work.studentId] ?? [];

                  return (
                    <div
                      key={work.studentId}
                      className={styles.card}
                      data-testid={`work-card-${work.studentId}`}
                    >
                      <div className={styles.cardHeader}>
                        <h3 className={styles.studentId}>{work.studentId}</h3>
                      </div>
                      <div
                        className={`${styles.iframeWrapper} ${
                          workUrl ? '' : styles.iframeWrapperDisabled
                        }`}
                        onClick={workUrl ? () => window.open(workUrl, '_blank') : undefined}
                        style={{ cursor: workUrl ? 'pointer' : 'default' }}
                        title={
                          workUrl ? 'クリックして新しいタブで開く' : 'index.html が見つかりません'
                        }
                        data-testid={`work-preview-${work.studentId}`}
                      >
                        {workUrl ? (
                          <iframe
                            src={workUrl}
                            className={styles.iframe}
                            title={`${work.studentId}の提出作品`}
                            loading="lazy"
                            sandbox="allow-scripts allow-same-origin"
                          />
                        ) : (
                          <div className={styles.iframePlaceholder}>
                            <p>index.html が見つかりません。</p>
                            <p>フォルダ内に配置してください。</p>
                          </div>
                        )}
                      </div>
                      <div className={styles.cardBody}>
                        <section className={styles.introSection}>
                          <h4 className={styles.sectionTitle}>作者からの紹介</h4>
                          <div className={styles.contentBlock}>
                            {supabaseMissing ? (
                              <p className={styles.placeholder}>
                                Supabaseのanon keyが未設定のため表示できません。
                              </p>
                            ) : intro ? (
                              <p className={styles.introText} data-testid="work-intro-text">
                                {intro}
                              </p>
                            ) : (
                              <p className={styles.placeholder} data-testid="work-intro-empty">
                                作者からの紹介文はまだありません。
                              </p>
                            )}
                          </div>
                          <WorkIntroEditor
                            intro={intro}
                            isDisabled={supabaseMissing}
                            onSave={(nextIntro) => saveIntro(work.studentId, nextIntro)}
                          />
                        </section>
                        <div className={styles.commentEntry}>
                          <button
                            type="button"
                            className={styles.commentToggleButton}
                            onClick={() => setActiveCommentStudentId(work.studentId)}
                            data-testid="comment-open"
                          >
                            コメントを見る ({comments.length})
                          </button>
                        </div>
                        {dataError && <p className={styles.dataError}>{dataError}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {activeCommentWork && isMounted
        ? createPortal(
            <div
              className={`${styles.commentDrawerRoot} ${
                isDrawerOpen ? styles.commentDrawerOpen : ''
              }`}
              data-theme={drawerTheme}
              data-testid="comment-drawer"
            >
              <button
                type="button"
                className={styles.commentDrawerOverlay}
                aria-label="コメントパネルを閉じる"
                onClick={() => setActiveCommentStudentId(null)}
              />
              <aside
                className={styles.commentDrawer}
                role="dialog"
                aria-modal="true"
                aria-label="コメント"
                data-testid="comment-panel"
              >
                <div className={styles.commentDrawerHeader}>
                  <div>
                    <p className={styles.commentDrawerTitle}>コメント</p>
                    <p className={styles.commentDrawerMeta}>
                      作品番号: {activeCommentWork.studentId}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={styles.commentDrawerClose}
                    onClick={() => setActiveCommentStudentId(null)}
                    data-testid="comment-close"
                  >
                    閉じる
                  </button>
                </div>
                <WorkComments
                  comments={activeComments}
                  isDisabled={supabaseMissing}
                  isAdmin={adminToken.trim().length > 0}
                  onSubmit={(name, message) =>
                    submitComment(activeCommentWork.studentId, name, message)
                  }
                  onDelete={deleteComment}
                />
              </aside>
            </div>,
            document.body,
          )
        : null}
    </main>
  );
}
