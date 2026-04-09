export type TutorialShotBoxAnnotation = {
  id: string;
  type: "box";
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TutorialShotArrowAnnotation = {
  id: string;
  type: "arrow";
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

export type TutorialShotLabelAnnotation = {
  id: string;
  type: "label";
  x: number;
  y: number;
  text: string;
};

export type TutorialShotAnnotation =
  | TutorialShotBoxAnnotation
  | TutorialShotArrowAnnotation
  | TutorialShotLabelAnnotation;

export type TutorialShotCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TutorialShotManifest = {
  version: number;
  id: string;
  pagePath: string;
  outputImagePath: string;
  rawImagePath: string;
  crop: TutorialShotCrop | null;
  annotations: TutorialShotAnnotation[];
  alt: string;
  updatedAt?: string;
};

export type TutorialShotItem = {
  id: string;
  line: number;
  pagePath: string;
  sourceImagePath: string;
  outputImagePath: string;
  manifestPath: string;
  rawImagePath: string;
  manifest: TutorialShotManifest;
  warnings: string[];
  hasManifest: boolean;
  hasRawImage: boolean;
  hasOutputImage: boolean;
};

export type TutorialShotResponse =
  | {
      enabled: true;
      shots: TutorialShotItem[];
    }
  | {
      enabled: false;
      reason: string;
    };
