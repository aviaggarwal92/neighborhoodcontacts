import type Anthropic from "@anthropic-ai/sdk";

const CATEGORY_HINTS = [
  "electrician",
  "plumber",
  "epoxy",
  "water-filter",
  "landscaping",
  "hvac",
  "handyman",
  "cleaning",
  "pest-control",
  "other",
];

const MODEL = "claude-opus-4-8";
const MAX_BASE64_LENGTH = 4_500_000;
const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

type ExtractedContact = {
  name?: unknown;
  businessName?: unknown;
  phone?: unknown;
  notes?: unknown;
  category?: unknown;
};

type MessageCreator = (
  payload: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message>;

async function createDirectMessage(payload: Anthropic.MessageCreateParamsNonStreaming) {
  const anthropicBaseUrl = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const response = await fetch(`${anthropicBaseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": anthropicKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API request failed with status ${response.status}`);
  }

  return await response.json() as Anthropic.Message;
}

// ...stringValue, hasPlausiblePhone, normalizeImageInput, isValidBase64,
// imageContent, toolInput, retryPhoneExtraction, createExtractContactHandler
// are all UNCHANGED from your original file...

export default createExtractContactHandler();

export const config = {
  runtime: "edge",
};