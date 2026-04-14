"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Konva from "konva";
import {
  Arrow,
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import type {
  TutorialShotAnnotation,
  TutorialShotAnnotationMode,
} from "../../../lib/tutorial-shots-types";

type Props = {
  annotationMode: TutorialShotAnnotationMode;
  annotations: TutorialShotAnnotation[];
  imageHeight: number;
  imageSrc: string;
  imageWidth: number;
  onChange: (annotations: TutorialShotAnnotation[]) => void;
  onSelect: (annotationId: string | null) => void;
  selectedAnnotationId: string | null;
};

const CALLOUT_BADGE_RADIUS = 16;

export default function TutorialShotEditorCanvas({
  annotationMode,
  annotations,
  imageHeight,
  imageSrc,
  imageWidth,
  onChange,
  onSelect,
  selectedAnnotationId,
}: Props) {
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [arrowDragOffsets, setArrowDragOffsets] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const nodeRefs = useRef<Record<string, Konva.Rect | null>>({});
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const scale = useMemo(() => Math.min(1, 960 / Math.max(1, imageWidth)), [imageWidth]);

  useEffect(() => {
    const image = new window.Image();
    image.onload = () => setImageElement(image);
    image.src = imageSrc;
    return () => {
      image.onload = null;
    };
  }, [imageSrc]);

  useEffect(() => {
    if (!selectedAnnotationId || !transformerRef.current) {
      transformerRef.current?.nodes([]);
      transformerRef.current?.getLayer()?.batchDraw();
      return;
    }

    const selectedNode = nodeRefs.current[selectedAnnotationId];
    if (!selectedNode) {
      transformerRef.current.nodes([]);
      transformerRef.current.getLayer()?.batchDraw();
      return;
    }

    transformerRef.current.nodes([selectedNode]);
    transformerRef.current.getLayer()?.batchDraw();
  }, [selectedAnnotationId]);

  const updateAnnotation = (
    annotationId: string,
    updater: (annotation: TutorialShotAnnotation) => TutorialShotAnnotation,
  ) => {
    onChange(
      annotations.map((annotation) =>
        annotation.id === annotationId ? updater(annotation) : annotation,
      ),
    );
  };

  const updateArrowDragOffset = (annotationId: string, x: number, y: number) => {
    setArrowDragOffsets((current) => {
      const existingOffset = current[annotationId];
      if (existingOffset?.x === x && existingOffset?.y === y) {
        return current;
      }
      return {
        ...current,
        [annotationId]: { x, y },
      };
    });
  };

  const clearArrowDragOffset = (annotationId: string) => {
    setArrowDragOffsets((current) => {
      if (!(annotationId in current)) {
        return current;
      }
      const nextOffsets = { ...current };
      delete nextOffsets[annotationId];
      return nextOffsets;
    });
  };

  return (
    <Stage
      height={Math.round(imageHeight * scale)}
      onMouseDown={(event) => {
        const targetClassName = event.target.getClassName();
        if (
          event.target === event.target.getStage() ||
          targetClassName === "Image" ||
          targetClassName === "Layer"
        ) {
          onSelect(null);
        }
      }}
      onTouchStart={(event) => {
        const targetClassName = event.target.getClassName();
        if (
          event.target === event.target.getStage() ||
          targetClassName === "Image" ||
          targetClassName === "Layer"
        ) {
          onSelect(null);
        }
      }}
      scaleX={scale}
      scaleY={scale}
      width={Math.round(imageWidth * scale)}
    >
      <Layer>
        {imageElement ? (
          <KonvaImage
            image={imageElement}
            listening={false}
            x={0}
            y={0}
            width={imageWidth}
            height={imageHeight}
          />
        ) : null}

        {annotations.map((annotation, annotationIndex) => {
          if (annotation.type === "box") {
            const boxNumber =
              annotationMode === "callout"
                ? annotations.filter((a, i) => a.type === "box" && i <= annotationIndex).length
                : 0;
            return (
              <Group
                draggable
                key={annotation.id}
                onDragStart={() => onSelect(annotation.id)}
                onDragEnd={(event) =>
                  updateAnnotation(annotation.id, (current) => ({
                    ...current,
                    x: Math.round(event.target.x()),
                    y: Math.round(event.target.y()),
                  }))
                }
                x={annotation.x}
                y={annotation.y}
              >
                <Rect
                  cornerRadius={10}
                  height={annotation.height}
                  onClick={() => onSelect(annotation.id)}
                  onTap={() => onSelect(annotation.id)}
                  onTransformEnd={(event) => {
                    const node = event.target;
                    const parent = node.getParent();
                    const scaleX = node.scaleX();
                    const scaleY = node.scaleY();
                    const nextX = Math.round((parent?.x() ?? 0) + node.x());
                    const nextY = Math.round((parent?.y() ?? 0) + node.y());
                    node.scaleX(1);
                    node.scaleY(1);
                    node.x(0);
                    node.y(0);
                    updateAnnotation(annotation.id, (current) => ({
                      ...current,
                      x: nextX,
                      y: nextY,
                      width: Math.max(12, Math.round(node.width() * scaleX)),
                      height: Math.max(12, Math.round(node.height() * scaleY)),
                    }));
                  }}
                  ref={(node) => {
                    nodeRefs.current[annotation.id] = node;
                  }}
                  stroke="#ff6b00"
                  strokeWidth={4}
                  width={annotation.width}
                  x={0}
                  y={0}
                />
                {boxNumber > 0 ? (
                  <>
                    <Circle
                      fill="#ff6b00"
                      listening={false}
                      radius={CALLOUT_BADGE_RADIUS}
                      stroke="#ffffff"
                      strokeWidth={2.5}
                      x={0}
                      y={0}
                    />
                    <Text
                      align="center"
                      fill="#ffffff"
                      fontFamily="Arial, sans-serif"
                      fontSize={18}
                      fontStyle="bold"
                      listening={false}
                      text={String(boxNumber)}
                      width={CALLOUT_BADGE_RADIUS * 2}
                      x={-CALLOUT_BADGE_RADIUS}
                      y={-9}
                    />
                  </>
                ) : null}
              </Group>
            );
          }

          if (annotation.type === "arrow") {
            const arrowDragOffset = arrowDragOffsets[annotation.id] ?? { x: 0, y: 0 };
            return (
              <Group key={annotation.id}>
                <Arrow
                  draggable
                  fill="#ff6b00"
                  hitStrokeWidth={20}
                  onClick={() => onSelect(annotation.id)}
                  onDragEnd={(event) => {
                    const offsetX = Math.round(event.target.x());
                    const offsetY = Math.round(event.target.y());
                    event.target.x(0);
                    event.target.y(0);
                    clearArrowDragOffset(annotation.id);
                    updateAnnotation(annotation.id, (current) =>
                      current.type === "arrow"
                        ? {
                            ...current,
                            fromX: current.fromX + offsetX,
                            fromY: current.fromY + offsetY,
                            toX: current.toX + offsetX,
                            toY: current.toY + offsetY,
                          }
                        : current,
                    );
                  }}
                  onDragMove={(event) => {
                    onSelect(annotation.id);
                    updateArrowDragOffset(annotation.id, event.target.x(), event.target.y());
                  }}
                  onDragStart={() => {
                    onSelect(annotation.id);
                    updateArrowDragOffset(annotation.id, 0, 0);
                  }}
                  onTap={() => onSelect(annotation.id)}
                  points={[annotation.fromX, annotation.fromY, annotation.toX, annotation.toY]}
                  pointerLength={16}
                  pointerWidth={16}
                  stroke="#ff6b00"
                  strokeWidth={4}
                  x={arrowDragOffset.x}
                  y={arrowDragOffset.y}
                />
                {selectedAnnotationId === annotation.id ? (
                  <>
                    <Circle
                      draggable
                      fill="#ffffff"
                      onDragMove={(event) =>
                        updateAnnotation(annotation.id, (current) => ({
                          ...current,
                          fromX: Math.round(event.target.x()),
                          fromY: Math.round(event.target.y()),
                        }))
                      }
                      onDragEnd={(event) =>
                        updateAnnotation(annotation.id, (current) => ({
                          ...current,
                          fromX: Math.round(event.target.x()),
                          fromY: Math.round(event.target.y()),
                        }))
                      }
                      radius={8}
                      stroke="#ff6b00"
                      strokeWidth={3}
                      x={annotation.fromX + arrowDragOffset.x}
                      y={annotation.fromY + arrowDragOffset.y}
                    />
                    <Circle
                      draggable
                      fill="#ffffff"
                      onDragMove={(event) =>
                        updateAnnotation(annotation.id, (current) => ({
                          ...current,
                          toX: Math.round(event.target.x()),
                          toY: Math.round(event.target.y()),
                        }))
                      }
                      onDragEnd={(event) =>
                        updateAnnotation(annotation.id, (current) => ({
                          ...current,
                          toX: Math.round(event.target.x()),
                          toY: Math.round(event.target.y()),
                        }))
                      }
                      radius={8}
                      stroke="#ff6b00"
                      strokeWidth={3}
                      x={annotation.toX + arrowDragOffset.x}
                      y={annotation.toY + arrowDragOffset.y}
                    />
                  </>
                ) : null}
              </Group>
            );
          }

          return null;
        })}

        <Transformer
          anchorSize={10}
          borderDash={[8, 6]}
          boundBoxFunc={(oldBox, newBox) =>
            Math.abs(newBox.width) < 12 || Math.abs(newBox.height) < 12 ? oldBox : newBox
          }
          enabledAnchors={[
            "top-left",
            "top-center",
            "top-right",
            "middle-left",
            "middle-right",
            "bottom-left",
            "bottom-center",
            "bottom-right",
          ]}
          flipEnabled={false}
          keepRatio={false}
          ref={transformerRef}
          rotateEnabled={false}
        />
      </Layer>
    </Stage>
  );
}
