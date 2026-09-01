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
    const errorBody = await response.text();
    throw new Error(`Anthropic API request failed with status ${response.status}: ${errorBody}`);
  }

  return await response.json() as Anthropic.Message;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function hasPlausiblePhone(value: string) {
  const digitCount = value.replace(/\D/g, "").length;
  return digitCount >= 7 && digitCount <= 15;
}

function normalizeImageInput(imageValue: string, requestedMediaType: string) {
  const dataUrlMatch = imageValue.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is);
  const imageBase64 = (dataUrlMatch?.[2] || imageValue).replace(/\s/g, "");
  const mediaType = (dataUrlMatch?.[1] || requestedMediaType || "image/jpeg").toLowerCase();

  return { imageBase64, mediaType };
}

function isValidBase64(value: string) {
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function imageContent(imageBase64: string, mediaType: string): Anthropic.ImageBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data: imageBase64,
    },
  };
}

function toolInput(message: Anthropic.Message, toolName: string): ExtractedContact {
  const toolUse = message.content.find(
    (block) => block.type === "tool_use" && block.name === toolName && block.input && typeof block.input === "object",
  );

  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`AI response did not include ${toolName} output`);
  }

  return toolUse.input as ExtractedContact;
}

async function retryPhoneExtraction(
  imageBase64: string,
  mediaType: string,
  createMessage: MessageCreator,
) {
  const message = await createMessage({
    model: MODEL,
    max_tokens: 128,
    tools: [
      {
        name: "record_phone",
        description: "Record the complete telephone number visible in the image.",
        input_schema: {
          type: "object",
          properties: { phone: { type: "string" } },
          required: ["phone"],
          additionalProperties: false,
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_phone" },
    messages: [
      {
        role: "user",
        content: [
          imageContent(imageBase64, mediaType),
          {
            type: "text",
            text:
              "Focus only on finding a telephone number in this image. Inspect all small print and read the number digit by digit, especially text near labels such as phone, mobile, cell, call, text, tel, or WhatsApp. Preserve all visible punctuation and the complete country code. If the number begins with a plus sign (+), the output must also begin with +; never omit it. Do not use an address, license number, or ZIP code. Do not guess obscured digits. Use an empty string if no complete phone number is visible, then call record_phone.",
          },
        ],
      },
    ],
  });

  return stringValue(toolInput(message, "record_phone").phone);
}

export function createExtractContactHandler(messageCreator?: MessageCreator) {
  return async (req: Request) => {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }

    let body: { imageBase64?: unknown; mediaType?: unknown };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid image request." }, { status: 400 });
    }

    const imageValue = typeof body.imageBase64 === "string" ? body.imageBase64.trim() : "";
    const requestedMediaType = typeof body.mediaType === "string" ? body.mediaType : "image/jpeg";
    const { imageBase64, mediaType } = normalizeImageInput(imageValue, requestedMediaType);

    if (!imageBase64) {
      return Response.json({ error: "No image provided." }, { status: 400 });
    }

    if (imageBase64.length > MAX_BASE64_LENGTH) {
      return Response.json({ error: "That photo is too large. Try cropping it closer to the contact details." }, { status: 413 });
    }

    if (!isValidBase64(imageBase64)) {
      return Response.json({ error: "The selected image data is invalid. Try choosing the photo again." }, { status: 400 });
    }

    if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
      return Response.json({ error: "That image format is not supported. Try a JPEG or PNG." }, { status: 400 });
    }

    try {
      const createMessage = messageCreator || createDirectMessage;
      const message = await createMessage({
        model: MODEL,
        max_tokens: 512,
        tools: [
          {
            name: "record_contact",
            description: "Record the contact details extracted from the image.",
            input_schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                businessName: { type: "string" },
                pricing: { type: "string" },
                phone: { type: "string" },
                notes: { type: "string" },
                category: { type: "string", enum: CATEGORY_HINTS },
              },
              required: ["name", "businessName", "pricing", "phone", "notes", "category"],
              additionalProperties: false,
            },
          },
        ],
        tool_choice: { type: "tool", name: "record_contact" },
        messages: [
          {
            role: "user",
            content: [
              imageContent(imageBase64, mediaType),
              {
                type: "text",
                text:
                  "This image shows a business card, flyer, or contact info for a local service provider. " +
                  "Extract the contact details, then call record_contact. " +
                  `For \"category\" pick the single best match from this list: ${CATEGORY_HINTS.join(", ")}. ` +
                  'If a field cannot be determined, use an empty string for it (except category, default to "other"). Extract any visible starting price, hourly rate, service-call fee, package price, or estimate policy into "pricing" without guessing. ' +
                  'Treat the phone number as the highest-priority field. Inspect all small print and read it digit by digit, especially near labels such as phone, mobile, cell, call, text, tel, or WhatsApp. Preserve all visible punctuation and the complete country/area code. If the number begins with a plus sign (+), the phone output must also begin with +; never omit it. Do not substitute an address, license number, or ZIP code, and do not guess obscured digits. "notes" can include an address or trade specialty if visible.',
              },
            ],
          },
        ],
      });

      const parsed = toolInput(message, "record_contact");
      let phone = stringValue(parsed.phone);

      if (!hasPlausiblePhone(phone)) {
        try {
          phone = await retryPhoneExtraction(imageBase64, mediaType, createMessage);
        } catch (error) {
          console.error("Focused phone extraction failed", error);
        }
      }

      const category = stringValue(parsed.category);

      return Response.json({
        name: stringValue(parsed.name),
        businessName: stringValue(parsed.businessName),
        pricing: stringValue(parsed.pricing).slice(0, 160),
        phone: hasPlausiblePhone(phone) ? phone : "",
        notes: stringValue(parsed.notes),
        category: CATEGORY_HINTS.includes(category) ? category : "other",
      });
    } catch (error) {
      console.error("Contact extraction failed", error);
      return Response.json(
        { error: "Could not read contact details from that photo. Try a clearer or more closely cropped image." },
        { status: 502 },
      );
    }
  };
}

export default createExtractContactHandler();

export const config = {
  runtime: "edge",
};