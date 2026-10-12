import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { toMinor, canAdd, canEdit, canManage, canChangeMember, validDate, budgetSchema, expenseSchema, inviteSchema, parseCursor, type Role } from "../lib/domain.ts";

test("money conversion retains exact decimal amounts including commas and small agorot", () => {
  assert.equal(toMinor("0.01"), 1);
  assert.equal(toMinor("386,50"), 38650);
  assert.equal(toMinor("100.1"), 10010);
  assert.equal(toMinor(" 12 "), 1200);
  assert.equal(toMinor("0.29") + toMinor("0.01"), 30);
});
test("money refuses negatives, exponent notation, ambiguous separators and excess precision", () => {
  for (const amount of ["-1", "1.001", "1e6", "1,000.00", "NaN", "", "1000000000"]) assert.throws(() => toMinor(amount));
});
test("role matrix protects read-only access and authorship", () => {
  const all: Role[] = ["owner", "admin", "contributor", "viewer"];
  assert.deepEqual(all.map(canManage), [true, true, false, false]);
  assert.deepEqual(all.map(canAdd), [true, true, true, false]);
  assert.deepEqual(all.map(role => canEdit(role, "me", "other")), [true, true, false, false]);
  assert.deepEqual(all.map(role => canEdit(role, "me", "me")), [true, true, true, false]);
});
test("only the owner can assign or revoke administrator access; ownership is immutable", () => {
  for (const role of ["owner", "admin", "contributor", "viewer"] as Role[]) {
    assert.equal(canChangeMember(role, "owner"), false);
    assert.equal(canChangeMember(role, "viewer", "owner"), false);
  }
  assert.equal(canChangeMember("admin", "contributor", "admin"), false);
  assert.equal(canChangeMember("admin", "admin", "viewer"), false);
  assert.equal(canChangeMember("admin", "viewer", "contributor"), true);
  assert.equal(canChangeMember("owner", "admin", "viewer"), true);
  assert.equal(canChangeMember("contributor", "viewer", "contributor"), false);
});
test("calendar dates reject nonexistent days and handle leap years", () => {
  assert.equal(validDate("2024-02-29"), true);
  for (const value of ["2025-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "1-1-1"]) assert.equal(validDate(value), false);
});
test("category limits must fit within the family month budget", () => {
  assert.equal(budgetSchema.safeParse({ month: "2026-10", totalMinor: 10000, categoryLimits: { food: 6000, home: 4000 }, revision: 0 }).success, true);
  assert.equal(budgetSchema.safeParse({ month: "2026-10", totalMinor: 10000, categoryLimits: { food: 6001, home: 4000 }, revision: 0 }).success, false);
  assert.equal(budgetSchema.safeParse({ month: "2026-10", totalMinor: 0, categoryLimits: {}, revision: 0 }).success, true);
  assert.equal(budgetSchema.safeParse({ month: "2026-13", totalMinor: 0, categoryLimits: {}, revision: 0 }).success, false);
});
test("expense validation refuses client-controlled authors, floating amounts and zero expenses", () => {
  const valid = { title: "Food", amountMinor: 1, category: "food", date: "2026-10-11", payerId: randomUUID(), note: "", account: "" };
  assert.equal(expenseSchema.safeParse(valid).success, true);
  assert.equal(expenseSchema.safeParse({ ...valid, authorId: randomUUID() }).success, false);
  assert.equal(expenseSchema.safeParse({ ...valid, amountMinor: 0 }).success, false);
  assert.equal(expenseSchema.safeParse({ ...valid, amountMinor: 1.1 }).success, false);
  assert.equal(expenseSchema.safeParse({ ...valid, payerId: { $ne: null } }).success, false);
});
test("invitations normalize emails, cannot grant ownership and reject injection fields", () => {
  assert.equal(inviteSchema.parse({ email: "Anna@Example.com", role: "contributor" }).email, "anna@example.com");
  assert.equal(inviteSchema.safeParse({ email: "anna@example.com", role: "owner" }).success, false);
  assert.equal(inviteSchema.safeParse({ email: "anna@example.com", role: "admin", tokenHash: "injected" }).success, false);
});
test("pagination cursor validates every part before a database query", () => {
  const id = randomUUID();
  assert.equal(parseCursor(`2026-10-11~2026-10-11T12:00:00.000Z~${id}`).id, id);
  assert.throws(() => parseCursor("2026-02-30~now~$where"));
  assert.throws(() => parseCursor(`2026-10-11~2026-10-11T12:00:00.000Z~${id}~extra`));
});
