const normalizePixelCrop = (crop) => {
  if (!crop) {
    return null;
  }

  const x = Math.round(Number(crop.x ?? 0));
  const y = Math.round(Number(crop.y ?? 0));
  const width = Math.round(Number(crop.width));
  const height = Math.round(Number(crop.height));
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  ) {
    return null;
  }

  return {
    unit: "px",
    x: Math.max(0, x),
    y: Math.max(0, y),
    width,
    height,
  };
};

const createFullImageCrop = ({ imageWidth, imageHeight }) => ({
  unit: "px",
  x: 0,
  y: 0,
  width: Math.max(1, Math.round(imageWidth)),
  height: Math.max(1, Math.round(imageHeight)),
});

const clampPixelCropToImage = ({ crop, imageWidth, imageHeight }) => {
  const normalizedCrop = normalizePixelCrop(crop);
  const fullCrop = createFullImageCrop({ imageWidth, imageHeight });
  if (!normalizedCrop) {
    return fullCrop;
  }

  const x = Math.min(Math.max(0, normalizedCrop.x), Math.max(0, fullCrop.width - 1));
  const y = Math.min(Math.max(0, normalizedCrop.y), Math.max(0, fullCrop.height - 1));
  const width = Math.min(Math.max(1, normalizedCrop.width), fullCrop.width - x);
  const height = Math.min(Math.max(1, normalizedCrop.height), fullCrop.height - y);

  return {
    unit: "px",
    x,
    y,
    width,
    height,
  };
};

const arePixelCropsEqual = (left, right) => {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height &&
    left.unit === right.unit
  );
};

const areStoredCropStatesEqual = (left, right) =>
  arePixelCropsEqual(left?.crop ?? null, right?.crop ?? null) &&
  arePixelCropsEqual(left?.completedCrop ?? null, right?.completedCrop ?? null);

export const getStoredTutorialShotCropState = ({ currentCropStates, shotKey }) =>
  shotKey ? (currentCropStates[shotKey] ?? null) : null;

export const updateTutorialShotCropStateMap = ({
  currentCropStates,
  shotKey,
  crop,
  completedCrop,
}) => {
  if (!shotKey) {
    return currentCropStates;
  }

  const nextState = {
    crop: normalizePixelCrop(crop),
    completedCrop: normalizePixelCrop(completedCrop),
  };
  if (!nextState.crop && !nextState.completedCrop) {
    return currentCropStates;
  }

  const currentState = currentCropStates[shotKey] ?? null;
  if (areStoredCropStatesEqual(currentState, nextState)) {
    return currentCropStates;
  }

  return {
    ...currentCropStates,
    [shotKey]: nextState,
  };
};

export const getTutorialShotCropStateForImage = ({
  currentCropStates,
  shotKey,
  manifestCrop,
  imageWidth,
  imageHeight,
}) => {
  const storedCropState = getStoredTutorialShotCropState({ currentCropStates, shotKey });
  const preferredCrop =
    storedCropState?.completedCrop ??
    storedCropState?.crop ??
    (manifestCrop
      ? {
          unit: "px",
          ...manifestCrop,
        }
      : null);
  const normalizedCrop = clampPixelCropToImage({
    crop: preferredCrop,
    imageWidth,
    imageHeight,
  });

  return {
    crop: normalizedCrop,
    completedCrop: normalizedCrop,
  };
};
