import { ListBotTemplatesResponseItem } from "@workspace/api-zod";

const templates = [
  {
    id: "smart-reply",
    name: "Smart Reply",
    description: "A personal auto-reply assistant for incoming WhatsApp messages.",
    category: "Automation",
    icon: "sparkles",
    monthlyPriceKsh: 50,
    features: ["Always-on replies", "Keyword workflows", "Personal account pairing"],
    setupMode: "session_id",
  },
  {
    id: "store-assistant",
    name: "Store Assistant",
    description: "A customer-facing helper for answering product and service questions.",
    category: "Commerce",
    icon: "store",
    monthlyPriceKsh: 50,
    features: ["Customer support", "Quick answers", "Personal account pairing"],
    setupMode: "session_id",
  },
  {
    id: "group-guardian",
    name: "Group Guardian",
    description: "A group helper for keeping conversations organized and on-topic.",
    category: "Community",
    icon: "shield",
    monthlyPriceKsh: 50,
    features: ["Group workflows", "Automated responses", "Personal account pairing"],
    setupMode: "session_id",
  },
] as const;

export const BOT_TEMPLATES = templates.map((template) =>
  ListBotTemplatesResponseItem.parse(template),
);

export function getBotTemplate(id: string) {
  return BOT_TEMPLATES.find((template) => template.id === id);
}
