import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { walletAccountsTable } from "./wallet-accounts";

export const activitiesTable = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().references(() => walletAccountsTable.clerkUserId),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    kind: text("kind", { enum: ["payment", "deploy", "renewal", "system"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("activities_user_created_idx").on(table.clerkUserId, table.createdAt)],
);

export const insertActivitySchema = createInsertSchema(activitiesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type ActivityRecord = typeof activitiesTable.$inferSelect;
