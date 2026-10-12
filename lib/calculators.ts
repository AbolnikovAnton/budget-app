import { budgetPeriod, budgetForPeriod, validDate, type InstallmentPlan, type ScheduledPayment, type RawSnapshot, type Snapshot, type Category, type BudgetPeriod } from "./domain.ts";

// This module is used by the frontend. No derived totals or expanded schedules are saved.
export function paymentAmount(totalMinor: number, count: number, index: number) {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < count || totalMinor > 10_000_000_000 || !Number.isInteger(count) || count < 1 || count > 600 || !Number.isInteger(index) || index < 0 || index >= count) throw new Error("invalidPlan");
  // Distribute leftover agorot: every payment differs by at most one agora.
  return Math.floor(totalMinor / count) + (index < totalMinor % count ? 1 : 0);
}
export function paymentDate(firstDate: string, index: number) {
  if (!validDate(firstDate) || !Number.isInteger(index) || index < 0 || index > 599) throw new Error("invalidPlan");
  const [year, month, day] = firstDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + index, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  const result = target.toISOString().slice(0, 10);
  if (!validDate(result)) throw new Error("invalidPlan");
  return result;
}
function scheduledEntry(plan: InstallmentPlan, index: number): ScheduledPayment | null {
  const date = paymentDate(plan.firstDate, index);
  if (plan.cancelledFrom && date >= plan.cancelledFrom) return null;
  return { _id: `plan:${plan._id}:${index}`, familyId: plan.familyId, title: plan.title,
    amountMinor: paymentAmount(plan.totalMinor, plan.paymentCount, index), date, category: plan.category,
    payerId: plan.payerId, authorId: plan.authorId, account: plan.account, note: plan.note,
    revision: plan.revision, createdAt: plan.createdAt, updatedAt: plan.updatedAt, deletedAt: null,
    planId: plan._id, paymentNumber: index + 1, paymentCount: plan.paymentCount };
}
export function planSchedule(plan: InstallmentPlan) {
  const schedule: ScheduledPayment[] = [];
  for (let index = 0; index < plan.paymentCount; index++) {
    const payment = scheduledEntry(plan, index);
    if (payment) schedule.push(payment);
  }
  return schedule;
}
function monthDistance(from: string, to: string) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + toMonth - fromMonth;
}
export function paymentsInPeriod(plan: InstallmentPlan, period: BudgetPeriod) {
  // Inspect only the calendar months touched by this budget period, not all 600 dates.
  const first = Math.max(0, monthDistance(plan.firstDate, period.start));
  const last = Math.min(plan.paymentCount - 1, monthDistance(plan.firstDate, period.end));
  const payments: ScheduledPayment[] = [];
  for (let index = first; index <= last; index++) {
    const payment = scheduledEntry(plan, index);
    if (payment && payment.date >= period.start && payment.date < period.endExclusive) payments.push(payment);
  }
  return payments;
}
export function planProgress(plan: InstallmentPlan, today: string) {
  if (!validDate(today)) throw new Error("invalidInput");
  const schedule = planSchedule(plan);
  const elapsed = schedule.filter(payment => payment.date < today);
  const upcoming = schedule.filter(payment => payment.date >= today);
  return { elapsedCount: elapsed.length, remainingCount: upcoming.length,
    remainingMinor: upcoming.reduce((sum, payment) => sum + payment.amountMinor, 0),
    next: upcoming[0] || null, last: schedule.at(-1) || null, schedule };
}
export function calculateSnapshot(raw: RawSnapshot, month: string, startDay = raw.family.budgetStartDay ?? 1): Snapshot {
  if (raw.nextCursor) throw new Error("incompleteData");
  const period = budgetPeriod(month, startDay);
  const manualExpenses = raw.expenses.filter(expense => !expense.deletedAt && expense.date >= period.start && expense.date < period.endExclusive)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b._id.localeCompare(a._id));
  const previousBudget = raw.budgets.filter(budget => budget.month <= month).sort((a, b) => b.month.localeCompare(a.month))[0] || null;
  const scheduledEntries = raw.plans.flatMap(plan => paymentsInPeriod(plan, period)).sort((a, b) => a.date.localeCompare(b.date) || a._id.localeCompare(b._id));
  const categoryTotals: Partial<Record<Category, number>> = {};
  for (const expense of [...manualExpenses, ...scheduledEntries]) categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + expense.amountMinor;
  const committedCategoryTotals = { ...categoryTotals };
  const manualMinor = manualExpenses.reduce((sum, expense) => sum + expense.amountMinor, 0);
  const scheduledMinor = scheduledEntries.reduce((sum, payment) => sum + payment.amountMinor, 0);
  const totalMinor = manualMinor + scheduledMinor;
  const expenses = [...manualExpenses, ...scheduledEntries].sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b._id.localeCompare(a._id));
  return { family: { ...raw.family, budgetStartDay: startDay }, budget: budgetForPeriod(previousBudget, month), expenses, count: expenses.length,
    nextCursor: null, period, totalMinor, categoryTotals, activity: raw.activity, invitations: raw.invitations,
    plans: raw.plans, scheduledEntries, scheduledMinor, manualMinor, committedMinor: totalMinor, committedCategoryTotals };
}
