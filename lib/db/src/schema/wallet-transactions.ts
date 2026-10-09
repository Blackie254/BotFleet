import { pgTable, text, integer, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { walletAccountsTable } from "./wallet-accounts";

export const walletTransactionsTable = pgTable(
  "wallet_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull().references(() => walletAccountsTable.clerkUserId),
    kind: text("kind", { enum: ["credit", "debit", "refund"] }).notNull(),
    status: text("status", { enum: ["pending", "completed", "failed"] }).notNull(),
    amountKsh: integer("amount_ksh").notNull(),
    description: text("description").notNull(),
    reference: text("reference").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("wallet_transactions_user_created_idx").on(table.clerkUserId, table.createdAt)],
);

export const insertWalletTransactionSchema = createInsertSchema(walletTransactionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertWalletTransaction = z.infer<typeof insertWalletTransactionSchema>;
export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;
