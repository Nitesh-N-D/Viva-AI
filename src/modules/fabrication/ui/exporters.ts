/** Browser-side export of a serialised drawing: SVG download, PNG raster, print-to-PDF and Web Share. */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}

/** Rasterises the SVG at `widthPx` wide on a white background. */
export async function svgToPng(svg: string, widthPx = 2000): Promise<Blob> {
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg_decode_failed"));
      img.src = url;
    });
    const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
    const canvas = document.createElement("canvas");
    canvas.width = widthPx;
    canvas.height = Math.round(widthPx * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png_encode_failed"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Opens the browser print dialog for the drawing in a hidden iframe; the
 * user picks "Save as PDF". The SVG carries mm width/height so it prints
 * at the stated scale. The SVG is loaded as an <img> from a blob URL, so
 * no markup is injected into the page.
 */
export function printSvg(svg: string, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(svgBlob(svg));
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc || !frame.contentWindow) {
      frame.remove();
      URL.revokeObjectURL(url);
      reject(new Error("print_unavailable"));
      return;
    }
    doc.title = title;
    const style = doc.createElement("style");
    style.textContent = "@page{size:A4 landscape;margin:10mm}html,body{margin:0}img{max-width:100%;max-height:190mm}";
    doc.head.appendChild(style);
    const img = doc.createElement("img");
    img.alt = title;
    img.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
        resolve();
      }, 1000);
    };
    img.onerror = () => {
      frame.remove();
      URL.revokeObjectURL(url);
      reject(new Error("svg_decode_failed"));
    };
    img.src = url;
    doc.body.appendChild(img);
  });
}

export type ShareOutcome = "shared" | "cancelled" | "unsupported";

export async function shareFile(file: File, title: string, text: string): Promise<ShareOutcome> {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function" || !navigator.canShare({ files: [file] })) {
    return "unsupported";
  }
  try {
    await navigator.share({ files: [file], title, text });
    return "shared";
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    throw err;
  }
}
