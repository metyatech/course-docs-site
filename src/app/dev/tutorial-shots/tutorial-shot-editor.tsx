"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactCrop, { type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  createDefaultTutorialShotManifest,
  getTutorialShotWarnings,
  normalizeTutorialShotManifest,
} from "../../../lib/tutorial-shots-shared.mjs";
import type {
  TutorialShotAnnotation,
  TutorialShotArrowAnnotation,
  TutorialShotBoxAnnotation,
  TutorialShotLabelAnnotation,
  TutorialShotManifest,
  TutorialShotItem,
  TutorialShotResponse,
} from "../../../lib/tutorial-shots-types";
import styles from "./tutorial-shot-editor.module.css";

const AnnotationCanvas = dynamic(() => import("./tutorial-shot-editor-canvas"), {
  ssr: false,
});

const SOURCE_OVERRIDE_STORAGE_KEY = "tutorial-shot-editor.sourceOverride";

const buildTutorialShotsListUrl = (sourceOverride: string) => {
  const params = new URLSearchParams();
  if (sourceOverride) {
    params.set("source", sourceOverride);
  }
  const query = params.toString();
  return query ? `/api/dev/tutorial-shots?${query}` : "/api/dev/tutorial-shots";
};

const buildImageUrl = (contentRelativePath: string, revision: number, sourceOverride: string) => {
  const params = new URLSearchParams({
    path: contentRelativePath,
    v: String(revision),
  });
  if (sourceOverride) {
    params.set("source", sourceOverride);
  }
  return `/api/dev/tutorial-shots/image?${params.toString()}`;
};

const formatConfiguredSource = (configuredSource: string | null) =>
  configuredSource && configuredSource.trim() ? configuredSource : "未設定";

const getAnnotationTypeLabel = (type: TutorialShotAnnotation["type"]) => {
  if (type === "box") {
    return "枠";
  }
  if (type === "arrow") {
    return "矢印";
  }
  return "ラベル";
};

const getShotFlags = (shot: TutorialShotItem) => {
  const flags: Array<{
    className: string;
    label: string;
    title: string;
  }> = [];

  if (!shot.hasOutputImage) {
    flags.push({
      className: styles.flagMuted,
      label: "画像未設定",
      title: "まだこの Action 用の公開画像がありません。",
    });
  }

  if (shot.warnings.length > 0) {
    flags.push({
      className: styles.flagWarn,
      label: `要確認 ${shot.warnings.length}件`,
      title: `確認したいことが ${shot.warnings.length} 件あります。`,
    });
  }

  return flags;
};

const loadImageElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`画像を読み込めませんでした: ${src}`));
    image.src = src;
  });

const createCroppedPreview = async ({
  image,
  crop,
}: {
  image: HTMLImageElement;
  crop: PixelCrop | null;
}) => {
  const canvas = document.createElement("canvas");
  const width = crop?.width ?? image.naturalWidth;
  const height = crop?.height ?? image.naturalHeight;
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("プレビュー用の描画領域を作成できませんでした。");
  }

  context.drawImage(
    image,
    crop?.x ?? 0,
    crop?.y ?? 0,
    crop?.width ?? image.naturalWidth,
    crop?.height ?? image.naturalHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return canvas.toDataURL("image/png");
};

const createInitialCrop = (image: HTMLImageElement, manifest: TutorialShotManifest): PixelCrop =>
  manifest.crop
    ? {
        unit: "px",
        x: manifest.crop.x,
        y: manifest.crop.y,
        width: manifest.crop.width,
        height: manifest.crop.height,
      }
    : {
        unit: "px",
        x: 0,
        y: 0,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };

const createDefaultBox = (width: number, height: number): TutorialShotBoxAnnotation => ({
  id: crypto.randomUUID(),
  type: "box",
  x: Math.max(16, Math.round(width * 0.2)),
  y: Math.max(16, Math.round(height * 0.2)),
  width: Math.max(80, Math.round(width * 0.35)),
  height: Math.max(64, Math.round(height * 0.18)),
});

const createDefaultArrow = (width: number, height: number): TutorialShotArrowAnnotation => ({
  id: crypto.randomUUID(),
  type: "arrow",
  fromX: Math.round(width * 0.18),
  fromY: Math.round(height * 0.2),
  toX: Math.round(width * 0.42),
  toY: Math.round(height * 0.38),
});

const createDefaultLabel = (): TutorialShotLabelAnnotation => ({
  id: crypto.randomUUID(),
  type: "label",
  x: 24,
  y: 48,
  text: "ラベル",
});

export default function TutorialShotEditor() {
  const [response, setResponse] = useState<TutorialShotResponse | null>(null);
  const [sourceOverride, setSourceOverride] = useState<string | null>(null);
  const [sourceInput, setSourceInput] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [draftManifest, setDraftManifest] = useState<TutorialShotManifest | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [crop, setCrop] = useState<PixelCrop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [sourceImageSrc, setSourceImageSrc] = useState<string | null>(null);
  const [sourceImageElement, setSourceImageElement] = useState<HTMLImageElement | null>(null);
  const [sourceImageRevision, setSourceImageRevision] = useState(0);
  const [croppedPreviewSrc, setCroppedPreviewSrc] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingRawDataUrl, setPendingRawDataUrl] = useState<string | null>(null);
  const [bootstrapFromOutput, setBootstrapFromOutput] = useState(false);
  const [isSourceEditorOpen, setIsSourceEditorOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const shots = useMemo(() => (response && response.enabled ? response.shots : []), [response]);
  const selectedShot = useMemo(
    () => shots.find((shot) => shot.outputImagePath === selectedKey) ?? null,
    [selectedKey, shots],
  );
  const warnings = useMemo(
    () => (draftManifest ? getTutorialShotWarnings(draftManifest) : []),
    [draftManifest],
  );

  useEffect(() => {
    const savedOverride = window.localStorage.getItem(SOURCE_OVERRIDE_STORAGE_KEY) ?? "";
    setSourceOverride(savedOverride);
    setSourceInput(savedOverride);
  }, []);

  useEffect(() => {
    if (sourceOverride === null) {
      return;
    }

    const load = async () => {
      const result = await fetch(buildTutorialShotsListUrl(sourceOverride), {
        cache: "no-store",
      });
      const data = (await result.json()) as TutorialShotResponse;
      setResponse(data);
      if (data.enabled && data.shots.length > 0) {
        setSelectedKey((current) =>
          data.shots.some((shot) => shot.outputImagePath === current)
            ? current
            : data.shots[0].outputImagePath,
        );
        return;
      }

      setSelectedKey("");
    };

    load().catch((error) => {
      setResponse({
        enabled: false,
        reason:
          error instanceof Error ? error.message : "編集できる画像の一覧を読み込めませんでした。",
        configuredSource: null,
        suggestedLocalSources: [],
        overrideSource: sourceOverride,
      });
    });
  }, [sourceOverride]);

  useEffect(() => {
    if (response?.enabled || sourceInput || !response?.suggestedLocalSources.length) {
      return;
    }

    setSourceInput(response.suggestedLocalSources[0]);
  }, [response, sourceInput]);

  useEffect(() => {
    if (!selectedShot) {
      setDraftManifest(null);
      setSelectedAnnotationId(null);
      setSourceImageSrc(null);
      setCrop(undefined);
      setCompletedCrop(null);
      setCroppedPreviewSrc(null);
      setSourceImageElement(null);
      setPendingRawDataUrl(null);
      setBootstrapFromOutput(false);
      return;
    }

    setDraftManifest(normalizeTutorialShotManifest(selectedShot.manifest) as TutorialShotManifest);
    setSelectedAnnotationId(null);
    setPendingRawDataUrl(null);
    setBootstrapFromOutput(selectedShot.hasOutputImage && !selectedShot.hasRawImage);
    const nextImagePath = selectedShot.hasRawImage
      ? selectedShot.rawImagePath
      : selectedShot.hasOutputImage
        ? selectedShot.outputImagePath
        : null;
    setSourceImageSrc(
      nextImagePath
        ? buildImageUrl(nextImagePath, sourceImageRevision, sourceOverride ?? "")
        : null,
    );
    setSourceImageElement(null);
    setCrop(undefined);
    setCompletedCrop(null);
    setCroppedPreviewSrc(null);
  }, [selectedShot, sourceImageRevision, sourceOverride]);

  useEffect(() => {
    if (!sourceImageElement) {
      return;
    }

    const sourceImage = sourceImageElement;
    const nextCrop =
      crop ??
      createInitialCrop(
        sourceImage,
        draftManifest ??
          (createDefaultTutorialShotManifest({
            pagePath: selectedShot?.pagePath ?? "",
            outputImagePath: selectedShot?.outputImagePath ?? "",
          }) as TutorialShotManifest),
      );
    setCrop(nextCrop);
    setCompletedCrop({
      x: Math.round(nextCrop.x ?? 0),
      y: Math.round(nextCrop.y ?? 0),
      width: Math.round(nextCrop.width ?? sourceImage.naturalWidth),
      height: Math.round(nextCrop.height ?? sourceImage.naturalHeight),
      unit: "px",
    });
  }, [crop, draftManifest, selectedShot, sourceImageElement]);

  useEffect(() => {
    if (!sourceImageSrc || !completedCrop) {
      return;
    }

    let cancelled = false;
    loadImageElement(sourceImageSrc)
      .then((image) => createCroppedPreview({ image, crop: completedCrop }))
      .then((preview) => {
        if (!cancelled) {
          setCroppedPreviewSrc(preview);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatusText(
            error instanceof Error ? error.message : "プレビューを表示できませんでした。",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [completedCrop, sourceImageSrc]);

  const updateAnnotations = (nextAnnotations: TutorialShotAnnotation[]) => {
    setDraftManifest((current) =>
      current
        ? ({
            ...current,
            annotations: nextAnnotations,
          } as TutorialShotManifest)
        : current,
    );
  };

  const addAnnotation = (kind: "box" | "arrow" | "label") => {
    if (!draftManifest || !completedCrop) {
      return;
    }

    const next =
      kind === "box"
        ? createDefaultBox(completedCrop.width, completedCrop.height)
        : kind === "arrow"
          ? createDefaultArrow(completedCrop.width, completedCrop.height)
          : createDefaultLabel();

    updateAnnotations([...draftManifest.annotations, next]);
    setSelectedAnnotationId(next.id);
  };

  const save = async () => {
    if (!draftManifest) {
      return;
    }

    setIsSaving(true);
    setStatusText("保存しています…");

    const manifestToSave = normalizeTutorialShotManifest({
      ...draftManifest,
      crop: completedCrop
        ? {
            x: completedCrop.x,
            y: completedCrop.y,
            width: completedCrop.width,
            height: completedCrop.height,
          }
        : null,
    }) as TutorialShotManifest;

    const saveResponse = await fetch("/api/dev/tutorial-shots/save", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        manifest: manifestToSave,
        rawImageDataUrl: pendingRawDataUrl,
        bootstrapFromOutput: bootstrapFromOutput && !pendingRawDataUrl,
        source: sourceOverride,
      }),
    });

    const saveData = await saveResponse.json();
    if (!saveResponse.ok) {
      setStatusText(saveData.error ?? "保存できませんでした。");
      setIsSaving(false);
      return;
    }

    setStatusText(
      saveData.warnings?.length
        ? `保存しました（確認したいこと ${saveData.warnings.length} 件）`
        : "保存しました",
    );
    setPendingRawDataUrl(null);
    setSourceImageRevision((value) => value + 1);
    setIsSaving(false);

    const listResponse = await fetch(buildTutorialShotsListUrl(sourceOverride ?? ""), {
      cache: "no-store",
    });
    const listData = (await listResponse.json()) as TutorialShotResponse;
    setResponse(listData);
  };

  const applySourceOverride = (nextSource: string) => {
    const trimmed = nextSource.trim();
    if (trimmed) {
      window.localStorage.setItem(SOURCE_OVERRIDE_STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(SOURCE_OVERRIDE_STORAGE_KEY);
    }
    setSourceInput(trimmed);
    setResponse(null);
    setSelectedKey("");
    setSourceOverride(trimmed);
    setStatusText("");
    setIsSourceEditorOpen(false);
  };

  const handleRawUpload = async (file: File | null) => {
    if (!file) {
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("画像ファイルを読み込めませんでした。"));
      reader.onerror = () => reject(new Error("画像ファイルを読み込めませんでした。"));
      reader.readAsDataURL(file);
    });

    setPendingRawDataUrl(dataUrl);
    setSourceImageSrc(dataUrl);
    setBootstrapFromOutput(false);
    setStatusText(`新しい元画像を読み込みました（${file.name}）`);
  };

  const resetCropToFull = () => {
    if (!sourceImageElement) {
      return;
    }
    const image = sourceImageElement;
    const fullCrop: PixelCrop = {
      unit: "px",
      x: 0,
      y: 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    setCrop(fullCrop);
    setCompletedCrop(fullCrop);
  };

  if (!response) {
    return (
      <main className={styles.page}>
        <div className={styles.loading}>読み込み中です…</div>
      </main>
    );
  }

  if (!response.enabled) {
    return (
      <main className={styles.page}>
        <section className={styles.setupCard}>
          <header className={styles.setupHeader}>
            <h1>編集する教材リポジトリを選んでください</h1>
            <p>
              ローカルにある教材リポジトリのパスを指定すると、その中の画像を 1 枚ずつ編集できます。
            </p>
          </header>

          <div className={styles.setupBody}>
            <label className={styles.fieldBlock} htmlFor="local-source">
              <span className={styles.fieldLabel}>リポジトリのパス</span>
              <span className={styles.fieldHint}>
                例: <code>../open-campus-unreal-90min</code>
              </span>
              <div className={styles.fieldRow}>
                <input
                  className={styles.textInput}
                  id="local-source"
                  onChange={(event) => setSourceInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      applySourceOverride(sourceInput);
                    }
                  }}
                  placeholder="../open-campus-unreal-90min"
                  value={sourceInput}
                />
                <button
                  className={styles.primaryButton}
                  onClick={() => applySourceOverride(sourceInput)}
                  type="button"
                >
                  開く
                </button>
              </div>
            </label>

            {response.suggestedLocalSources.length > 0 ? (
              <div className={styles.suggestList}>
                <div className={styles.suggestLabel}>見つかった候補</div>
                <div className={styles.suggestRow}>
                  {response.suggestedLocalSources.map((candidate) => (
                    <button
                      className={styles.suggestChip}
                      key={candidate}
                      onClick={() => applySourceOverride(candidate)}
                      type="button"
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className={styles.setupReason}>{response.reason}</div>

            <div className={styles.setupFootnote}>
              現在の <code>COURSE_CONTENT_SOURCE</code>:{" "}
              <code>{formatConfiguredSource(response.configuredSource)}</code>
              {response.overrideSource ? (
                <>
                  {" "}
                  ・{" "}
                  <button
                    className={styles.linkButton}
                    onClick={() => applySourceOverride("")}
                    type="button"
                  >
                    保存した上書きを解除
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    );
  }

  const sourceLabel = response.activeSourcePath;
  const isOverridden = response.sourceKind === "override";

  return (
    <main className={styles.page}>
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <h1 className={styles.appTitle}>チュートリアル画像エディタ</h1>
          <div className={styles.sourceLine}>
            <span className={styles.sourceCaption}>編集中:</span>
            <code className={styles.sourcePathInline}>{sourceLabel}</code>
            {isOverridden ? <span className={styles.sourceTag}>上書き指定</span> : null}
            <button
              className={styles.linkButton}
              onClick={() => setIsSourceEditorOpen((value) => !value)}
              type="button"
            >
              {isSourceEditorOpen ? "閉じる" : "別のリポジトリに切り替え"}
            </button>
          </div>
          {isSourceEditorOpen ? (
            <div className={styles.sourceEditor}>
              <input
                className={styles.textInput}
                onChange={(event) => setSourceInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    applySourceOverride(sourceInput);
                  }
                }}
                placeholder="../open-campus-unreal-90min"
                value={sourceInput}
              />
              <button
                className={styles.primaryButton}
                onClick={() => applySourceOverride(sourceInput)}
                type="button"
              >
                切り替える
              </button>
              {sourceOverride ? (
                <button
                  className={styles.ghostButton}
                  onClick={() => applySourceOverride("")}
                  type="button"
                >
                  COURSE_CONTENT_SOURCE に戻す
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="編集する画像の一覧">
          <div className={styles.sidebarHeader}>
            <div className={styles.sidebarTitle}>編集する画像</div>
            <div className={styles.sidebarCount}>{shots.length} 件</div>
          </div>
          <ul className={styles.shotList}>
            {shots.map((shot) => {
              const isActive = shot.outputImagePath === selectedKey;
              const flags = getShotFlags(shot);
              return (
                <li key={shot.outputImagePath}>
                  <button
                    aria-current={isActive ? "true" : undefined}
                    className={`${styles.shotRow} ${isActive ? styles.shotRowActive : ""}`}
                    onClick={() => {
                      setStatusText("");
                      setSelectedKey(shot.outputImagePath);
                    }}
                    type="button"
                  >
                    <div className={styles.shotRowTitle}>{shot.id}</div>
                    <div className={styles.shotRowMeta}>{shot.pagePath}</div>
                    <div className={styles.shotRowFlags}>
                      {flags.map((flag) => (
                        <span
                          className={`${styles.flag} ${flag.className}`}
                          key={`${shot.outputImagePath}:${flag.label}`}
                          title={flag.title}
                        >
                          {flag.label}
                        </span>
                      ))}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className={styles.workspace} aria-label="画像エディタ">
          {!selectedShot || !draftManifest ? (
            <div className={styles.workspaceEmpty}>左の一覧から編集する画像を選んでください。</div>
          ) : (
            <>
              <header className={styles.shotHeader}>
                <div className={styles.shotHeaderMain}>
                  <h2 className={styles.shotTitle}>{draftManifest.id}</h2>
                  <div className={styles.shotSubtitle}>
                    <code>{draftManifest.pagePath}</code>
                    <span className={styles.dot} aria-hidden>
                      ・
                    </span>
                    <span>{selectedShot.line} 行目</span>
                    {warnings.length > 0 ? (
                      <>
                        <span className={styles.dot} aria-hidden>
                          ・
                        </span>
                        <a className={styles.warningLink} href="#warnings">
                          確認したいこと {warnings.length} 件
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className={styles.shotHeaderActions}>
                  {statusText ? (
                    <span className={styles.saveStatus} aria-live="polite" role="status">
                      {statusText}
                    </span>
                  ) : null}
                  <button
                    className={styles.primaryButton}
                    disabled={isSaving}
                    onClick={save}
                    type="button"
                  >
                    {isSaving ? "保存中…" : "保存して反映"}
                  </button>
                </div>
              </header>

              <div className={styles.altCard}>
                <label className={styles.fieldBlock} htmlFor="shot-alt">
                  <span className={styles.fieldLabel}>画像の説明（Alt テキスト）</span>
                  <span className={styles.fieldHint}>
                    画像が表示できないときに読まれる文です。一目で何の画像か分かる短い文にしてください。
                  </span>
                  <input
                    className={styles.textInput}
                    id="shot-alt"
                    onChange={(event) =>
                      setDraftManifest((current) =>
                        current
                          ? ({
                              ...current,
                              alt: event.target.value,
                            } as TutorialShotManifest)
                          : current,
                      )
                    }
                    placeholder="例: Epic Games Launcher の起動画面"
                    value={draftManifest.alt}
                  />
                </label>
              </div>

              <article className={styles.workCard}>
                <header className={styles.workCardHeader}>
                  <div>
                    <h3 className={styles.workCardTitle}>編集元の画像と公開する範囲</h3>
                    <p className={styles.workCardHint}>
                      公開したい範囲をドラッグして囲ってください。狭く切り抜くほど読み手に伝わりやすくなります。
                    </p>
                  </div>
                  <div className={styles.workCardTools}>
                    <button
                      className={styles.ghostButton}
                      onClick={() => fileInputRef.current?.click()}
                      type="button"
                    >
                      {sourceImageSrc ? "元画像を差し替え" : "元画像をアップロード"}
                    </button>
                    {sourceImageSrc ? (
                      <button
                        className={styles.ghostButton}
                        disabled={!sourceImageElement}
                        onClick={resetCropToFull}
                        type="button"
                      >
                        切り抜きをリセット
                      </button>
                    ) : null}
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      className={styles.fileInputHidden}
                      onChange={(event) => handleRawUpload(event.target.files?.[0] ?? null)}
                      ref={fileInputRef}
                      type="file"
                    />
                  </div>
                </header>

                {sourceImageSrc ? (
                  <div className={styles.imageStage}>
                    <ReactCrop
                      crop={crop}
                      onChange={(nextCrop) => setCrop(nextCrop)}
                      onComplete={(nextCrop) => setCompletedCrop(nextCrop)}
                    >
                      {/* ReactCrop requires a plain img element so the crop box matches the source pixels exactly. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt=""
                        className={styles.sourceImage}
                        onLoad={(event) => {
                          setSourceImageElement(event.currentTarget);
                        }}
                        src={sourceImageSrc}
                      />
                    </ReactCrop>
                  </div>
                ) : (
                  <div className={styles.stageEmpty}>
                    {bootstrapFromOutput
                      ? "元画像がまだありません。「元画像をアップロード」で取り込むか、このまま「保存して反映」すれば、現在の出力画像から元画像を作成します。"
                      : "「元画像をアップロード」から、編集したい画像を取り込んでください。"}
                  </div>
                )}
              </article>

              <article className={styles.workCard}>
                <header className={styles.workCardHeader}>
                  <div>
                    <h3 className={styles.workCardTitle}>見せたい場所を示す</h3>
                    <p className={styles.workCardHint}>
                      枠・矢印・短いラベルで「どこを見るか」だけを伝えます。長い手順文は本文に書きます。
                    </p>
                  </div>
                  <div className={styles.workCardTools}>
                    <button
                      className={styles.toolButton}
                      disabled={!croppedPreviewSrc}
                      onClick={() => addAnnotation("box")}
                      type="button"
                    >
                      <span aria-hidden>▭</span> 枠を追加
                    </button>
                    <button
                      className={styles.toolButton}
                      disabled={!croppedPreviewSrc}
                      onClick={() => addAnnotation("arrow")}
                      type="button"
                    >
                      <span aria-hidden>↗</span> 矢印を追加
                    </button>
                    <button
                      className={styles.toolButton}
                      disabled={!croppedPreviewSrc}
                      onClick={() => addAnnotation("label")}
                      type="button"
                    >
                      <span aria-hidden>A</span> ラベルを追加
                    </button>
                  </div>
                </header>

                {!croppedPreviewSrc || !completedCrop ? (
                  <div className={styles.stageEmpty}>
                    まず上の「編集元の画像」で公開する範囲を決めてください。範囲を決めると、ここに注釈用のプレビューが表示されます。
                  </div>
                ) : (
                  <div className={styles.annotateGrid}>
                    <div className={styles.imageStage}>
                      <AnnotationCanvas
                        annotations={draftManifest.annotations}
                        imageHeight={completedCrop.height}
                        imageSrc={croppedPreviewSrc}
                        imageWidth={completedCrop.width}
                        onChange={updateAnnotations}
                        onSelect={setSelectedAnnotationId}
                        selectedAnnotationId={selectedAnnotationId}
                      />
                    </div>
                    <aside className={styles.annotationPanel}>
                      <div className={styles.annotationPanelTitle}>
                        追加した注釈 {draftManifest.annotations.length} 件
                      </div>
                      {draftManifest.annotations.length === 0 ? (
                        <p className={styles.annotationPanelEmpty}>
                          まだ注釈はありません。上のボタンで追加できます。
                        </p>
                      ) : (
                        <ul className={styles.annotationList}>
                          {draftManifest.annotations.map((annotation, index) => {
                            const isSelected = annotation.id === selectedAnnotationId;
                            return (
                              <li
                                className={`${styles.annotationItem} ${
                                  isSelected ? styles.annotationItemSelected : ""
                                }`}
                                key={annotation.id}
                              >
                                <button
                                  className={styles.annotationItemSelect}
                                  onClick={() => setSelectedAnnotationId(annotation.id)}
                                  type="button"
                                >
                                  <span className={styles.annotationItemKind}>
                                    {getAnnotationTypeLabel(annotation.type)} {index + 1}
                                  </span>
                                  {annotation.type === "label" ? (
                                    <span className={styles.annotationItemPreview}>
                                      {annotation.text || "（テキストなし）"}
                                    </span>
                                  ) : (
                                    <span className={styles.annotationItemPreview}>
                                      画像上でドラッグして調整
                                    </span>
                                  )}
                                </button>
                                {annotation.type === "label" ? (
                                  <input
                                    aria-label={`ラベル ${index + 1} のテキスト`}
                                    className={styles.textInput}
                                    onChange={(event) =>
                                      updateAnnotations(
                                        draftManifest.annotations.map((item) =>
                                          item.id === annotation.id
                                            ? ({
                                                ...item,
                                                text: event.target.value,
                                              } as TutorialShotAnnotation)
                                            : item,
                                        ),
                                      )
                                    }
                                    placeholder="ラベルの文字"
                                    value={annotation.text}
                                  />
                                ) : null}
                                <button
                                  className={styles.annotationItemDelete}
                                  onClick={() =>
                                    updateAnnotations(
                                      draftManifest.annotations.filter(
                                        (item) => item.id !== annotation.id,
                                      ),
                                    )
                                  }
                                  type="button"
                                >
                                  削除
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </aside>
                  </div>
                )}
              </article>

              {warnings.length > 0 ? (
                <article className={styles.warningCard} id="warnings">
                  <header className={styles.warningHeader}>
                    確認したいこと <span>{warnings.length} 件</span>
                  </header>
                  <ul className={styles.warningList}>
                    {warnings.map((warning: string) => (
                      <li className={styles.warningItem} key={warning}>
                        {warning}
                      </li>
                    ))}
                  </ul>
                </article>
              ) : null}

              <details className={styles.detailsCard}>
                <summary>保存先のパスを見る</summary>
                <dl className={styles.detailsList}>
                  <div className={styles.detailsRow}>
                    <dt>公開される画像</dt>
                    <dd>
                      <code>{draftManifest.outputImagePath}</code>
                    </dd>
                  </div>
                  <div className={styles.detailsRow}>
                    <dt>編集元の画像</dt>
                    <dd>
                      <code>{draftManifest.rawImagePath}</code>
                    </dd>
                  </div>
                </dl>
              </details>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
