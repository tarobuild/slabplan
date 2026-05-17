import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

function getAnthropicClient(): Anthropic {
  if (client) return client;

  if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set before using AI features.",
    );
  }

  client = new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  });
  return client;
}

export const anthropic = new Proxy({} as Anthropic, {
  get(_target, property, receiver) {
    return Reflect.get(getAnthropicClient(), property, receiver);
  },
});
