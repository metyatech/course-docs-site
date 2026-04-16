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

export type TutorialShotAnnotationMode = "focal" | "callout";

export type TutorialShotAnnotation =
  | TutorialShotBoxAnnotation
  | TutorialShotArrowAnnotation;

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

export type TutorialShotItem = {
  id: string;
  line: number;
  pagePath: string;
  sourceImagePath: string;
  outputImagePath: string;
  manifestPath: string;
  rawImagePath: string;
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
