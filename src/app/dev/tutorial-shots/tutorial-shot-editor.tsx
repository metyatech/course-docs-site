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
  TutorialShotItem,
  TutorialShotLabelAnnotation,
  TutorialShotManifest,
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
  configuredSource && configuredSource.trim() ? configuredSource : "（未設定）";

const getAnnotationTypeLabel = (type: TutorialShotAnnotation["type"]) => {
  if (type === "box") {
    return "枠";
  }
  if (type === "arrow") {
    return "矢印";
  }
  return "ラベル";
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
          error instanceof Error
            ? error.message
            : "チュートリアル画像一覧を読み込めませんでした。",
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
      nextImagePath ? buildImageUrl(nextImagePath, sourceImageRevision, sourceOverride ?? "") : null,
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
    setStatusText("画像を保存しています...");

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
      setStatusText(saveData.error ?? "チュートリアル画像を保存できませんでした。");
      setIsSaving(false);
      return;
    }

    setStatusText(
      saveData.warnings?.length
        ? `保存しました（警告 ${saveData.warnings.length} 件）。`
        : "保存しました。",
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
          : reject(new Error("アップロードした画像を読み込めませんでした。"));
      reader.onerror = () => reject(new Error("アップロードした画像を読み込めませんでした。"));
      reader.readAsDataURL(file);
    });

    setPendingRawDataUrl(dataUrl);
    setSourceImageSrc(dataUrl);
    setBootstrapFromOutput(false);
    setStatusText(`元画像を読み込みました: ${file.name}`);
  };

  if (!response) {
    return (
      <main className={styles.page}>
        <div className={styles.empty}>チュートリアル画像エディタを読み込み中です...</div>
      </main>
    );
  }

  if (!response.enabled) {
    return (
      <main className={styles.page}>
        <div className={styles.setupCard}>
          <div className={styles.panelHeader}>
            <h1>チュートリアル画像エディタの設定</h1>
            <p>
              このエディタは、元画像・shot manifest・生成後の Action 画像を教材 repo に書き戻すため、
              書き込み可能なローカル教材 repo が必要です。
            </p>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.warningList}>
              <div className={styles.warningItem}>{response.reason}</div>
            </div>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label htmlFor="configured-source">現在の COURSE_CONTENT_SOURCE</label>
                <input
                  id="configured-source"
                  readOnly
                  value={formatConfiguredSource(response.configuredSource)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="local-source">ローカル教材 repo</label>
                <input
                  id="local-source"
                  onChange={(event) => setSourceInput(event.target.value)}
                  placeholder="../open-campus-unreal-90min"
                  value={sourceInput}
                />
              </div>
            </div>
            {response.suggestedLocalSources.length > 0 ? (
              <div className={styles.suggestedSources}>
                <div className={styles.status}>見つかったローカル repo 候補:</div>
                <div className={styles.badgeRow}>
                  {response.suggestedLocalSources.map((candidate) => (
                    <button
                      className={styles.secondaryButton}
                      key={candidate}
                      onClick={() => setSourceInput(candidate)}
                      type="button"
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className={styles.actions}>
              <button onClick={() => applySourceOverride(sourceInput)} type="button">
                ローカル repo を開く
              </button>
              {response.overrideSource ? (
                <button
                  className={styles.secondaryButton}
                  onClick={() => applySourceOverride("")}
                  type="button"
                >
                  保存した上書きを解除
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <h1>チュートリアル画像エディタ</h1>
        <p>
          既存の <code>Action img=&quot;./img/...png&quot;</code> はそのまま使いながら、
          元画像を <code>raw + 切り抜き + 注釈 -&gt; 生成 png</code> として編集できます。shot
          metadata はページ横の <code>shots/</code> に保存され、既存の出力画像を同じ場所で上書きします。
        </p>
        <div className={styles.sourceBanner}>
          <div className={styles.status}>
            編集対象のローカル repo: <code>{response.activeSourcePath}</code>
            {response.sourceKind === "override" ? "（上書き指定）" : ""}
          </div>
          <div className={styles.actions}>
            <input
              onChange={(event) => setSourceInput(event.target.value)}
              placeholder="../open-campus-unreal-90min"
              value={sourceInput}
            />
            <button onClick={() => applySourceOverride(sourceInput)} type="button">
              ローカル repo を切り替える
            </button>
            {sourceOverride ? (
              <button
                className={styles.secondaryButton}
                onClick={() => applySourceOverride("")}
                type="button"
              >
                COURSE_CONTENT_SOURCE を使う
              </button>
            ) : null}
          </div>
          {response.sourceKind === "override" ? (
            <div className={styles.status}>
              このエディタは上書き指定したローカル repo に保存します。通常の docs ページ側も同じ repo を
              表示したい場合は、<code>COURSE_CONTENT_SOURCE</code> もこのパスにして
              <code>npm run dev</code> を再起動してください。
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h2>Action 画像</h2>
            <p>
              現在のローカル教材 repo から検出した Action 画像です。選んだ shot の元画像、切り抜き、
              注釈を編集できます。
            </p>
          </div>
          <div className={styles.shotList}>
            {shots.map((shot) => (
              <button
                key={shot.outputImagePath}
                className={`${styles.shotButton} ${
                  shot.outputImagePath === selectedKey ? styles.shotButtonActive : ""
                }`}
                onClick={() => setSelectedKey(shot.outputImagePath)}
                type="button"
              >
                <div className={styles.shotTitle}>
                  <span>{shot.id}</span>
                  <span>{shot.line} 行目</span>
                </div>
                <div className={styles.shotMeta}>
                  <div>{shot.pagePath}</div>
                  <div>{shot.outputImagePath}</div>
                </div>
                <div className={styles.badgeRow}>
                  <span className={styles.badge}>
                    {shot.hasOutputImage ? "出力あり" : "出力なし"}
                  </span>
                  <span className={styles.badge}>
                    {shot.hasRawImage ? "元画像あり" : "元画像が必要"}
                  </span>
                  <span className={styles.badge}>
                    {shot.hasManifest ? "manifest あり" : "manifest なし"}
                  </span>
                  {shot.warnings.length > 0 ? (
                    <span className={`${styles.badge} ${styles.badgeWarn}`}>
                      警告 {shot.warnings.length} 件
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className={styles.editor}>
          {!selectedShot || !draftManifest ? (
            <div className={styles.empty}>左の一覧から shot を選ぶと編集を始められます。</div>
          ) : (
            <>
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>ショット情報</h2>
                  <p>
                    出力画像のパスは既存の Action 画像参照と一致したままです。元画像と manifest は
                    ページ横の <code>shots/</code> に保存されます。
                  </p>
                </div>
                <div className={styles.panelBody}>
                  <div className={styles.grid}>
                    <div className={styles.field}>
                      <label htmlFor="shot-id">ショット ID</label>
                      <input id="shot-id" value={draftManifest.id} readOnly />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="shot-alt">Alt テキスト</label>
                      <input
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
                        value={draftManifest.alt}
                      />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="shot-page">ページ</label>
                      <input id="shot-page" value={draftManifest.pagePath} readOnly />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="shot-output">出力画像</label>
                      <input id="shot-output" value={draftManifest.outputImagePath} readOnly />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="shot-raw">元画像</label>
                      <input id="shot-raw" value={draftManifest.rawImagePath} readOnly />
                    </div>
                    <div className={styles.field}>
                      <label>元画像ファイル</label>
                      <div className={styles.actions}>
                        <button
                          className={styles.uploadButton}
                          onClick={() => fileInputRef.current?.click()}
                          type="button"
                        >
                          元画像をアップロード
                        </button>
                        {bootstrapFromOutput ? (
                          <span className={styles.status}>
                            今このまま保存すると、現在の出力画像から元画像を初期作成します。
                          </span>
                        ) : null}
                        <input
                          accept="image/png,image/jpeg,image/webp"
                          className={styles.uploadInput}
                          onChange={(event) => handleRawUpload(event.target.files?.[0] ?? null)}
                          ref={fileInputRef}
                          type="file"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>切り抜き</h2>
                  <p>この Action に必要な範囲だけを先に切り抜いてから注釈を付けます。</p>
                </div>
                <div className={styles.panelBody}>
                  {!sourceImageSrc ? (
                    <div className={styles.empty}>
                      {bootstrapFromOutput
                        ? "元画像をアップロードするか、一度保存して現在の出力画像から元画像を作成してください。"
                        : "この Action 画像を編集するには、まず元画像をアップロードしてください。"}
                    </div>
                  ) : (
                    <div className={styles.previewShell}>
                      <div className={styles.actions}>
                        <button
                          className={styles.secondaryButton}
                          onClick={() => {
                            if (!sourceImageElement) {
                              return;
                            }
                            const image = sourceImageElement;
                            setCrop({
                              unit: "px",
                              x: 0,
                              y: 0,
                              width: image.naturalWidth,
                              height: image.naturalHeight,
                            });
                            setCompletedCrop({
                              unit: "px",
                              x: 0,
                              y: 0,
                              width: image.naturalWidth,
                              height: image.naturalHeight,
                            });
                          }}
                          type="button"
                        >
                          切り抜きをリセット
                        </button>
                        <span className={styles.status}>
                          必要な UI だけが見えるように、切り抜きは狭めに保ってください。
                        </span>
                      </div>
                      <div className={styles.previewCanvas}>
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
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>注釈</h2>
                  <p>画像は WHERE を示す用途に絞り、ラベルは短く保って長い手順文は入れません。</p>
                </div>
                <div className={styles.panelBody}>
                  {!croppedPreviewSrc || !completedCrop ? (
                    <div className={styles.empty}>注釈を始める前に、先に切り抜きを決めてください。</div>
                  ) : (
                    <div className={styles.annotationShell}>
                      <div className={styles.toolbar}>
                        <button onClick={() => addAnnotation("box")} type="button">
                          枠を追加
                        </button>
                        <button onClick={() => addAnnotation("arrow")} type="button">
                          矢印を追加
                        </button>
                        <button onClick={() => addAnnotation("label")} type="button">
                          ラベルを追加
                        </button>
                      </div>
                      <div className={styles.annotationStage}>
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
                      <div className={styles.annotationList}>
                        {draftManifest.annotations.map((annotation) => (
                          <div
                            className={`${styles.annotationItem} ${
                              annotation.id === selectedAnnotationId
                                ? styles.annotationItemSelected
                                : ""
                            }`}
                            key={annotation.id}
                          >
                            <div className={styles.annotationItemHeader}>
                              <button
                                className={styles.secondaryButton}
                                onClick={() => setSelectedAnnotationId(annotation.id)}
                                type="button"
                              >
                                {getAnnotationTypeLabel(annotation.type)}
                              </button>
                              <button
                                className={styles.secondaryButton}
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
                            </div>
                            {annotation.type === "label" ? (
                              <div className={styles.field}>
                                <label htmlFor={`label-${annotation.id}`}>ラベル</label>
                                <input
                                  id={`label-${annotation.id}`}
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
                                  value={annotation.text}
                                />
                              </div>
                            ) : (
                              <div className={styles.status}>
                                位置やサイズは、キャンバス上で直接ドラッグして調整してください。
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>チュートリアルルール確認</h2>
                  <p>警告は参考情報です。画像内の注釈がチュートリアルの書き方から外れていないかを確認します。</p>
                </div>
                <div className={styles.panelBody}>
                  {warnings.length === 0 ? (
                    <div className={styles.empty}>画像に関する警告はありません。</div>
                  ) : (
                    <div className={styles.warningList}>
                      {warnings.map((warning: string) => (
                        <div className={styles.warningItem} key={warning}>
                          {warning}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.actions}>
                <button disabled={isSaving} onClick={save} type="button">
                  {isSaving ? "保存中..." : "保存"}
                </button>
                <span className={styles.status}>{statusText}</span>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
