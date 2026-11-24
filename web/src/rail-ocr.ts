/// <reference types="vite/client" />
import { createWorker, OEM, PSM } from "tesseract.js";
import workerPath from "tesseract.js/dist/worker.min.js?url";
import corePath from "tesseract.js-core/tesseract-core-lstm.wasm.js?url";
import languagePath from "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url";
import { parseScreenshotText, type ScreenshotEvidence } from "../../src/rail/screenshot-evidence";

export async function recognizeRailScreenshot(file: File): Promise<ScreenshotEvidence> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("瀏覽器無法讀取截圖。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }

  const langPath = new URL(".", new URL(languagePath, document.baseURI)).href;
  let failInitialization: () => void = () => {};
  const initializationError = new Promise<never>((_resolve, reject) => {
    failInitialization = () => reject(new Error("無法啟動截圖辨識。"));
  });
  const worker = await Promise.race([
    initializationError,
    createWorker("eng", OEM.LSTM_ONLY, {
      workerPath,
      corePath,
      langPath,
      workerBlobURL: false,
      cacheMethod: "none",
      errorHandler: failInitialization,
    }),
  ]);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const { data: recognized } = await worker.recognize(canvas);
    return parseScreenshotText(recognized.text);
  } finally {
    await worker.terminate();
  }
}
