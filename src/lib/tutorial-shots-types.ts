export type TutorialShotBoxRole = "action" | "verify";

export type TutorialShotBoxAnnotation = {
  id: string;
  type: "box";
  role: TutorialShotBoxRole;
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

export type TutorialShotAnnotationMode = "focal" | "multi-focal" | "callout";

export type TutorialShotAnnotation = TutorialShotBoxAnnotation | TutorialShotArrowAnnotation;

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
  annotationMode: TutorialShotAnnotationMode;
  alt: string;
  updatedAt?: string;
};

/** Which MDX component this shot image is referenced from. */
export type TutorialShotSource = "action" | "verify";

export type TutorialShotSourceRef = {
  pagePath: string;
  tagName: "Action" | "Verify";
  tagStart: number;
  tagEnd: number;
  imgValueStart: number;
  imgValueEnd: number;
  expectedImg: string;
  pageRevision: string;
  referenceKey: string;
};

export type TutorialShotItem = TutorialShotSourceRef & {
  id: string;
  line: number;
  sourceImagePath: string;
  referencedImagePath: string;
  outputImagePath: string;
  manifestPath: string;
  rawImagePath: string;
  bootstrapImagePath: string | null;
  /** Whether this shot is referenced by <Action img="..."> or <Verify img="...">. */
  shotSource: TutorialShotSource;
  manifest: TutorialShotManifest;
  warnings: string[];
  hasManifest: boolean;
  hasRawImage: boolean;
  hasOutputImage: boolean;
};

export type TutorialShotResponse =
  | {
      enabled: true;
      activeSourcePath: string;
      sourceKind: "env" | "override";
      configuredSource: string | null;
      suggestedLocalSources: string[];
      shots: TutorialShotItem[];
    }
  | {
      enabled: false;
      reason: string;
      configuredSource: string | null;
      suggestedLocalSources: string[];
      overrideSource: string | null;
    };
