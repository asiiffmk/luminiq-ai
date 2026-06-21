const FACE_MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

type FaceApi = typeof import("@vladmandic/face-api");
type Mobilenet = typeof import("@tensorflow-models/mobilenet");

let faceapi: FaceApi | null = null;
let mobilenetMod: Mobilenet | null = null;
let mobilenetModel: Awaited<ReturnType<Mobilenet["load"]>> | null = null;
let modelsReady: Promise<void> | null = null;

export async function loadModels(onProgress?: (msg: string) => void) {
  if (modelsReady) return modelsReady;
  modelsReady = (async () => {
    onProgress?.("Loading TensorFlow…");
    await import("@tensorflow/tfjs");
    onProgress?.("Loading face detection models…");
    faceapi = await import("@vladmandic/face-api");
    await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL);
    onProgress?.("Loading scene model…");
    mobilenetMod = await import("@tensorflow-models/mobilenet");
    mobilenetModel = await mobilenetMod.load({ version: 2, alpha: 0.5 });
    onProgress?.("Models ready");
  })();
  return modelsReady;
}

const OUTDOOR_KEYWORDS = [
  "sky", "tree", "mountain", "beach", "seashore", "valley", "cliff", "lake",
  "river", "grass", "park", "garden", "field", "meadow", "forest", "outdoor",
  "lawn", "snow", "sand", "sunset", "sunrise", "boat", "car", "street",
  "alp", "lakeside", "promontory", "volcano", "geyser", "fountain", "dome",
  "palace", "monastery", "church", "stadium", "racket", "horse", "cow",
  "sheep", "cattle", "bird", "umbrella", "kite", "balloon", "bicycle",
  "motorcycle", "bridge", "boathouse", "castle", "lighthouse", "barn",
];

const INDOOR_KEYWORDS = [
  "indoor", "altar", "candle", "wine", "dining table", "chair", "sofa",
  "bed", "lamp", "curtain", "carpet", "wall", "ceiling", "bookcase",
  "library", "restaurant", "ballroom", "hall", "studio", "lobby", "kitchen",
  "vault", "stage", "microphone", "wineglass", "cup", "vase", "plate",
  "tablecloth", "chandelier",
];

export type PhotoCategory =
  | "blurry"
  | "tilted"
  | "outdoor"
  | "indoor"
  | "selected_person"
  | "keepers";

export interface AnalysisResult {
  blurScore: number;
  isBlurry: boolean;
  tiltAngle: number | null;
  isTilted: boolean;
  scene: "outdoor" | "indoor" | "unknown";
  topLabel: string;
  matchedPerson: boolean;
  matchDistance: number | null;
  categories: PhotoCategory[];
}

const BLUR_THRESHOLD = 80; // laplacian variance below this = blurry
const TILT_THRESHOLD_DEG = 12;
const MATCH_DISTANCE = 0.55;
const MAX_DIM = 640;

export async function fileToImage(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Revoke later — caller may still use the image. We revoke after analysis via cleanup.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function drawToCanvas(img: HTMLImageElement, maxDim = MAX_DIM) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

// Variance of Laplacian on grayscale — classic out-of-focus / motion blur metric.
function laplacianVariance(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        -gray[i - w] - gray[i - 1] + 4 * gray[i] - gray[i + 1] - gray[i + w];
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

function classifyScene(predictions: { className: string; probability: number }[]) {
  let outdoorScore = 0;
  let indoorScore = 0;
  let topLabel = predictions[0]?.className.split(",")[0] ?? "";
  for (const p of predictions) {
    const label = p.className.toLowerCase();
    if (OUTDOOR_KEYWORDS.some((k) => label.includes(k))) outdoorScore += p.probability;
    if (INDOOR_KEYWORDS.some((k) => label.includes(k))) indoorScore += p.probability;
  }
  if (outdoorScore === 0 && indoorScore === 0) return { scene: "unknown" as const, topLabel };
  return {
    scene: outdoorScore >= indoorScore ? ("outdoor" as const) : ("indoor" as const),
    topLabel,
  };
}

export async function computeReferenceDescriptor(file: File): Promise<Float32Array | null> {
  await loadModels();
  if (!faceapi) return null;
  const img = await fileToImage(file);
  const detection = await faceapi
    .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection?.descriptor ?? null;
}

export async function analyzePhoto(
  file: File,
  referenceDescriptor: Float32Array | null,
): Promise<AnalysisResult> {
  await loadModels();
  if (!faceapi) throw new Error("Models not loaded");
  const img = await fileToImage(file);
  const { canvas, ctx, w, h } = drawToCanvas(img);

  const blurScore = laplacianVariance(ctx, w, h);
  const isBlurry = blurScore < BLUR_THRESHOLD;

  // Faces (run on small canvas for speed)
  const detections = await faceapi
    .detectAllFaces(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 }))
    .withFaceLandmarks()
    .withFaceDescriptors();

  // Tilt from largest face's eye angle
  let tiltAngle: number | null = null;
  if (detections.length) {
    const largest = detections.reduce((a, b) =>
      a.detection.box.area > b.detection.box.area ? a : b,
    );
    const lm = largest.landmarks;
    const leftEye = lm.getLeftEye();
    const rightEye = lm.getRightEye();
    const lc = leftEye.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
    const rc = rightEye.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
    lc.x /= leftEye.length; lc.y /= leftEye.length;
    rc.x /= rightEye.length; rc.y /= rightEye.length;
    tiltAngle = (Math.atan2(rc.y - lc.y, rc.x - lc.x) * 180) / Math.PI;
  }
  const isTilted = tiltAngle !== null && Math.abs(tiltAngle) > TILT_THRESHOLD_DEG;

  // Person match
  let matchedPerson = false;
  let matchDistance: number | null = null;
  if (referenceDescriptor && detections.length) {
    for (const d of detections) {
      const dist = faceapi.euclideanDistance(referenceDescriptor, d.descriptor);
      if (matchDistance === null || dist < matchDistance) matchDistance = dist;
    }
    matchedPerson = matchDistance !== null && matchDistance < MATCH_DISTANCE;
  }

  // Scene
  let scene: "outdoor" | "indoor" | "unknown" = "unknown";
  let topLabel = "";
  if (mobilenetModel) {
    const preds = await mobilenetModel.classify(canvas, 5);
    const c = classifyScene(preds);
    scene = c.scene;
    topLabel = c.topLabel;
  }

  const categories: PhotoCategory[] = [];
  if (isBlurry) categories.push("blurry");
  else if (isTilted) categories.push("tilted");
  else categories.push("keepers");
  if (scene === "outdoor") categories.push("outdoor");
  else if (scene === "indoor") categories.push("indoor");
  if (matchedPerson) categories.push("selected_person");

  return {
    blurScore,
    isBlurry,
    tiltAngle,
    isTilted,
    scene,
    topLabel,
    matchedPerson,
    matchDistance,
    categories,
  };
}

export const CATEGORY_LABELS: Record<PhotoCategory, string> = {
  keepers: "Keepers (sharp)",
  blurry: "Blurry / out of focus",
  tilted: "Tilted / shaken",
  outdoor: "Outdoor",
  indoor: "Indoor",
  selected_person: "Selected person",
};