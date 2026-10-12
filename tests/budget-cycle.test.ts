import test from "node:test";
import assert from "node:assert/strict";
import { budgetPeriod, budgetMonthForDate, budgetForPeriod, todayLocal, familySchema, settingsSchema, type MonthBudget } from "../lib/domain.ts";

test("reset day 10 counts the 10th through the following 9th, with an exclusive upper boundary", () => {
  assert.deepEqual(budgetPeriod("2026-10", 10), {
    month: "2026-10", startDay: 10, start: "2026-10-10", end: "2026-11-09", endExclusive: "2026-11-10"
  });
  assert.equal(budgetMonthForDate("2026-10-09", 10), "2026-09");
  assert.equal(budgetMonthForDate("2026-10-10", 10), "2026-10");
  assert.equal(budgetMonthForDate("2026-11-09", 10), "2026-10");
  assert.equal(budgetMonthForDate("2026-11-10", 10), "2026-11");
});
test("reset periods cross the year boundary without losing January expenses", () => {
  assert.equal(budgetPeriod("2026-12", 10).end, "2027-01-09");
  assert.equal(budgetMonthForDate("2027-01-01", 10), "2026-12");
});
test("legacy day 1 retains normal calendar-month ranges", () => {
  assert.equal(budgetPeriod("2026-02").start, "2026-02-01");
  assert.equal(budgetPeriod("2026-02").end, "2026-02-28");
  assert.equal(budgetMonthForDate("2026-02-01"), "2026-02");
});
test("missing reset dates clamp to the month's last day, including leap years", () => {
  assert.equal(budgetPeriod("2024-02", 31).start, "2024-02-29");
  assert.equal(budgetPeriod("2025-02", 31).start, "2025-02-28");
  assert.equal(budgetPeriod("2026-04", 31).start, "2026-04-30");
  assert.equal(budgetMonthForDate("2025-02-27", 31), "2025-01");
  assert.equal(budgetMonthForDate("2025-02-28", 31), "2025-02");
});
test("all selectable reset days produce contiguous, non-overlapping monthly periods", () => {
  for (const year of [2024, 2025]) for (let reset = 1; reset <= 31; reset++) for (let month = 1; month <= 12; month++) {
    const label = `${year}-${String(month).padStart(2, "0")}`;
    const period = budgetPeriod(label, reset);
    const nextLabel = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
    assert.equal(period.endExclusive, budgetPeriod(nextLabel, reset).start);
    assert.equal(budgetMonthForDate(period.start, reset), label);
    assert.equal(budgetMonthForDate(period.end, reset), label);
    assert.equal(budgetMonthForDate(period.endExclusive, reset), nextLabel);
  }
});
test("rollover uses midnight in Israel in both summer and winter", () => {
  assert.equal(todayLocal(new Date("2026-07-09T20:59:59Z")), "2026-07-09");
  assert.equal(todayLocal(new Date("2026-07-09T21:00:00Z")), "2026-07-10");
  assert.equal(todayLocal(new Date("2026-01-09T21:59:59Z")), "2026-01-09");
  assert.equal(todayLocal(new Date("2026-01-09T22:00:00Z")), "2026-01-10");
});
test("new budgets default to day 10; invalid reset days and revisions are rejected", () => {
  assert.equal(familySchema.parse({ name: "Family", currency: "ILS" }).budgetStartDay, 10);
  for (const day of [0, 32, -1, 10.5, "10"]) assert.equal(settingsSchema.safeParse({ budgetStartDay: day, revision: 0 }).success, false);
  assert.equal(settingsSchema.safeParse({ budgetStartDay: 10, revision: -1 }).success, false);
  assert.equal(settingsSchema.safeParse({ budgetStartDay: 31, revision: 0 }).success, true);
});
test("monthly limits carry forward without mutating the old period or its revision", () => {
  const previous: MonthBudget = { _id: "budget-id", familyId: "family-id", month: "2026-09", totalMinor: 10000, categoryLimits: { food: 5000 }, revision: 3 };
  const original = structuredClone(previous);
  const current = budgetForPeriod(previous, "2026-10")!;
  assert.equal(current.totalMinor, 10000);
  assert.equal(current.month, "2026-10");
  assert.equal(current.revision, 0);
  assert.equal(current.inheritedFromMonth, "2026-09");
  assert.deepEqual(previous, original);
  assert.equal(budgetForPeriod(previous, "2026-09"), previous);
  assert.equal(budgetForPeriod(previous, "2026-08"), null);
  assert.equal(budgetForPeriod(null, "2026-10"), null);
});
