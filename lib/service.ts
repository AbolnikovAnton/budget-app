import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ClientSession, Filter } from "mongodb";
import { database, mongoClient } from "./db";
import {
  type Family, type Person, type Expense, type MonthBudget, type Activity, type Member, type InstallmentPlan,
  type InviteInfo, type Role, canAdd, canEdit, canManage, canChangeMember,
  familySchema, expenseSchema, updateExpenseSchema, budgetSchema, inviteSchema,
  memberSchema, revisionSchema, idSchema, expenseCursor, parseCursor,
  settingsSchema, planSchema, updatePlanSchema, cancelPlanSchema, todayLocal
} from "./domain";
import { ZodError } from "zod";

interface Invitation extends InviteInfo { familyId: string; tokenHash: string; createdBy: string; consumedAt: string | null; revokedAt: string | null }
interface UserDocument { _id: string; name: string; email: string; familyCount: number }
interface RateLimit { _id: string; count: number; expiresAt: Date }
export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
function fail(status: number, code: string): never { throw new HttpError(status, code); }
function assertId(value?: string) { if (!idSchema.safeParse(value).success) fail(400, "invalidInput"); return value!; }
function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

async function collections() {
  const db = await database();
  return {
    users: db.collection<UserDocument>("users"), families: db.collection<Family>("families"),
    plans: db.collection<InstallmentPlan>("plans"), expenses: db.collection<Expense>("expenses"), budgets: db.collection<MonthBudget>("budgets"),
    invitations: db.collection<Invitation>("invitations"), activities: db.collection<Activity>("activities"),
    rates: db.collection<RateLimit>("rateLimits")
  };
}
type Collections = Awaited<ReturnType<typeof collections>>;
async function memberFamily(c: Collections, familyId: string, person: Person, session?: ClientSession) {
  const family = await c.families.findOne({ _id: familyId, "members.userId": person.id }, { session });
  if (!family) fail(404, "familyNotFound");
  const member = family.members.find(item => item.userId === person.id)!;
  return { family, member };
}
async function withFamily<T>(person: Person, familyId: string, operation: (c: Collections, family: Family, member: Member, session: ClientSession) => Promise<T>) {
  const c = await collections();
  const client = await mongoClient();
  return client.withSession(session => session.withTransaction(async () => {
    const { family, member } = await memberFamily(c, familyId, person, session);
    // Serialize writes with permission changes. Retried transactions re-read membership.
    await c.families.updateOne({ _id: familyId }, { $set: { "members.$[self].name": person.name, "members.$[self].email": person.email } }, {
      session, arrayFilters: [{ "self.userId": person.id }]
    });
    // A real write is required even when name/email are unchanged.
    await c.families.updateOne({ _id: familyId }, { $inc: { accessRevision: 1 } }, { session });
    return operation(c, family, member, session);
  }));
}
async function logActivity(c: Collections, person: Person, familyId: string, action: string, title: string, session: ClientSession, amountMinor?: number) {
  await c.activities.insertOne({ _id: randomUUID(), familyId, actorId: person.id, actorName: person.name, action, title, at: new Date().toISOString(), ...(amountMinor !== undefined ? { amountMinor } : {}) }, { session });
}
async function expensePage(c: Collections, familyId: string, cursor?: string) {
  const filter: Filter<Expense> = { familyId, deletedAt: null };
  if (cursor) {
    const parsed = parseCursor(cursor);
    filter.$or = [
      { date: { $lt: parsed.date } },
      { date: parsed.date, createdAt: { $lt: parsed.createdAt } },
      { date: parsed.date, createdAt: parsed.createdAt, _id: { $lt: parsed.id } }
    ];
  }
  const records = await c.expenses.find(filter).sort({ date: -1, createdAt: -1, _id: -1 }).limit(501).toArray();
  const expenses = records.slice(0,500);
  return { expenses, nextCursor: records.length > 500 ? expenseCursor(expenses.at(-1)!) : null };
}
async function verifyDataRevision(c: Collections, familyId: string, person: Person, revision: number) {
  const { family } = await memberFamily(c, familyId, person);
  if ((family.accessRevision ?? 0) !== revision) fail(409, "refreshRequired");
}

export async function budgetService(person: Person, method: string, path: string[], url: URL, body?: unknown) {
  const c = await collections();
  const user = await c.users.findOne({ _id: person.id });
  if (!user) fail(401, "signInRequired");
  // Use the current verified login profile; email-bound invitations follow this profile.
  person = { id: user._id, name: user.name, email: user.email };
  const minute = Math.floor(Date.now() / 60_000);
  const rate = await c.rates.findOneAndUpdate({ _id: `${person.id}:${minute}` }, {
    $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((minute + 2) * 60_000) }
  }, { upsert: true, returnDocument: "after" });
  if ((rate?.count ?? 0) > 120) fail(429, "tooManyRequests");

  if (path[0] === "families" && path.length === 1) {
    if (method === "GET") {
      const families = await c.families.find({ "members.userId": person.id }).sort({ createdAt: 1 }).toArray();
      return { families, user: person };
    }
    if (method === "POST") {
      const input = familySchema.parse(body);
      const client = await mongoClient();
      return client.withSession(session => session.withTransaction(async () => {
        const updated = await c.users.updateOne({ _id: person.id, familyCount: { $lt: 5 } }, { $inc: { familyCount: 1 } }, { session });
        if (!updated.matchedCount) fail(400, "familyLimit");
        const family: Family = { _id: randomUUID(), ...input, ownerId: person.id,
          members: [{ userId: person.id, name: person.name, email: person.email, role: "owner" }], createdAt: new Date().toISOString() };
        await c.families.insertOne(family, { session });
        await logActivity(c, person, family._id, "familyCreated", input.name, session);
        return { family };
      }));
    }
  }

  if (path[0] === "join" && path.length === 1 && method === "POST") {
    if (!body || typeof body !== "object" || !("token" in body) || typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) fail(400, "inviteInvalid");
    const tokenHash = hashToken(body.token);
    const client = await mongoClient();
    return client.withSession(session => session.withTransaction(async () => {
      const invite = await c.invitations.findOne({ tokenHash, consumedAt: null, revokedAt: null, expiresAt: { $gt: new Date().toISOString() } }, { session });
      if (!invite) fail(400, "inviteInvalid");
      if (invite.email !== person.email) fail(403, "inviteEmailMismatch");
      const family = await c.families.findOne({ _id: invite.familyId }, { session });
      if (!family) fail(404, "familyNotFound");
      if (!family.members.some(member => member.userId === person.id)) {
        if (family.members.length >= 20) fail(400, "memberLimit");
        await c.families.updateOne({ _id: family._id }, { $push: { members: { userId: person.id, name: person.name, email: person.email, role: invite.role } }, $inc: { accessRevision: 1 } }, { session });
        await logActivity(c, person, family._id, "memberJoined", person.name, session);
      }
      await c.invitations.updateOne({ _id: invite._id, consumedAt: null }, { $set: { consumedAt: new Date().toISOString() } }, { session });
      return { familyId: family._id };
    }));
  }

  if (path[0] !== "families" || path.length < 3 || path.length > 4) fail(404, "notFound");
  const familyId = assertId(path[1]);
  const resource = path[2];
  if (method === "GET" && (resource === "snapshot" || resource === "expenses") && path.length === 3) {
    const { family, member } = await memberFamily(c, familyId, person);
    const dataRevision = family.accessRevision ?? 0;
    if (resource === "expenses") {
      if (url.searchParams.get("dataRevision") !== String(dataRevision)) fail(409, "refreshRequired");
      const page = await expensePage(c, familyId, url.searchParams.get("cursor") || undefined);
      await verifyDataRevision(c, familyId, person, dataRevision);
      return { ...page, dataRevision };
    }
    const [budgets, page, plans, activity, invites] = await Promise.all([
      c.budgets.find({ familyId }).sort({ month: -1 }).toArray(), expensePage(c, familyId),
      c.plans.find({ familyId }).sort({ createdAt: -1 }).toArray(),
      c.activities.find({ familyId }).sort({ at: -1 }).limit(20).toArray(),
      canManage(member.role) ? c.invitations.find({ familyId, consumedAt: null, revokedAt: null, expiresAt: { $gt: new Date().toISOString() } }, { projection: { _id: 1, email: 1, role: 1, expiresAt: 1 } }).toArray() : []
    ]);
    await verifyDataRevision(c, familyId, person, dataRevision);
    // Transport source rows only. Periods, sums, inherited limits and payment schedules are calculated by the browser.
    return { family, budgets, ...page, plans, activity, invitations: invites, dataRevision };
  }

  if (resource === "settings" && method === "PUT" && path.length === 3) {
    const input = settingsSchema.parse(body);
    return withFamily(person, familyId, async (c, family, member, session) => {
      if (!canManage(member.role)) fail(403, "forbidden");
      if ((family.settingsRevision ?? 0) !== input.revision) fail(409, "conflict");
      await c.families.updateOne({ _id: familyId }, { $set: { budgetStartDay: input.budgetStartDay, settingsRevision: input.revision + 1 } }, { session });
      await logActivity(c, person, familyId, "cycleUpdated", String(input.budgetStartDay), session);
      return { ok: true };
    });
  }

  if (resource === "plans") {
    if (method === "POST" && path.length === 3) {
      const input = planSchema.parse(body);
      return withFamily(person, familyId, async (c, family, member, session) => {
        if (!canAdd(member.role)) fail(403, "forbidden");
        if (!family.members.some(item => item.userId === input.payerId)) fail(400, "payerInvalid");
        if (await c.plans.countDocuments({ familyId }, { session }) >= 500) fail(400, "planLimit");
        const now = new Date().toISOString();
        const plan: InstallmentPlan = { _id: randomUUID(), familyId, ...input, authorId: person.id,
          revision: 1, createdAt: now, updatedAt: now, cancelledFrom: null };
        await c.plans.insertOne(plan, { session });
        await logActivity(c, person, familyId, "planCreated", input.title, session);
        return { plan };
      });
    }
    if ((method === "PATCH" || method === "DELETE") && path.length === 4) {
      const planId = assertId(path[3]);
      const input = method === "PATCH" ? updatePlanSchema.parse(body) : cancelPlanSchema.parse(body);
      return withFamily(person, familyId, async (c, family, member, session) => {
        const previous = await c.plans.findOne({ _id: planId, familyId }, { session });
        if (!previous) fail(404, "planNotFound");
        if (!canEdit(member.role, person.id, previous.authorId)) fail(403, "forbidden");
        if (previous.revision !== input.revision) fail(409, "conflict");
        if (previous.cancelledFrom) fail(400, "planClosed");
        const now = new Date().toISOString();
        if (method === "DELETE") {
          const cancel = cancelPlanSchema.parse(input);
          if (cancel.cancelledFrom < todayLocal()) fail(400, "invalidInput");
          await c.plans.updateOne({ _id: planId, familyId, revision: input.revision }, {
            $set: { cancelledFrom: cancel.cancelledFrom, updatedAt: now }, $inc: { revision: 1 }
          }, { session });
          await logActivity(c, person, familyId, "planCancelled", previous.title, session);
        } else {
          const changed = updatePlanSchema.parse(input);
          if (!family.members.some(item => item.userId === changed.payerId) && changed.payerId !== previous.payerId) fail(400, "payerInvalid");
          const { revision, ...fields } = changed;
          await c.plans.updateOne({ _id: planId, familyId, revision }, { $set: { ...fields, updatedAt: now }, $inc: { revision: 1 } }, { session });
          await logActivity(c, person, familyId, "planUpdated", changed.title, session);
        }
        return { ok: true };
      });
    }
  }

  if (resource === "expenses") {
    if (method === "POST" && path.length === 3) {
      const input = expenseSchema.parse(body);
      return withFamily(person, familyId, async (c, family, member, session) => {
        if (!canAdd(member.role)) fail(403, "forbidden");
        if (!family.members.some(item => item.userId === input.payerId)) fail(400, "payerInvalid");
        const now = new Date().toISOString();
        const expense: Expense = { _id: randomUUID(), familyId, ...input, authorId: person.id, revision: 1, createdAt: now, updatedAt: now, deletedAt: null };
        await c.expenses.insertOne(expense, { session });
        await logActivity(c, person, familyId, "expenseAdded", input.title, session, input.amountMinor);
        return { expense };
      });
    }
    if ((method === "PATCH" || method === "DELETE") && path.length === 4) {
      const expenseId = assertId(path[3]);
      const input = method === "PATCH" ? updateExpenseSchema.parse(body) : revisionSchema.parse(body);
      return withFamily(person, familyId, async (c, family, member, session) => {
        const previous = await c.expenses.findOne({ _id: expenseId, familyId, deletedAt: null }, { session });
        if (!previous) fail(404, "expenseNotFound");
        if (!canEdit(member.role, person.id, previous.authorId)) fail(403, "forbidden");
        if (previous.revision !== input.revision) fail(409, "conflict");
        const now = new Date().toISOString();
        if (method === "DELETE") {
          await c.expenses.updateOne({ _id: expenseId, familyId, revision: input.revision }, { $set: { deletedAt: now, updatedAt: now }, $inc: { revision: 1 } }, { session });
          await logActivity(c, person, familyId, "expenseDeleted", previous.title, session, previous.amountMinor);
        } else {
          const changed = updateExpenseSchema.parse(input);
          if (!family.members.some(item => item.userId === changed.payerId) && changed.payerId !== previous.payerId) fail(400, "payerInvalid");
          const { revision, ...fields } = changed;
          await c.expenses.updateOne({ _id: expenseId, familyId, revision }, { $set: { ...fields, updatedAt: now }, $inc: { revision: 1 } }, { session });
          await logActivity(c, person, familyId, "expenseUpdated", changed.title, session, changed.amountMinor);
        }
        return { ok: true };
      });
    }
  }

  if (resource === "budget" && method === "PUT" && path.length === 3) {
    const input = budgetSchema.parse(body);
    return withFamily(person, familyId, async (c, _family, member, session) => {
      if (!canManage(member.role)) fail(403, "forbidden");
      const previous = await c.budgets.findOne({ familyId, month: input.month }, { session });
      if ((previous?.revision ?? 0) !== input.revision) fail(409, "conflict");
      const budget: MonthBudget = { _id: previous?._id ?? randomUUID(), familyId, ...input, revision: input.revision + 1 };
      if (previous) await c.budgets.replaceOne({ _id: previous._id, revision: previous.revision }, budget, { session });
      else await c.budgets.insertOne(budget, { session });
      await logActivity(c, person, familyId, "budgetUpdated", input.month, session, input.totalMinor);
      return { budget };
    });
  }

  if (resource === "invitations") {
    if (method === "POST" && path.length === 3) {
      const input = inviteSchema.parse(body);
      return withFamily(person, familyId, async (c, family, member, session) => {
        if (!canManage(member.role) || (input.role === "admin" && member.role !== "owner")) fail(403, "forbidden");
        if (family.members.some(item => item.email === input.email)) fail(400, "alreadyMember");
        if (family.members.length >= 20) fail(400, "memberLimit");
        const active = { familyId, consumedAt: null, revokedAt: null, expiresAt: { $gt: new Date().toISOString() } };
        if (await c.invitations.countDocuments(active, { session }) >= 20) fail(400, "inviteLimit");
        // Replacing an invitation invalidates earlier links for that address.
        await c.invitations.updateMany({ ...active, email: input.email }, { $set: { revokedAt: new Date().toISOString() } }, { session });
        const token = randomBytes(32).toString("hex");
        const invitation: Invitation = { _id: randomUUID(), familyId, ...input, tokenHash: hashToken(token), createdBy: person.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), consumedAt: null, revokedAt: null };
        await c.invitations.insertOne(invitation, { session });
        await logActivity(c, person, familyId, "inviteCreated", input.email, session);
        return { token, invitation: { _id: invitation._id, email: input.email, role: input.role, expiresAt: invitation.expiresAt } };
      });
    }
    if (method === "DELETE" && path.length === 4) {
      const invitationId = assertId(path[3]);
      return withFamily(person, familyId, async (c, _family, member, session) => {
        const invite = await c.invitations.findOne({ _id: invitationId, familyId, consumedAt: null, revokedAt: null }, { session });
        if (!invite) fail(404, "inviteInvalid");
        if (!canManage(member.role) || (invite.role === "admin" && member.role !== "owner")) fail(403, "forbidden");
        await c.invitations.updateOne({ _id: invitationId, familyId }, { $set: { revokedAt: new Date().toISOString() } }, { session });
        await logActivity(c, person, familyId, "inviteRevoked", invite.email, session);
        return { ok: true };
      });
    }
  }

  if (resource === "members" && path.length === 4 && (method === "PATCH" || method === "DELETE")) {
    const memberId = assertId(path[3]);
    const nextRole = method === "PATCH" ? memberSchema.parse(body).role : undefined;
    return withFamily(person, familyId, async (c, family, actor, session) => {
      const target = family.members.find(member => member.userId === memberId);
      if (!target) fail(404, "memberNotFound");
      if (!canChangeMember(actor.role, target.role, nextRole)) fail(403, "forbidden");
      if (method === "DELETE") {
        await c.families.updateOne({ _id: familyId }, { $pull: { members: { userId: memberId } } }, { session });
        await c.invitations.updateMany({ familyId, $or: [{ email: target.email }, { createdBy: memberId }], consumedAt: null, revokedAt: null }, { $set: { revokedAt: new Date().toISOString() } }, { session });
        await logActivity(c, person, familyId, "memberRemoved", target.name, session);
      } else {
        await c.families.updateOne({ _id: familyId, "members.userId": memberId }, { $set: { "members.$.role": nextRole! } }, { session });
        if (canManage(target.role) && nextRole && !canManage(nextRole)) {
          await c.invitations.updateMany({ familyId, createdBy: memberId, consumedAt: null, revokedAt: null }, { $set: { revokedAt: new Date().toISOString() } }, { session });
        }
        await logActivity(c, person, familyId, "roleUpdated", `${target.name}: ${nextRole}`, session);
      }
      return { ok: true };
    });
  }
  fail(404, "notFound");
}

export function safeError(error: unknown) {
  if (error instanceof HttpError) return { status: error.status, code: error.code };
  if (error instanceof ZodError) return { status: 400, code: error.issues.some(issue => issue.message === "categoryBudgetExceeded") ? "categoryBudgetExceeded" : error.issues.some(issue => issue.message === "invalidPlan") ? "invalidPlan" : "invalidInput" };
  if (error instanceof Error && error.message === "invalidInput") return { status: 400, code: "invalidInput" };
  // Never log exception messages or connection objects: they may contain database credentials.
  console.error("Budget request failed:", error instanceof Error ? error.name : "UnknownError");
  return { status: 503, code: "databaseUnavailable" };
}
