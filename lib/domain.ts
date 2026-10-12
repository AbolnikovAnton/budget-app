import { z } from "zod";

export const categories = ["food", "home", "transport", "bills", "health", "leisure", "shopping", "other"] as const;
export const currencies = ["ILS", "RUB", "USD", "EUR"] as const;
export const roles = ["owner", "admin", "contributor", "viewer"] as const;
export type Category = typeof categories[number];
export type Currency = typeof currencies[number];
export type Role = typeof roles[number];
export type Language = "ru" | "en";
export interface Person { id: string; name: string; email: string }
export interface Member { userId: string; name: string; email: string; role: Role }
export interface Family { _id: string; name: string; currency: Currency; ownerId: string; members: Member[]; createdAt: string; accessRevision?: number; budgetStartDay?: number; settingsRevision?: number }
export interface Expense {
  _id: string; familyId: string; title: string; amountMinor: number; date: string;
  category: Category; payerId: string; authorId: string; note: string; account: string;
  revision: number; createdAt: string; updatedAt: string; deletedAt: string | null;
}
export interface InstallmentPlan {
  _id: string; familyId: string; title: string; totalMinor: number; paymentCount: number; firstDate: string;
  category: Category; payerId: string; authorId: string; note: string; account: string;
  revision: number; createdAt: string; updatedAt: string; cancelledFrom: string | null;
}
export interface ScheduledPayment extends Expense { planId: string; paymentNumber: number; paymentCount: number }
export interface RawSnapshot {
  family: Family; budgets: MonthBudget[]; expenses: Expense[]; plans: InstallmentPlan[];
  activity: Activity[]; invitations: InviteInfo[]; nextCursor: string | null; dataRevision: number;
}
export interface MonthBudget { _id: string; familyId: string; month: string; totalMinor: number; categoryLimits: Partial<Record<Category, number>>; revision: number; inheritedFromMonth?: string }
export interface BudgetPeriod { month: string; startDay: number; start: string; end: string; endExclusive: string }
export interface Activity { _id: string; familyId: string; actorId: string; actorName: string; action: string; title: string; amountMinor?: number; at: string }
export interface InviteInfo { _id: string; email: string; role: Exclude<Role, "owner">; expiresAt: string }
export interface Snapshot {
  family: Family; budget: MonthBudget | null; expenses: Expense[]; nextCursor: string | null;
  totalMinor: number; count: number; categoryTotals: Partial<Record<Category, number>>;
  activity: Activity[]; invitations: InviteInfo[];
  period: BudgetPeriod;
  plans: InstallmentPlan[]; scheduledEntries: ScheduledPayment[]; scheduledMinor: number;
  manualMinor: number;
  committedMinor: number; committedCategoryTotals: Partial<Record<Category, number>>;
}

export function canManage(role: Role) { return role === "owner" || role === "admin"; }
export function canAdd(role: Role) { return role !== "viewer"; }
export function canEdit(role: Role, userId: string, authorId: string) { return canManage(role) || (role === "contributor" && userId === authorId); }
export function canChangeMember(actor: Role, target: Role, next?: Role) {
  if (target === "owner" || next === "owner") return false;
  if (actor === "owner") return true;
  return actor === "admin" && target !== "admin" && next !== "admin";
}

// Money is stored as integer agorot/cents/kopecks, never floating-point amounts.
export function toMinor(input: string): number {
  const normalized = input.trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) throw new Error("invalidAmount");
  const [whole, fraction = ""] = normalized.split(".");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(value) || value > 10_000_000_000) throw new Error("invalidAmount");
  return value;
}
export function minorInput(value: number) { return (value / 100).toFixed(2); }
export function money(value: number, currency: Currency, language: Language) {
  return new Intl.NumberFormat(language === "ru" ? "ru-RU" : "en-IL", { style: "currency", currency, maximumFractionDigits: 2 }).format(value / 100);
}
export function todayLocal(date = new Date()) {
  // Every family member uses the same rollover date, even when travelling abroad.
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function periodBoundary(year: number, monthIndex: number, startDay: number) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(startDay, lastDay)));
}
export function budgetPeriod(month: string, startDay = 1): BudgetPeriod {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(startDay) || startDay < 1 || startDay > 31) throw new Error("invalidInput");
  const [year, calendarMonth] = month.split("-").map(Number);
  const start = periodBoundary(year, calendarMonth - 1, startDay);
  const endExclusive = periodBoundary(year, calendarMonth, startDay);
  const end = new Date(endExclusive.getTime() - 86_400_000);
  return { month, startDay, start: isoDate(start), end: isoDate(end), endExclusive: isoDate(endExclusive) };
}
export function budgetMonthForDate(date: string, startDay = 1) {
  if (!validDate(date)) throw new Error("invalidInput");
  const month = date.slice(0, 7);
  if (date >= budgetPeriod(month, startDay).start) return month;
  const [year, calendarMonth] = month.split("-").map(Number);
  return isoDate(new Date(Date.UTC(year, calendarMonth - 2, 1))).slice(0, 7);
}
export function budgetForPeriod(saved: MonthBudget | null, month: string): MonthBudget | null {
  if (!saved || saved.month > month) return null;
  if (saved.month === month) return saved;
  // A new period starts with the previous limits, without changing archived records.
  return { ...saved, month, revision: 0, inheritedFromMonth: saved.month };
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 2000 || year > 2099) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
export const idSchema = z.uuid();
export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
const minorSchema = z.number().int().min(0).max(10_000_000_000);
export const familySchema = z.object({ name: z.string().trim().min(1).max(60), currency: z.enum(currencies), budgetStartDay: z.number().int().min(1).max(31).default(10) }).strict();
export const settingsSchema = z.object({ budgetStartDay: z.number().int().min(1).max(31), revision: z.number().int().min(0) }).strict();
export const expenseSchema = z.object({
  title: z.string().trim().min(1).max(100), amountMinor: minorSchema.min(1),
  date: z.string().refine(validDate), category: z.enum(categories), payerId: idSchema,
  note: z.string().trim().max(500).default(""), account: z.string().trim().max(50).default("")
}).strict();
export const updateExpenseSchema = expenseSchema.extend({ revision: z.number().int().min(1) });
export const planSchema = z.object({
  title: z.string().trim().min(1).max(100), totalMinor: minorSchema.min(1),
  paymentCount: z.number().int().min(1).max(600), firstDate: z.string().refine(validDate),
  category: z.enum(categories), payerId: idSchema,
  note: z.string().trim().max(500).default(""), account: z.string().trim().max(50).default("")
}).strict().refine(data => data.totalMinor >= data.paymentCount, { message: "invalidPlan" })
  .refine(data => {
    if (!validDate(data.firstDate)) return false;
    const [year, month] = data.firstDate.split("-").map(Number);
    return year + Math.floor((month - 1 + data.paymentCount - 1) / 12) <= 2099;
  }, { message: "invalidPlan" });
export const updatePlanSchema = planSchema.safeExtend({ revision: z.number().int().min(1) });
export const cancelPlanSchema = z.object({ revision: z.number().int().min(1), cancelledFrom: z.string().refine(validDate) }).strict();
export const budgetSchema = z.object({
  month: monthSchema, totalMinor: minorSchema,
  categoryLimits: z.partialRecord(z.enum(categories), minorSchema), revision: z.number().int().min(0)
}).strict().refine(data => Object.values(data.categoryLimits).reduce((a, b) => a + (b ?? 0), 0) <= data.totalMinor, { message: "categoryBudgetExceeded" });
export const inviteSchema = z.object({ email: z.email().trim().toLowerCase().max(254), role: z.enum(["admin", "contributor", "viewer"]) }).strict();
export const memberSchema = z.object({ role: z.enum(["admin", "contributor", "viewer"]) }).strict();
export const revisionSchema = z.object({ revision: z.number().int().min(1) }).strict();

export function expenseCursor(expense: Expense) { return `${expense.date}~${expense.createdAt}~${expense._id}`; }
export function parseCursor(value: string) {
  const [date, createdAt, id, extra] = value.split("~");
  if (extra || !validDate(date) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) || !idSchema.safeParse(id).success) throw new Error("invalidInput");
  return { date, createdAt, id };
}
