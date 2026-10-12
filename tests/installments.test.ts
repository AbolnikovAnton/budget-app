import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { paymentAmount, paymentDate, planSchedule, paymentsInPeriod, calculateSnapshot, planProgress } from "../lib/calculators.ts";
import { budgetPeriod, planSchema, updatePlanSchema, type InstallmentPlan, type RawSnapshot } from "../lib/domain.ts";

const ownerId = randomUUID();
const familyId = randomUUID();
const makePlan = (overrides: Partial<InstallmentPlan> = {}): InstallmentPlan => ({
  _id: randomUUID(), familyId, title: "Laptop", totalMinor: 360000, paymentCount: 12, firstDate: "2026-10-15",
  category: "shopping", payerId: ownerId, authorId: ownerId, note: "", account: "Card", revision: 1,
  createdAt: "2026-10-12T10:00:00.000Z", updatedAt: "2026-10-12T10:00:00.000Z", cancelledFrom: null, ...overrides
});
const raw = (): RawSnapshot => ({
  family: { _id: familyId, name: "Family", currency: "ILS", ownerId, members: [{ userId: ownerId, name: "Anna", email: "anna@example.com", role: "owner" }], createdAt: "2026-10-01T10:00:00.000Z", budgetStartDay: 10 },
  budgets: [{ _id: randomUUID(), familyId, month: "2026-10", totalMinor: 500000, categoryLimits: { shopping: 100000 }, revision: 1 }],
  expenses: [], plans: [], invitations: [], activity: [], nextCursor: null, dataRevision: 0
});

test("a 3600 ILS purchase creates exactly 12 monthly 300 ILS payments", () => {
  const schedule = planSchedule(makePlan());
  assert.equal(schedule.length,12);
  assert.ok(schedule.every(payment => payment.amountMinor === 30000));
  assert.equal(schedule.at(-1)!.date,"2027-09-15");
});
test("fractional installments preserve the exact total, differing by at most one agora", () => {
  for (const total of [100,10000,10001,10000000000]) for (const count of [1,3,7,100]) {
    if (total < count) continue;
    const amounts = Array.from({ length: count }, (_,index) => paymentAmount(total,count,index));
    assert.equal(amounts.reduce((sum,value) => sum + value,0),total);
    assert.ok(Math.max(...amounts) - Math.min(...amounts) <= 1);
    assert.ok(amounts.every(value => value >= 1 && Number.isInteger(value)));
  }
});
test("monthly dates retain the original day after clamping a short month", () => {
  assert.equal(paymentDate("2026-01-31",1),"2026-02-28");
  assert.equal(paymentDate("2026-01-31",2),"2026-03-31");
  assert.equal(paymentDate("2024-01-31",1),"2024-02-29");
});
test("a debit on the 9th belongs to the preceding budget cycle; the 10th starts the next", () => {
  const before = makePlan({ firstDate: "2026-10-09" });
  const boundary = makePlan({ firstDate: "2026-10-10" });
  assert.equal(paymentsInPeriod(before,budgetPeriod("2026-09",10))[0].paymentNumber,1);
  assert.equal(paymentsInPeriod(before,budgetPeriod("2026-10",10))[0].paymentNumber,2);
  assert.equal(paymentsInPeriod(boundary,budgetPeriod("2026-10",10))[0].paymentNumber,1);
});
test("a short-month budget window can include two monthly debits without dropping either", () => {
  const plan = makePlan({ firstDate: "2026-01-30", paymentCount: 3, totalMinor: 30000 });
  const payments = paymentsInPeriod(plan,budgetPeriod("2026-02",31));
  assert.deepEqual(payments.map(payment => payment.date),["2026-02-28","2026-03-30"]);
});
test("completed schedules do not generate perpetual future spending", () => {
  assert.deepEqual(paymentsInPeriod(makePlan(),budgetPeriod("2027-10",10)),[]);
  assert.deepEqual(paymentsInPeriod(makePlan(),budgetPeriod("2026-09",10)),[]);
});
test("cancelling future debits preserves prior-period payments", () => {
  const plan = makePlan({ cancelledFrom: "2026-12-15" });
  assert.equal(planSchedule(plan).length,2);
  assert.equal(paymentsInPeriod(plan,budgetPeriod("2026-11",10)).length,1);
  assert.equal(paymentsInPeriod(plan,budgetPeriod("2026-12",10)).length,0);
});
test("frontend totals automatically include the scheduled debit without mutating source rows", () => {
  const data = raw();
  data.plans = [makePlan()];
  data.expenses = [{ _id: randomUUID(), familyId, title: "Food", amountMinor: 10000, date: "2026-10-11", category: "food", payerId: ownerId, authorId: ownerId, account: "", note: "", revision: 1, createdAt: "2026-10-11T10:00:00.000Z", updatedAt: "2026-10-11T10:00:00.000Z", deletedAt: null }];
  const original = structuredClone(data);
  const snapshot = calculateSnapshot(data,"2026-10");
  assert.equal(snapshot.manualMinor,10000);
  assert.equal(snapshot.scheduledMinor,30000);
  assert.equal(snapshot.totalMinor,40000);
  assert.equal(snapshot.count,2);
  assert.equal(snapshot.categoryTotals.shopping,30000);
  assert.equal(snapshot.expenses.length,2);
  assert.deepEqual(data,original);
});
test("totals wait for complete pagination rather than displaying a partial budget", () => {
  const data = raw(); data.nextCursor = "pending";
  assert.throws(() => calculateSnapshot(data,"2026-10"),/incompleteData/);
});
test("plan progress and remaining debt stop at the end of the finite schedule", () => {
  const progress = planProgress(makePlan(),"2027-10-01");
  assert.equal(progress.remainingCount,0);
  assert.equal(progress.remainingMinor,0);
  assert.equal(progress.next,null);
});
test("server schemas reject injected schedules and invalid totals while allowing revisions", () => {
  const input = { title: "Laptop", totalMinor: 10000, paymentCount: 3, firstDate: "2026-10-31", category: "shopping", payerId: ownerId, note: "", account: "" };
  assert.equal(planSchema.safeParse(input).success,true);
  assert.equal(updatePlanSchema.safeParse({ ...input, revision: 1 }).success,true);
  for (const invalid of [{ paymentCount: 0 },{ paymentCount: 601 },{ paymentCount: 3.5 },{ totalMinor: 1 },{ totalMinor: 1.5 },{ firstDate: "2026-02-30" },{ firstDate: "2099-12-31", paymentCount: 2 },{ schedule: [] },{ monthlyAmount: 1 },{ authorId: randomUUID() }]) {
    assert.equal(planSchema.safeParse({ ...input,...invalid }).success,false);
  }
});
