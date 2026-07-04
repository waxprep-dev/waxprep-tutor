import { createHmac, timingSafeEqual } from "crypto";
import { config } from "../config";

export function verifyChallenge(
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined
): string | false {
  const verifyToken = config.whatsapp?.verifyToken;
  if (mode === "subscribe" && token === verifyToken) {
    return challenge || "";
  }
  return false;
}

export function verifyWebhookSignature(body: string, signature: string | undefined): boolean {
  if (!body) {
    console.warn("Webhook signature verification: Empty body");
    return false;
  }

  if (!signature) {
    console.warn("Webhook signature verification: No signature provided");
    return false;
  }

  const appSecret = config.whatsapp?.appSecret;
  if (!appSecret) {
    console.warn("Webhook signature verification: WHATSAPP_APP_SECRET not configured");
    return false;
  }

  try {
    const expected = createHmac("sha256", appSecret)
      .update(body, "utf8")
      .digest("hex");

    const expectedSig = "sha256=" + expected;

    // Debug: Log first few chars
    console.log("Signature debug:", {
      expectedPrefix: expectedSig.substring(0, 20),
      receivedPrefix: signature.substring(0, 20),
      appSecretPrefix: appSecret.substring(0, 10) + "...",
    });

    if (signature === expectedSig) {
      return true;
    }

    try {
      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSig);
      
      if (sigBuffer.length !== expectedBuffer.length) {
        return false;
      }
      
      return timingSafeEqual(sigBuffer, expectedBuffer);
    } catch (e) {
      return false;
    }

  } catch (error: any) {
    console.error("Webhook signature verification error:", error.message);
    return false;
  }
}
