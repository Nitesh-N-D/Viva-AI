import React, { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { Button } from "./Button";
import { Notice } from "./Feedback";

export const MIN_IMAGE_SIDE = 64;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 640;

export interface CapturedImage {
  canvas: HTMLCanvasElement;
  previewUrl: string;
}

export type ImageProblem = "not_image" | "too_large" | "too_small" | "unreadable";

/** Pure validation of what we know before decoding. Exported for tests. */
export function checkFile(file: { type: string; size: number }): ImageProblem | null {
  if (!file.type.startsWith("image/")) return "not_image";
  if (file.size > MAX_FILE_BYTES) return "too_large";
  return null;
}

export function checkDimensions(width: number, height: number): ImageProblem | null {
  return width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE ? "too_small" : null;
}

/** Draws any image source into a canvas no larger than MAX_SIDE on its long edge. */
function toCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

/**
 * Camera + upload capture with validation, preview and retake. The camera
 * stream is always stopped on capture, cancel and unmount.
 */
export function ImageCapture({
  onImage,
  onClear,
  busy,
  instruction,
}: {
  onImage: (img: CapturedImage) => void;
  onClear: () => void;
  busy?: boolean;
  instruction: string;
}) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<"idle" | "camera" | "preview">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
  };

  useEffect(() => stopCamera, []);

  function accept(canvas: HTMLCanvasElement) {
    const url = canvas.toDataURL("image/jpeg", 0.85);
    setPreview(url);
    setMode("preview");
    onImage({ canvas, previewUrl: url });
  }

  async function openCamera() {
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem(t("scan.cameraUnsupported"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      setMode("camera");
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setProblem(name === "NotAllowedError" || name === "SecurityError" ? t("scan.cameraDenied") : t("scan.cameraUnsupported"));
    }
  }

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = toCanvas(v, v.videoWidth, v.videoHeight);
    stopCamera();
    accept(canvas);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProblem(null);
    const bad = checkFile(file);
    if (bad) {
      setProblem(t(`scan.problem.${bad}`));
      return;
    }
    try {
      const img = await loadImage(file);
      const tooSmall = checkDimensions(img.naturalWidth, img.naturalHeight);
      if (tooSmall) {
        setProblem(t("scan.problem.too_small"));
        return;
      }
      accept(toCanvas(img, img.naturalWidth, img.naturalHeight));
    } catch {
      setProblem(t("scan.problem.unreadable"));
    }
  }

  function retake() {
    setPreview(null);
    setMode("idle");
    setProblem(null);
    onClear();
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-soil-700">{instruction}</p>

      <div className="relative w-full aspect-[4/3] rounded-card overflow-hidden bg-soil-900/90 flex items-center justify-center">
        {mode === "camera" && <video ref={videoRef} playsInline muted className="w-full h-full object-cover" aria-label={t("scan.cameraView")} />}
        {mode === "preview" && preview && <img src={preview} alt={t("scan.preview")} className="w-full h-full object-contain bg-black" />}
        {mode === "idle" && (
          <span className="text-6xl opacity-60" aria-hidden="true">
            📷
          </span>
        )}
        {busy && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-semibold" role="status">
            {t("scan.analysing")}
          </div>
        )}
      </div>

      {problem && <Notice tone="warning">{problem}</Notice>}

      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} aria-hidden="true" tabIndex={-1} />

      <div className="grid grid-cols-2 gap-2">
        {mode === "idle" && (
          <>
            <Button onClick={openCamera} icon="📷">
              {t("scan.openCamera")}
            </Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()} icon="🖼️">
              {t("scan.upload")}
            </Button>
          </>
        )}
        {mode === "camera" && (
          <>
            <Button onClick={capture} icon="⭕">
              {t("scan.capture")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                stopCamera();
                setMode("idle");
              }}
            >
              {t("common.cancel")}
            </Button>
          </>
        )}
        {mode === "preview" && (
          <Button variant="secondary" onClick={retake} disabled={busy} icon="↺" className="col-span-2">
            {t("scan.retake")}
          </Button>
        )}
      </div>
    </div>
  );
}
