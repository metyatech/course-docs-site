"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactCrop, { type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  getTutorialShotAnnotationErrors,
  summarizeTutorialShotAnnotations,
  getTutorialShotWarnings,
  normalizeTutorialShotManifest,
} from "../../../lib/tutorial-shots-shared.mjs";
import {
  getStoredTutorialShotCropState,
  getTutorialShotCropStateForImage,
  updateTutorialShotCropStateMap,
} from "../../../lib/tutorial-shot-editor-crop-state.mjs";
import type {
  TutorialShotAnnotation,
  TutorialShotAnnotationMode,
  TutorialShotArrowAnnotation,
  TutorialShotBoxAnnotation,
  TutorialShotManifest,
  TutorialShotItem,
  TutorialShotResponse,
} from "../../../lib/tutorial-shots-types";
import styles from "./tutorial-shot-editor.module.css";

const AnnotationCanvas = dynamic(() => import("./tutorial-shot-editor-canvas"), {
  ssr: false,
});

const SOURCE_OVERRIDE_STORAGE_KEY = "tutorial-shot-editor.sourceOverride";
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

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

const getReadableImageName = (file: File, fallbackFileName: string) => {
  const trimmed = file.name.trim();
  return trimmed || fallbackFileName;
};

const isTextEditableElement = (element: Element | null) => {
  if (!element) {
    return false;
  }

  if (element instanceof HTMLTextAreaElement) {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has(element.type.toLowerCase());
  }

  return (
    element instanceof HTMLElement &&
    (element.isContentEditable || Boolean(element.closest("[contenteditable='true']")))
  );
};

const readImageFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("画像ファイルを読み込めませんでした。"));
    reader.onerror = () => reject(new Error("画像ファイルを読み込めませんでした。"));
    reader.readAsDataURL(file);
  });

const getClipboardImageFile = (clipboardData: DataTransfer | null) => {
  for (const item of Array.from(clipboardData?.items ?? [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) {
      continue;
    }

    const file = item.getAsFile();
    if (file) {
      return file;
    }
  }

  return null;
};

const getAnnotationTypeLabel = (type: TutorialShotAnnotation["type"]) => {
  if (type === "box") {
    return "枠";
  }
  return "矢印";
};

const findPrimaryBox = (annotations: TutorialShotAnnotation[]) =>
  annotations.find(
    (annotation): annotation is TutorialShotBoxAnnotation => annotation.type === "box",
  ) ?? null;

const getShotFlags = (shot: TutorialShotItem) => {
  const flags: Array<{
    className: string;
    label: string;
    title: string;
  }> = [];

  // shotSource badge: always show whether this is an Action or Verify shot.
  if (shot.shotSource === "verify") {
    flags.push({
      className: styles.flagVerify,
      label: "Verify",
      title:
        '<Verify img="..."> コンポーネントの画像です。確認（白い破線）アノテーションのみ使用できます。',
    });
  } else {
    flags.push({
      className: styles.flagAction,
      label: "Action",
      title: '<Action img="..."> コンポーネントの画像です。',
    });
  }

  if (!shot.hasOutputImage) {
    flags.push({
      className: styles.flagMuted,
      label: "画像未設定",
      title: "公開画像がまだありません。元画像をアップロードして保存すると作成されます。",
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

const createDefaultBox = (
  width: number,
  height: number,
  role: TutorialShotBoxAnnotation["role"] = "action",
): TutorialShotBoxAnnotation => ({
  id: crypto.randomUUID(),
  type: "box",
  role,
  x: Math.max(16, Math.round(width * 0.2)),
  y: Math.max(16, Math.round(height * 0.2)),
  width: Math.max(80, Math.round(width * 0.35)),
  height: Math.max(64, Math.round(height * 0.18)),
});

const createArrowForBox = (box: TutorialShotBoxAnnotation): TutorialShotArrowAnnotation => {
  const toX = box.x + Math.round(box.width * 0.2);
  const toY = box.y + Math.round(box.height * 0.2);
  return {
    id: crypto.randomUUID(),
    type: "arrow",
    fromX: Math.max(16, box.x - 56),
    fromY: Math.max(16, box.y - 40),
    toX,
    toY,
  };
};

type TutorialShotEditorStoredCropState = {
  crop: PixelCrop | null;
  completedCrop: PixelCrop | null;
};

type TutorialShotEditorStoredCropStateMap = Record<string, TutorialShotEditorStoredCropState>;

const toNaturalCrop = (renderedCrop: PixelCrop, scale: number): PixelCrop => ({
  unit: "px",
  x: Math.round(renderedCrop.x * scale),
  y: Math.round(renderedCrop.y * scale),
  width: Math.round(renderedCrop.width * scale),
  height: Math.round(renderedCrop.height * scale),
});

const toRenderedCrop = (naturalCrop: PixelCrop, scale: number): PixelCrop => {
  if (scale <= 1) return naturalCrop;
  return {
    unit: "px",
    x: Math.round(naturalCrop.x / scale),
    y: Math.round(naturalCrop.y / scale),
    width: Math.round(naturalCrop.width / scale),
    height: Math.round(naturalCrop.height / scale),
  };
};

export default function TutorialShotEditor() {
  const [response, setResponse] = useState<TutorialShotResponse | null>(null);
  const [sourceOverride, setSourceOverride] = useState<string | null>(null);
  const [sourceInput, setSourceInput] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [draftManifest, setDraftManifest] = useState<TutorialShotManifest | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [crop, setCrop] = useState<PixelCrop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [cropOwnerKey, setCropOwnerKey] = useState<string | null>(null);
  const [, setCropStatesByShot] = useState<TutorialShotEditorStoredCropStateMap>({});
  const cropStatesByShotRef = useRef<TutorialShotEditorStoredCropStateMap>({});
  const [sourceImageSrc, setSourceImageSrc] = useState<string | null>(null);
  const [sourceImageElement, setSourceImageElement] = useState<HTMLImageElement | null>(null);
  const [sourceImageRevision, setSourceImageRevision] = useState(0);
  const [croppedPreviewSrc, setCroppedPreviewSrc] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [pendingRawDataUrl, setPendingRawDataUrl] = useState<string | null>(null);
  const [bootstrapFromOutput, setBootstrapFromOutput] = useState(false);
  const [isSourceEditorOpen, setIsSourceEditorOpen] = useState(false);
  const [cropDetailsOpen, setCropDetailsOpen] = useState(false);
  const [annotationStageWidth, setAnnotationStageWidth] = useState(960);
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cropDisplayScaleRef = useRef(1);
  const [annotationStageElement, setAnnotationStageElement] = useState<HTMLDivElement | null>(null);

  const shots = useMemo(() => (response && response.enabled ? response.shots : []), [response]);
  const selectedShot = useMemo(
    () => shots.find((shot) => shot.outputImagePath === selectedKey) ?? null,
    [selectedKey, shots],
  );
  const warnings = useMemo(
    () =>
      draftManifest
        ? getTutorialShotWarnings(draftManifest, { shotSource: selectedShot?.shotSource })
        : [],
    [draftManifest, selectedShot?.shotSource],
  );
  const annotationSummary = useMemo(
    () => summarizeTutorialShotAnnotations(draftManifest?.annotations ?? []),
    [draftManifest],
  );
  const annotationMode: TutorialShotAnnotationMode = draftManifest?.annotationMode ?? "focal";
  const annotationErrors = useMemo(
    () => getTutorialShotAnnotationErrors(draftManifest?.annotations ?? [], annotationMode),
    [draftManifest, annotationMode],
  );
  const primaryBox = useMemo(
    () => findPrimaryBox(draftManifest?.annotations ?? []),
    [draftManifest],
  );
  const hasAnnotationSurface = Boolean(croppedPreviewSrc) && Boolean(completedCrop);
  const canAddBox =
    hasAnnotationSurface &&
    (annotationMode === "callout" ||
      annotationMode === "multi-focal" ||
      annotationSummary.boxCount === 0);
  const isVerifyShot = selectedShot?.shotSource === "verify";
  const canAddArrow =
    hasAnnotationSurface &&
    !isVerifyShot &&
    annotationMode === "focal" &&
    Boolean(primaryBox) &&
    annotationSummary.arrowCount === 0;
  const saveBlockedByAnnotationErrors = hasAnnotationSurface && annotationErrors.length > 0;
  const annotationPanelTitle =
    annotationMode === "callout"
      ? `番号コールアウト ・ 枠 ${annotationSummary.boxCount} 個`
      : annotationMode === "multi-focal"
        ? `同種複数 ・ 枠 ${annotationSummary.boxCount} 個`
        : `枠 ${annotationSummary.boxCount}/1 ・ 矢印 ${annotationSummary.arrowCount}/1`;
  const annotationPanelHint =
    annotationErrors[0] ??
    (annotationMode === "callout"
      ? annotationSummary.boxCount === 0
        ? "設定項目など複数の場所を示す画像に使います。枠を追加すると自動で番号が付きます。"
        : "保存できます。枠をさらに追加できます。"
      : annotationMode === "multi-focal"
        ? annotationSummary.boxCount === 0
          ? "同じ種類の要素が複数ある画像に使います。枠を追加してください。"
          : "保存できます。枠をさらに追加できます。"
        : annotationSummary.boxCount === 0
          ? "特に示したい場所がなければ、このまま保存できます。"
          : annotationSummary.arrowCount > 0
            ? "保存できます。矢印は不要なら削除できます。"
            : "保存できます。必要なら矢印を追加できます。");

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
      setCropOwnerKey(null);
      setCroppedPreviewSrc(null);
      setSourceImageElement(null);
      setPendingRawDataUrl(null);
      setBootstrapFromOutput(false);
      setCropDetailsOpen(false);
      return;
    }

    const storedCropState = getStoredTutorialShotCropState({
      currentCropStates: cropStatesByShotRef.current,
      shotKey: selectedShot.outputImagePath,
    }) as TutorialShotEditorStoredCropState | null;
    // When loading a Verify shot, automatically fix any legacy role="action" boxes
    // to role="verify". This handles .shot.json files that were created before the
    // Verify-only enforcement was introduced, and prevents a deadlock where the
    // UI shows "確認（白い破線）" (because the toggle is hidden for Verify shots)
    // but the data still has role="action", causing a persistent warning that the
    // user cannot dismiss through the UI.
    const rawManifest = normalizeTutorialShotManifest(
      selectedShot.manifest,
    ) as TutorialShotManifest;
    const initialManifest =
      selectedShot.shotSource === "verify"
        ? {
            ...rawManifest,
            annotations: rawManifest.annotations.map((annotation) =>
              annotation.type === "box" && annotation.role === "action"
                ? { ...annotation, role: "verify" as const }
                : annotation,
            ),
          }
        : rawManifest;
    setDraftManifest(initialManifest);
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
    setCropDetailsOpen(!nextImagePath);
    setSourceImageElement(null);
    setCrop(storedCropState?.crop ?? undefined);
    setCompletedCrop(storedCropState?.completedCrop ?? null);
    setCropOwnerKey(selectedShot.outputImagePath);
    setCroppedPreviewSrc(null);
  }, [selectedShot, sourceImageRevision, sourceOverride]);

  useEffect(() => {
    const activeShotKey = selectedShot?.outputImagePath ?? null;
    if (!activeShotKey || cropOwnerKey !== activeShotKey || (!crop && !completedCrop)) {
      return;
    }

    setCropStatesByShot((current) => {
      const next = updateTutorialShotCropStateMap({
        currentCropStates: current,
        shotKey: activeShotKey,
        crop: crop ?? null,
        completedCrop,
      }) as TutorialShotEditorStoredCropStateMap;
      cropStatesByShotRef.current = next;
      return next;
    });
  }, [completedCrop, crop, cropOwnerKey, selectedShot]);

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

  useEffect(() => {
    if (!annotationStageElement) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = Math.round(entry.contentRect.width);
        if (width > 0) setAnnotationStageWidth(width);
      }
    });
    observer.observe(annotationStageElement);
    return () => observer.disconnect();
  }, [annotationStageElement]);

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

  const switchAnnotationMode = (nextMode: TutorialShotAnnotationMode) => {
    setDraftManifest((current) =>
      current
        ? ({
            ...current,
            annotationMode: nextMode,
          } as TutorialShotManifest)
        : current,
    );
    setSelectedAnnotationId(null);
  };

  const addBox = () => {
    if (!draftManifest || !completedCrop) {
      return;
    }
    if (annotationMode === "focal" && annotationSummary.boxCount > 0) {
      return;
    }

    const next = createDefaultBox(
      completedCrop.width,
      completedCrop.height,
      isVerifyShot ? "verify" : "action",
    );
    updateAnnotations([...draftManifest.annotations, next]);
    setSelectedAnnotationId(next.id);
  };

  const addArrow = () => {
    if (!draftManifest || !primaryBox || annotationSummary.arrowCount > 0) {
      return;
    }

    const next = createArrowForBox(primaryBox);
    updateAnnotations([...draftManifest.annotations, next]);
    setSelectedAnnotationId(next.id);
  };

  const toggleBoxRole = (annotationId: string) => {
    if (!draftManifest) {
      return;
    }
    updateAnnotations(
      draftManifest.annotations.map((annotation) =>
        annotation.id === annotationId && annotation.type === "box"
          ? { ...annotation, role: annotation.role === "verify" ? "action" : "verify" }
          : annotation,
      ),
    );
  };

  const removeAnnotation = (annotationId: string) => {
    if (!draftManifest) {
      return;
    }

    const target = draftManifest.annotations.find((annotation) => annotation.id === annotationId);
    if (!target) {
      return;
    }

    updateAnnotations(
      draftManifest.annotations.filter((annotation) =>
        target.type === "box"
          ? annotation.id !== target.id && annotation.type !== "arrow"
          : annotation.id !== target.id,
      ),
    );
    setSelectedAnnotationId(null);
  };

  const moveAnnotation = (fromIndex: number, toIndex: number) => {
    if (!draftManifest || fromIndex === toIndex) return;
    const next = [...draftManifest.annotations];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    updateAnnotations(next);
  };

  const save = async () => {
    if (!draftManifest) {
      return;
    }
    if (hasAnnotationSurface && annotationErrors.length > 0) {
      setStatusText(annotationErrors[0]);
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
    cropStatesByShotRef.current = {};
    setCropStatesByShot({});
    setCropOwnerKey(null);
    setSourceOverride(trimmed);
    setStatusText("");
    setIsSourceEditorOpen(false);
  };

  const importRawImage = useCallback(
    async ({
      file,
      statusPrefix,
      fallbackFileName,
    }: {
      file: File;
      statusPrefix: string;
      fallbackFileName: string;
    }) => {
      try {
        const dataUrl = await readImageFileAsDataUrl(file);
        setPendingRawDataUrl(dataUrl);
        setSourceImageElement(null);
        setCroppedPreviewSrc(null);
        setSourceImageSrc(dataUrl);
        setBootstrapFromOutput(false);
        setCropDetailsOpen(true);
        setStatusText(
          `${statusPrefix}を読み込みました（${getReadableImageName(file, fallbackFileName)}）`,
        );
      } catch (error) {
        setStatusText(
          error instanceof Error ? error.message : "画像ファイルを読み込めませんでした。",
        );
      }
    },
    [],
  );

  const handleRawUpload = (file: File | null) => {
    if (!file) {
      return;
    }

    void importRawImage({
      file,
      statusPrefix: "新しい元画像",
      fallbackFileName: "image.png",
    });
  };

  useEffect(() => {
    if (!selectedShot) {
      return;
    }

    const handleWindowPaste = (event: ClipboardEvent) => {
      if (isTextEditableElement(document.activeElement)) {
        return;
      }

      const pastedImage = getClipboardImageFile(event.clipboardData);
      if (!pastedImage) {
        return;
      }

      event.preventDefault();
      void importRawImage({
        file: pastedImage,
        statusPrefix: "クリップボードの画像",
        fallbackFileName: "clipboard.png",
      });
    };

    window.addEventListener("paste", handleWindowPaste);
    return () => {
      window.removeEventListener("paste", handleWindowPaste);
    };
  }, [importRawImage, selectedShot]);

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
    setCropOwnerKey(selectedShot?.outputImagePath ?? null);
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
            <p>ローカル教材の画像をまとめて編集できます。</p>
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
              現在の参照先: <code>{formatConfiguredSource(response.configuredSource)}</code>
              {response.overrideSource ? (
                <>
                  {" "}
                  ・{" "}
                  <button
                    className={styles.linkButton}
                    onClick={() => applySourceOverride("")}
                    type="button"
                  >
                    一時切替を解除
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
            {isOverridden ? <span className={styles.sourceTag}>一時切替中</span> : null}
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
                  既定の参照先に戻す
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
                  <h2 className={styles.shotTitle}>
                    {draftManifest.id}
                    <span
                      className={
                        selectedShot.shotSource === "verify"
                          ? styles.shotSourceBadgeVerify
                          : styles.shotSourceBadgeAction
                      }
                      title={
                        selectedShot.shotSource === "verify"
                          ? '<Verify img="..."> の画像 — 確認（白い破線）アノテーションのみ使用できます'
                          : '<Action img="..."> の画像'
                      }
                    >
                      {selectedShot.shotSource === "verify" ? "Verify" : "Action"}
                    </span>
                  </h2>
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
                    disabled={isSaving || saveBlockedByAnnotationErrors}
                    onClick={save}
                    type="button"
                  >
                    {isSaving ? "保存中…" : "保存"}
                  </button>
                </div>
              </header>

              <div className={styles.altCard}>
                <label className={styles.fieldBlock} htmlFor="shot-alt">
                  <span className={styles.fieldLabel}>画像の説明（Alt テキスト）</span>
                  <span className={styles.fieldHint}>画像の内容を短い文で書きます。</span>
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
                <details
                  className={styles.cropDetails}
                  open={cropDetailsOpen || undefined}
                  onToggle={(event) =>
                    setCropDetailsOpen((event.target as HTMLDetailsElement).open)
                  }
                >
                  <summary className={styles.cropSummary}>
                    <span className={styles.cropSummaryTitle}>元画像と切り抜き範囲</span>
                    <span className={styles.cropSummaryHint}>
                      <code>Ctrl + V</code> でも貼り付け可能
                    </span>
                    <span
                      className={styles.cropSummaryTools}
                      onClick={(event) => event.stopPropagation()}
                    >
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
                    </span>
                  </summary>
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    className={styles.fileInputHidden}
                    onChange={(event) => handleRawUpload(event.target.files?.[0] ?? null)}
                    ref={fileInputRef}
                    type="file"
                  />

                  {sourceImageSrc ? (
                    <div className={styles.imageStage} data-testid="crop-stage">
                      <div className={styles.stageSurface}>
                        <ReactCrop
                          crop={
                            crop ? toRenderedCrop(crop, cropDisplayScaleRef.current) : undefined
                          }
                          onChange={(nextCrop) => {
                            if (sourceImageElement) {
                              const cw = sourceImageElement.clientWidth;
                              cropDisplayScaleRef.current =
                                cw > 0 ? sourceImageElement.naturalWidth / cw : 1;
                            }
                            setCrop(toNaturalCrop(nextCrop, cropDisplayScaleRef.current));
                            setCropOwnerKey(selectedShot.outputImagePath);
                          }}
                          onComplete={(nextCrop) => {
                            if (sourceImageElement) {
                              const cw = sourceImageElement.clientWidth;
                              cropDisplayScaleRef.current =
                                cw > 0 ? sourceImageElement.naturalWidth / cw : 1;
                            }
                            setCompletedCrop(toNaturalCrop(nextCrop, cropDisplayScaleRef.current));
                            setCropOwnerKey(selectedShot.outputImagePath);
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt=""
                            className={styles.sourceImage}
                            onLoad={(event) => {
                              const image = event.currentTarget;
                              const cw = image.clientWidth;
                              cropDisplayScaleRef.current = cw > 0 ? image.naturalWidth / cw : 1;
                              const nextCropState = getTutorialShotCropStateForImage({
                                currentCropStates: cropStatesByShotRef.current,
                                shotKey: selectedShot.outputImagePath,
                                manifestCrop: draftManifest.crop,
                                imageWidth: image.naturalWidth,
                                imageHeight: image.naturalHeight,
                              }) as TutorialShotEditorStoredCropState;
                              setSourceImageElement(image);
                              setCropOwnerKey(selectedShot.outputImagePath);
                              setCrop(
                                nextCropState.crop ?? createInitialCrop(image, draftManifest),
                              );
                              setCompletedCrop(nextCropState.completedCrop);
                            }}
                            src={sourceImageSrc}
                          />
                        </ReactCrop>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.stageEmpty}>
                      {bootstrapFromOutput
                        ? "元画像がありません。アップロードするか、このまま保存して現在の出力画像を元画像にします。"
                        : "元画像をアップロードしてください。"}
                    </div>
                  )}
                </details>

                <header className={styles.workCardHeader}>
                  <div>
                    <h3 className={styles.workCardTitle}>必要なら注釈を追加</h3>
                    <p className={styles.workCardHint}>
                      {annotationMode === "callout"
                        ? "設定項目など複数の場所を示す画像用です。各枠に自動で番号が付きます。"
                        : "特に示したい場所がなければ注釈は不要です。注目してほしい場所があるときだけ枠を追加し、必要なら矢印を添えます。"}
                    </p>
                    <div className={styles.modeToggle}>
                      <button
                        className={`${styles.modeButton} ${annotationMode === "focal" ? styles.modeButtonActive : ""}`}
                        onClick={() => switchAnnotationMode("focal")}
                        type="button"
                      >
                        注目点
                      </button>
                      <button
                        className={`${styles.modeButton} ${annotationMode === "multi-focal" ? styles.modeButtonActive : ""}`}
                        onClick={() => switchAnnotationMode("multi-focal")}
                        type="button"
                      >
                        同種複数
                      </button>
                      <button
                        className={`${styles.modeButton} ${annotationMode === "callout" ? styles.modeButtonActive : ""}`}
                        onClick={() => switchAnnotationMode("callout")}
                        type="button"
                      >
                        番号コールアウト
                      </button>
                    </div>
                  </div>
                  <div className={styles.workCardTools}>
                    <button
                      className={styles.toolButton}
                      disabled={!canAddBox}
                      onClick={addBox}
                      type="button"
                    >
                      <span aria-hidden>▭</span> 枠を追加
                    </button>
                    {annotationMode === "focal" ? (
                      <button
                        className={styles.toolButton}
                        disabled={!canAddArrow}
                        onClick={addArrow}
                        type="button"
                      >
                        <span aria-hidden>↗</span> 矢印を追加
                      </button>
                    ) : null}
                  </div>
                </header>

                {!croppedPreviewSrc || !completedCrop ? (
                  <div className={styles.stageEmpty}>
                    切り抜き範囲を決めると、ここに注釈を追加できます。
                  </div>
                ) : (
                  <div className={styles.annotateGrid}>
                    <div
                      className={styles.imageStage}
                      data-testid="annotation-stage"
                      ref={setAnnotationStageElement}
                    >
                      <div className={styles.stageSurface}>
                        <AnnotationCanvas
                          annotationMode={annotationMode}
                          annotations={draftManifest.annotations}
                          imageHeight={completedCrop.height}
                          imageSrc={croppedPreviewSrc}
                          imageWidth={completedCrop.width}
                          maxStageWidth={annotationStageWidth}
                          onChange={updateAnnotations}
                          onSelect={setSelectedAnnotationId}
                          selectedAnnotationId={selectedAnnotationId}
                        />
                      </div>
                    </div>
                    <aside className={styles.annotationPanel}>
                      <div className={styles.annotationPanelTitle}>{annotationPanelTitle}</div>
                      <p className={styles.annotationPanelEmpty}>{annotationPanelHint}</p>
                      {draftManifest.annotations.length === 0 ? (
                        <p className={styles.annotationPanelEmpty}>
                          注釈なしでも保存できます。必要なときだけ枠を追加してください。
                        </p>
                      ) : (
                        <ul className={styles.annotationList}>
                          {draftManifest.annotations.map((annotation, index) => {
                            const isSelected = annotation.id === selectedAnnotationId;
                            const isDraggable = annotationMode === "callout";
                            const boxNumber =
                              annotationMode === "callout" && annotation.type === "box"
                                ? draftManifest.annotations.filter(
                                    (a, i) => a.type === "box" && i <= index,
                                  ).length
                                : 0;
                            return (
                              <li
                                className={`${styles.annotationItem} ${
                                  isSelected ? styles.annotationItemSelected : ""
                                } ${dragSourceIndex === index ? styles.annotationItemDragging : ""} ${
                                  dragOverIndex === index ? styles.annotationItemDragOver : ""
                                }`}
                                data-selected={isSelected ? "true" : "false"}
                                draggable={isDraggable || undefined}
                                key={annotation.id}
                                onDragEnd={() => {
                                  if (
                                    dragSourceIndex !== null &&
                                    dragOverIndex !== null &&
                                    dragSourceIndex !== dragOverIndex
                                  ) {
                                    moveAnnotation(dragSourceIndex, dragOverIndex);
                                  }
                                  setDragSourceIndex(null);
                                  setDragOverIndex(null);
                                }}
                                onDragOver={(event) => {
                                  if (dragSourceIndex === null) return;
                                  event.preventDefault();
                                  setDragOverIndex(index);
                                }}
                                onDragStart={(event) => {
                                  if (!isDraggable) return;
                                  setDragSourceIndex(index);
                                  event.dataTransfer.effectAllowed = "move";
                                }}
                              >
                                {isDraggable ? (
                                  <span className={styles.annotationItemDragHandle} aria-hidden>
                                    ⠿
                                  </span>
                                ) : null}
                                <button
                                  className={styles.annotationItemSelect}
                                  onClick={() => setSelectedAnnotationId(annotation.id)}
                                  type="button"
                                >
                                  <span className={styles.annotationItemKind}>
                                    {boxNumber > 0
                                      ? `${String.fromCodePoint(0x2460 + boxNumber - 1)} 枠 ${boxNumber}`
                                      : `${getAnnotationTypeLabel(annotation.type)} ${index + 1}`}
                                  </span>
                                  {annotation.type === "arrow" ? (
                                    <span className={styles.annotationItemPreview}>矢印</span>
                                  ) : (
                                    <span className={styles.annotationItemPreview}>
                                      画像上でドラッグして調整
                                    </span>
                                  )}
                                </button>
                                {annotation.type === "box" && !isVerifyShot ? (
                                  <button
                                    className={styles.annotationItemRole}
                                    onClick={() => toggleBoxRole(annotation.id)}
                                    type="button"
                                  >
                                    {annotation.role === "verify"
                                      ? "確認（白い破線）"
                                      : "アクション（オレンジ実線）"}
                                  </button>
                                ) : annotation.type === "box" && isVerifyShot ? (
                                  <span className={styles.annotationItemRole}>
                                    確認（白い破線）
                                  </span>
                                ) : null}
                                <button
                                  className={styles.annotationItemDelete}
                                  onClick={() => removeAnnotation(annotation.id)}
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
