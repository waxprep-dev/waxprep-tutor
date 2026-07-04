import { createHmac, timingSafeEqual } from "crypto";
import { config } from "../config";

export function verifyChallenge(
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined
): string | false {
  if (mode === "subscribe" && token === config.whatsapp?.verifyToken) {
    return challenge || "";
  }
  return false;
}

export function verifyWebhookSignature(body: string, signature: string | undefined): boolean {
  if (!signature || !config.whatsapp?.appSecret) {
    return false;
  }

  const expected = createHmac("sha256", config.whatsapp.appSecret)
    .update(body, "utf8")
    .digest("hex");

  const expectedSig = "sha256=" + expected;

  if (signature.length !== expectedSig.length) {
    return false;
  }

  try {
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);
    return timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
