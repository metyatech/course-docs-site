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
  configuredSource && configuredSource.trim() ? configuredSource : "(not set)";

const loadImageElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
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
    throw new Error("Could not create preview canvas context.");
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
  text: "Label",
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
        reason: error instanceof Error ? error.message : "Failed to load tutorial shots.",
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
          setStatusText(error instanceof Error ? error.message : "Failed to render preview.");
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
    setStatusText("Saving tutorial shot...");

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
      setStatusText(saveData.error ?? "Failed to save tutorial shot.");
      setIsSaving(false);
      return;
    }

    setStatusText(
      saveData.warnings?.length
        ? `Saved with ${saveData.warnings.length} tutorial-authoring warning(s).`
        : "Saved tutorial shot.",
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
          : reject(new Error("Failed to read the uploaded image."));
      reader.onerror = () => reject(new Error("Failed to read the uploaded image."));
      reader.readAsDataURL(file);
    });

    setPendingRawDataUrl(dataUrl);
    setSourceImageSrc(dataUrl);
    setBootstrapFromOutput(false);
    setStatusText(`Loaded raw source: ${file.name}`);
  };

  if (!response) {
    return (
      <main className={styles.page}>
        <div className={styles.empty}>Loading tutorial shot editor...</div>
      </main>
    );
  }

  if (!response.enabled) {
    return (
      <main className={styles.page}>
        <div className={styles.setupCard}>
          <div className={styles.panelHeader}>
            <h1>Tutorial Shot Editor Setup</h1>
            <p>
              This editor needs a writable local content repo because it saves raw screenshots,
              shot manifests, and generated Action images back into that repo.
            </p>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.warningList}>
              <div className={styles.warningItem}>{response.reason}</div>
            </div>
            <div className={styles.grid}>
              <div className={styles.field}>
                <label htmlFor="configured-source">Current COURSE_CONTENT_SOURCE</label>
                <input
                  id="configured-source"
                  readOnly
                  value={formatConfiguredSource(response.configuredSource)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="local-source">Local Content Repo</label>
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
                <div className={styles.status}>Detected local repo candidates:</div>
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
                Open Local Repo
              </button>
              {response.overrideSource ? (
                <button
                  className={styles.secondaryButton}
                  onClick={() => applySourceOverride("")}
                  type="button"
                >
                  Clear Saved Override
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
        <h1>Tutorial Shot Editor</h1>
        <p>
          Keep existing <code>Action img=&quot;./img/...png&quot;</code> references, but edit the
          source screenshot as <code>raw + crop + annotations -&gt; generated png</code>. The editor
          stores shot metadata beside the page and rewrites the existing output image in place.
        </p>
        <div className={styles.sourceBanner}>
          <div className={styles.status}>
            Editing local repo: <code>{response.activeSourcePath}</code>
            {response.sourceKind === "override" ? " (override)" : ""}
          </div>
          <div className={styles.actions}>
            <input
              onChange={(event) => setSourceInput(event.target.value)}
              placeholder="../open-campus-unreal-90min"
              value={sourceInput}
            />
            <button onClick={() => applySourceOverride(sourceInput)} type="button">
              Switch Local Repo
            </button>
            {sourceOverride ? (
              <button
                className={styles.secondaryButton}
                onClick={() => applySourceOverride("")}
                type="button"
              >
                Use COURSE_CONTENT_SOURCE
              </button>
            ) : null}
          </div>
          {response.sourceKind === "override" ? (
            <div className={styles.status}>
              The editor is writing to a local override repo. If you want the normal docs pages to
              preview that same repo, also set <code>COURSE_CONTENT_SOURCE</code> to this path and
              restart <code>npm run dev</code>.
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h2>Action Images</h2>
            <p>
              Detected from the current local content repo. Select a shot to edit its raw source,
              crop, and annotations.
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
                  <span>line {shot.line}</span>
                </div>
                <div className={styles.shotMeta}>
                  <div>{shot.pagePath}</div>
                  <div>{shot.outputImagePath}</div>
                </div>
                <div className={styles.badgeRow}>
                  <span className={styles.badge}>
                    {shot.hasOutputImage ? "output" : "missing output"}
                  </span>
                  <span className={styles.badge}>{shot.hasRawImage ? "raw" : "needs raw"}</span>
                  <span className={styles.badge}>
                    {shot.hasManifest ? "manifest" : "no manifest"}
                  </span>
                  {shot.warnings.length > 0 ? (
                    <span className={`${styles.badge} ${styles.badgeWarn}`}>
                      {shot.warnings.length} warning{shot.warnings.length > 1 ? "s" : ""}
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className={styles.editor}>
          {!selectedShot || !draftManifest ? (
            <div className={styles.empty}>Select a shot from the left to start editing.</div>
          ) : (
            <>
              <div className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>Shot Metadata</h2>
                  <p>
                    The output path stays aligned with the existing Action image reference. The raw
                    source and manifest live beside the page inside <code>shots/</code>.
                  </p>
                </div>
                <div className={styles.panelBody}>
                  <div className={styles.grid}>
                    <div className={styles.field}>
                      <label htmlFor="shot-id">Shot ID</label>
                      <input id="shot-id" value={draftManifest.id} readOnly />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="shot-alt">Alt</label>
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
                      <label htmlFor="shot-page">Page</label>
                      <input id="shot-page" value={draftManifest.pagePath} readOnly />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="shot-output">Output Image</label>
                      <input id="shot-output" value={draftManifest.outputImagePath} readOnly />
                    </div>
                    <div className={styles.field}>
                      <label htmlFor="shot-raw">Raw Source</label>
                      <input id="shot-raw" value={draftManifest.rawImagePath} readOnly />
                    </div>
                    <div className={styles.field}>
                      <label>Raw Image</label>
                      <div className={styles.actions}>
                        <button
                          className={styles.uploadButton}
                          onClick={() => fileInputRef.current?.click()}
                          type="button"
                        >
                          Upload Raw Screenshot
                        </button>
                        {bootstrapFromOutput ? (
                          <span className={styles.status}>
                            Saving now will bootstrap the raw source from the current generated
                            image.
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
                  <h2>Crop</h2>
                  <p>
                    Choose the part of the screenshot that belongs to this Action before adding
                    markers.
                  </p>
                </div>
                <div className={styles.panelBody}>
                  {!sourceImageSrc ? (
                    <div className={styles.empty}>
                      {bootstrapFromOutput
                        ? "Upload a raw screenshot or save once to bootstrap from the current output image."
                        : "Upload a raw screenshot to start editing this Action image."}
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
                          Reset Crop
                        </button>
                        <span className={styles.status}>
                          Keep the crop tight. Per tutorial-authoring, every Action should show only
                          the UI needed for the current operation.
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
                  <h2>Annotations</h2>
                  <p>
                    Use screenshots for WHERE. Keep labels short. Do not put full instructions into
                    the image.
                  </p>
                </div>
                <div className={styles.panelBody}>
                  {!croppedPreviewSrc || !completedCrop ? (
                    <div className={styles.empty}>Choose a crop first to start annotating.</div>
                  ) : (
                    <div className={styles.annotationShell}>
                      <div className={styles.toolbar}>
                        <button onClick={() => addAnnotation("box")} type="button">
                          Add Box
                        </button>
                        <button onClick={() => addAnnotation("arrow")} type="button">
                          Add Arrow
                        </button>
                        <button onClick={() => addAnnotation("label")} type="button">
                          Add Label
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
                                {annotation.type}
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
                                Delete
                              </button>
                            </div>
                            {annotation.type === "label" ? (
                              <div className={styles.field}>
                                <label htmlFor={`label-${annotation.id}`}>Label text</label>
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
                                Drag the marker directly on the canvas to reposition or resize it.
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
                  <h2>Tutorial-Authoring Checks</h2>
                  <p>
                    Warnings are advisory. They exist to keep annotated screenshots aligned with the
                    tutorial rules.
                  </p>
                </div>
                <div className={styles.panelBody}>
                  {warnings.length === 0 ? (
                    <div className={styles.empty}>No screenshot warnings.</div>
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
                  {isSaving ? "Saving..." : "Save Shot"}
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
