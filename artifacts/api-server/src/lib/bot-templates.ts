import { ListBotTemplatesResponseItem } from "@workspace/api-zod";

// Only list bots with a source repository explicitly supplied by the owner.
const templates = [
  {
    id: "black-md",
    name: "BLACK MD BOT",
    description:
      "Deploy the BLACK MD WhatsApp bot from its public source repository. Pair your own WhatsApp account using the official pairing page.",
    category: "WhatsApp automation",
    icon: "message-circle",
    monthlyPriceKsh: 50,
    features: [
      "Your own WhatsApp session",
      "Source: Blackie254/black-super-bot",
      "Monthly hosting on Heroku",
    ],
    setupMode: "session_id",
  },
] as const;

export const BOT_REPOSITORIES: Record<string, string> = {
  "black-md": "https://github.com/Blackie254/black-super-bot",
};

export function getBotRepositoryUrl(templateId: string): string | undefined {
  return BOT_REPOSITORIES[templateId];
}

export const BOT_TEMPLATES = templates.map((template) =>
  ListBotTemplatesResponseItem.parse(template),
);

export function getBotTemplate(id: string) {
  return BOT_TEMPLATES.find((template) => template.id === id);
}
