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
import type { TutorialShotAnnotation } from "../../../lib/tutorial-shots-types";

type Props = {
  annotations: TutorialShotAnnotation[];
  imageHeight: number;
  imageSrc: string;
  imageWidth: number;
  onChange: (annotations: TutorialShotAnnotation[]) => void;
  onSelect: (annotationId: string | null) => void;
  selectedAnnotationId: string | null;
};

const estimateLabelWidth = (text: string) => Math.max(44, 16 * 0.64 * text.length + 20);

export default function TutorialShotEditorCanvas({
  annotations,
  imageHeight,
  imageSrc,
  imageWidth,
  onChange,
  onSelect,
  selectedAnnotationId,
}: Props) {
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
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
  }, [selectedAnnotationId, annotations]);

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

  return (
    <Stage
      height={Math.round(imageHeight * scale)}
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

        {annotations.map((annotation) => {
          if (annotation.type === "box") {
            return (
              <Rect
                draggable
                height={annotation.height}
                key={annotation.id}
                onClick={() => onSelect(annotation.id)}
                onDragEnd={(event) =>
                  updateAnnotation(annotation.id, (current) => ({
                    ...current,
                    x: Math.round(event.target.x()),
                    y: Math.round(event.target.y()),
                  }))
                }
                onTap={() => onSelect(annotation.id)}
                onTransformEnd={(event) => {
                  const node = event.target;
                  const scaleX = node.scaleX();
                  const scaleY = node.scaleY();
                  node.scaleX(1);
                  node.scaleY(1);
                  updateAnnotation(annotation.id, (current) => ({
                    ...current,
                    x: Math.round(node.x()),
                    y: Math.round(node.y()),
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
                x={annotation.x}
                y={annotation.y}
              />
            );
          }

          if (annotation.type === "arrow") {
            return (
              <Group key={annotation.id}>
                <Arrow
                  fill="#ff6b00"
                  onClick={() => onSelect(annotation.id)}
                  onTap={() => onSelect(annotation.id)}
                  points={[annotation.fromX, annotation.fromY, annotation.toX, annotation.toY]}
                  pointerLength={16}
                  pointerWidth={16}
                  stroke="#ff6b00"
                  strokeWidth={4}
                />
                {selectedAnnotationId === annotation.id ? (
                  <>
                    <Circle
                      draggable
                      fill="#ffffff"
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
                      x={annotation.fromX}
                      y={annotation.fromY}
                    />
                    <Circle
                      draggable
                      fill="#ffffff"
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
                      x={annotation.toX}
                      y={annotation.toY}
                    />
                  </>
                ) : null}
              </Group>
            );
          }

          const labelWidth = estimateLabelWidth(annotation.text);
          return (
            <Group
              draggable
              key={annotation.id}
              onClick={() => onSelect(annotation.id)}
              onDragEnd={(event) =>
                updateAnnotation(annotation.id, (current) => ({
                  ...current,
                  x: Math.round(event.target.x()),
                  y: Math.round(event.target.y() + 32),
                }))
              }
              onTap={() => onSelect(annotation.id)}
              x={annotation.x}
              y={annotation.y - 32}
            >
              <Rect fill="#111827" cornerRadius={8} height={32} width={labelWidth} />
              <Text
                fill="#ffffff"
                fontFamily="Arial, sans-serif"
                fontSize={16}
                fontStyle="bold"
                padding={10}
                text={annotation.text}
                y={6}
              />
              {selectedAnnotationId === annotation.id ? (
                <Rect
                  dash={[8, 6]}
                  height={32}
                  listening={false}
                  stroke="#ff6b00"
                  strokeWidth={2}
                  width={labelWidth}
                />
              ) : null}
            </Group>
          );
        })}

        <Transformer
          anchorSize={10}
          borderDash={[8, 6]}
          enabledAnchors={["top-left", "top-right", "bottom-left", "bottom-right"]}
          ref={transformerRef}
          rotateEnabled={false}
        />
      </Layer>
    </Stage>
  );
}
