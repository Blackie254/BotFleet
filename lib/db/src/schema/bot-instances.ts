import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { walletAccountsTable } from "./wallet-accounts";

export const botInstancesTable = pgTable(
  "bot_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().references(() => walletAccountsTable.clerkUserId),
    templateId: text("template_id").notNull(),
    templateName: text("template_name").notNull(),
    name: text("name").notNull(),
    repositoryUrl: text("repository_url").notNull(),
    status: text("status", { enum: ["queued", "deploying", "running", "stopped", "past_due", "failed"] }).notNull().default("queued"),
    herokuAppId: text("heroku_app_id"),
    herokuAppName: text("heroku_app_name").unique(),
    phoneNumber: text("phone_number"),
    encryptedSessionId: text("encrypted_session_id").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    renewalAt: timestamp("renewal_at", { withTimezone: true }),
  },
  (table) => [index("bot_instances_user_status_idx").on(table.clerkUserId, table.status)],
);

export const insertBotInstanceSchema = createInsertSchema(botInstancesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBotInstance = z.infer<typeof insertBotInstanceSchema>;
export type BotInstanceRecord = typeof botInstancesTable.$inferSelect;
