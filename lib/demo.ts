import type { Person, RawSnapshot } from "./domain";

export const demoUser: Person = { id: "demo-anna", name: "Анна", email: "anna@example.com" };
export function demoRawSnapshot(month: string): RawSnapshot {
  return {
    dataRevision: 0,
    family: { _id: "demo-family", name: "Наш семейный бюджет", currency: "ILS", ownerId: demoUser.id, budgetStartDay: 10, settingsRevision: 0,
      members: [{ userId: demoUser.id, name: "Анна", email: demoUser.email, role: "owner" },
        { userId: "demo-alex", name: "Алексей", email: "alex@example.com", role: "contributor" },
        { userId: "demo-maria", name: "Мария", email: "maria@example.com", role: "viewer" }], createdAt: `${month}-01T10:00:00.000Z` },
    budgets: [{ _id: "demo-budget", familyId: "demo-family", month, totalMinor: 1_200_000,
      categoryLimits: { food: 300_000, home: 500_000, transport: 100_000, bills: 100_000, leisure: 100_000 }, revision: 1 }],
    expenses: [
      { _id: "demo-1", familyId: "demo-family", title: "Продукты на неделю", amountMinor: 38_650, category: "food", date: `${month}-11`, payerId: "demo-anna", authorId: "demo-anna", account: "Карта", note: "", revision: 1, createdAt: `${month}-11T12:00:00.000Z`, updatedAt: `${month}-11T12:00:00.000Z`, deletedAt: null },
      { _id: "demo-2", familyId: "demo-family", title: "Заправка", amountMinor: 27_000, category: "transport", date: `${month}-10`, payerId: "demo-alex", authorId: "demo-alex", account: "Карта", note: "", revision: 1, createdAt: `${month}-10T12:00:00.000Z`, updatedAt: `${month}-10T12:00:00.000Z`, deletedAt: null },
      { _id: "demo-3", familyId: "demo-family", title: "Интернет", amountMinor: 12_900, category: "bills", date: `${month}-09`, payerId: "demo-anna", authorId: "demo-anna", account: "Карта", note: "", revision: 1, createdAt: `${month}-09T12:00:00.000Z`, updatedAt: `${month}-09T12:00:00.000Z`, deletedAt: null },
      { _id: "demo-4", familyId: "demo-family", title: "Кофе вдвоём", amountMinor: 8_400, category: "leisure", date: `${month}-08`, payerId: "demo-alex", authorId: "demo-alex", account: "Наличные", note: "", revision: 1, createdAt: `${month}-08T12:00:00.000Z`, updatedAt: `${month}-08T12:00:00.000Z`, deletedAt: null },
      { _id: "demo-5", familyId: "demo-family", title: "Аренда", amountMinor: 480_000, category: "home", date: `${month}-01`, payerId: "demo-anna", authorId: "demo-anna", account: "Перевод", note: "", revision: 1, createdAt: `${month}-01T12:00:00.000Z`, updatedAt: `${month}-01T12:00:00.000Z`, deletedAt: null }
    ],
    nextCursor: null,
    plans: [{ _id: "demo-plan", familyId: "demo-family", title: "Ноутбук в рассрочку", totalMinor: 360_000,
      paymentCount: 12, firstDate: `${month}-15`, category: "shopping", payerId: "demo-anna", authorId: "demo-anna",
      account: "Карта", note: "Без процентов", revision: 1, cancelledFrom: null,
      createdAt: `${month}-01T12:00:00.000Z`, updatedAt: `${month}-01T12:00:00.000Z` }],
    activity: [{ _id: "demo-activity", familyId: "demo-family", actorId: demoUser.id, actorName: demoUser.name,
      action: "expenseAdded", title: "Продукты на неделю", amountMinor: 38_650, at: `${month}-11T12:00:00.000Z` }], invitations: []
  };
}
