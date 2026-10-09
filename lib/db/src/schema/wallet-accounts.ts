import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const walletAccountsTable = pgTable("wallet_accounts", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  email: text("email"),
  balanceKsh: integer("balance_ksh").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertWalletAccountSchema = createInsertSchema(walletAccountsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertWalletAccount = z.infer<typeof insertWalletAccountSchema>;
export type WalletAccount = typeof walletAccountsTable.$inferSelect;
