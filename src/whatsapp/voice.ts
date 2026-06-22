import axios from "axios";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "../utils/logger";

const WA_MEDIA_URL = "https://graph.facebook.com/v18.0";

export async function getMediaUrl(mediaId: string): Promise<string> {
  const response = await axios.get(`${WA_MEDIA_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
    timeout: 15000,
  });
  return response.data.url;
}

export async function downloadMedia(mediaId: string, destPath: string): Promise<{ size: number; mime_type: string }> {
  const url = await getMediaUrl(mediaId);
  const response = await axios.get(url, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
    responseType: "stream",
    timeout: 60000,
  });

  const writer = fs.createWriteStream(destPath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", () => {
      const stats = fs.statSync(destPath);
      const mimeType: string = response.headers["content-type"] as string || "audio/ogg";
      resolve({ size: stats.size, mime_type: mimeType });
    });
    writer.on("error", reject);
  });
}

export async function transcribeAudio(audioPath: string): Promise<string> {
  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("file", fs.createReadStream(audioPath));
    form.append("model", "whisper-1");
    form.append("language", "en");

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${config.openai.apiKey}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 120000,
      }
    );

    logger.info("Audio transcribed", { path: audioPath, length: response.data.text.length });
    return response.data.text;
  } catch (err: any) {
    logger.error("Whisper transcription failed", { error: err.response?.data || err.message });
    throw err;
  }
}

export async function processVoiceMessage(mediaId: string, phone: string): Promise<string> {
  const tempDir = "/tmp/tutor-voice";
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const audioPath = path.join(tempDir, `${mediaId}.ogg`);
  await downloadMedia(mediaId, audioPath);

  const transcript = await transcribeAudio(audioPath);

  try { fs.unlinkSync(audioPath); } catch (e) {}

  return transcript;
}
