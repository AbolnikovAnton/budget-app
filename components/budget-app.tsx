"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { getSession, signIn, signOut } from "next-auth/react";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronRight, CircleHelp, CreditCard, Home, LayoutDashboard, List, LoaderCircle, LogOut, Moon, MoreHorizontal, Pencil, Plus, RefreshCw, ShieldCheck, Sun, Trash2, Users, Wallet, X, History, Search, Copy, Leaf, Repeat } from "lucide-react";
import {
  categories, currencies, type Category, type Currency, type Expense, type Family, type Language,
  type Person, type Role, type Snapshot, type RawSnapshot, type InstallmentPlan, type ScheduledPayment, canAdd, canChangeMember, canEdit, canManage,
  minorInput, money, todayLocal, toMinor, budgetMonthForDate, budgetPeriod, planSchema
} from "@/lib/domain";
import { translate } from "@/lib/i18n";
import { demoRawSnapshot, demoUser } from "@/lib/demo";
import { calculateSnapshot } from "@/lib/calculators";
import PaymentPlans from "@/components/payment-plans";
import PlanFields from "@/components/plan-fields";

type Tab = "overview" | "expenses" | "budgets" | "plans" | "family" | "history";
type Dialog = { kind: "plan"; plan?: InstallmentPlan } | { kind: "cancelPlan"; plan: InstallmentPlan } | { kind: "expense"; expense?: Expense } | { kind: "budget" } | { kind: "settings" } | { kind: "invite" } | { kind: "create" } |
  { kind: "deleteExpense"; expense: Expense } | { kind: "removeMember"; userId: string; name: string };

class ApiError extends Error { constructor(public code: string, public status: number) { super(code); } }
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/budget/${path}`, { method, cache: "no-store", credentials: "same-origin",
    ...(method !== "GET" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) } : {}) });
  let data;
  try { data = await response.json(); } catch { throw new ApiError("connectionError", response.status); }
  if (!response.ok) throw new ApiError(data.error || "connectionError", response.status);
  return data as T;
}

export default function BudgetApp({ authConfigured, initialMonth, demo = false }: { authConfigured: boolean; initialMonth: string; demo?: boolean }) {
  const [language, setLanguage] = useState<Language>("ru");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [user, setUser] = useState<Person | null>(demo ? demoUser : null);
  const [authLoading, setAuthLoading] = useState(!demo && authConfigured);
  const [families, setFamilies] = useState<Family[]>([]);
  const [familyId, setFamilyId] = useState(demo ? "demo-family" : "");
  const [month, setMonth] = useState(initialMonth);
  const [rawSnapshot, setRawSnapshot] = useState<RawSnapshot | null>(demo ? demoRawSnapshot(initialMonth) : null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [memberBusy, setMemberBusy] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [payerFilter, setPayerFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(100);
  const [demoStartDay, setDemoStartDay] = useState(10);
  const sequence = useRef(0);
  const followCurrentPeriod = useRef(true);
  const previousFamilyId = useRef("");
  const selectedFamily = rawSnapshot?.family._id === familyId ? rawSnapshot.family : families.find(item => item._id === familyId);
  const startDay = demo ? demoStartDay : selectedFamily?.budgetStartDay ?? 1;
  const snapshot = useMemo(() => rawSnapshot?.family._id === familyId ? calculateSnapshot(rawSnapshot, month, startDay) : null, [rawSnapshot, month, startDay, familyId]);
  const t = (key: string) => translate(language, key);

  useEffect(() => {
    try {
      const storedLanguage = localStorage.getItem("budget-language");
      if (storedLanguage === "ru" || storedLanguage === "en") setLanguage(storedLanguage);
      if (localStorage.getItem("budget-theme") === "light") setTheme("light");
    } catch { /* Preferences are optional when browser storage is blocked. */ }
    setPreferencesReady(true);
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    if (token && /^[a-f0-9]{64}$/.test(token)) setInviteToken(token);
    if (params.has("error")) setError("loginError");
  }, []);
  useEffect(() => {
    if (!familyId) return;
    if (previousFamilyId.current !== familyId) {
      previousFamilyId.current = familyId;
      followCurrentPeriod.current = true;
    }
    if (followCurrentPeriod.current) setMonth(budgetMonthForDate(todayLocal(), startDay));
  }, [familyId, startDay]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language;
    if (preferencesReady) try { localStorage.setItem("budget-theme", theme); localStorage.setItem("budget-language", language); } catch { /* Optional preference storage. */ }
  }, [theme, language, preferencesReady]);

  const loadFamilies = useCallback(async () => {
    const result = await api<{ families: Family[]; user: Person }>("families");
    setFamilies(result.families); setUser(result.user);
    setFamilyId(current => result.families.some(family => family._id === current) ? current : result.families[0]?._id || "");
    return result;
  }, []);
  useEffect(() => {
    if (demo || !authConfigured) return;
    let active = true;
    (async () => {
      try {
        const session = await getSession();
        if (!active) return;
        if (session?.user.id && session.user.email) await loadFamilies();
      } catch (issue) { if (active) setError(issue instanceof ApiError ? issue.code : "connectionError"); }
      finally { if (active) setAuthLoading(false); }
    })();
    return () => { active = false; };
  }, [demo, authConfigured, loadFamilies]);

  const reload = useCallback(async (silent = false) => {
    if (!familyId) return;
    const current = ++sequence.current;
    if (demo) { setRawSnapshot(demoRawSnapshot(initialMonth)); return; }
    if (!silent) setLoading(true);
    try {
      let result: RawSnapshot | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const data = await api<RawSnapshot>(`families/${familyId}/snapshot`);
          while (data.nextCursor) {
            if (current !== sequence.current) return;
            const page = await api<{ expenses: Expense[]; nextCursor: string | null }>(`families/${familyId}/expenses?dataRevision=${data.dataRevision}&cursor=${encodeURIComponent(data.nextCursor)}`);
            data.expenses.push(...page.expenses);
            data.nextCursor = page.nextCursor;
          }
          result = data;
          break;
        } catch (issue) {
          if (!(issue instanceof ApiError && issue.code === "refreshRequired" && attempt < 2)) throw issue;
        }
      }
      if (!result || current !== sequence.current) return;
      setRawSnapshot(result);
      setFamilies(items => items.map(item => item._id === result!.family._id ? result!.family : item));
      setSyncedAt(new Date());
    } catch (issue) {
      if (current !== sequence.current) return;
      const code = issue instanceof ApiError ? issue.code : "connectionError";
      setError(code);
      if (code === "familyNotFound" || code === "signInRequired") {
        setRawSnapshot(null);
        if (code === "signInRequired") { setUser(null); setFamilyId(""); }
        else await loadFamilies().catch(() => {});
      }
    } finally { if (current === sequence.current) setLoading(false); }
  }, [familyId, demo, initialMonth, loadFamilies]);
  useEffect(() => {
    if (!familyId) return;
    setRawSnapshot(demo ? demoRawSnapshot(initialMonth) : null);
    void reload();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void reload(true); }, 30_000);
    const focus = () => void reload(true);
    window.addEventListener("focus", focus);
    return () => { sequence.current++; clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [familyId, demo, initialMonth, reload]);
  useEffect(() => {
    const advance = () => {
      if (followCurrentPeriod.current) setMonth(budgetMonthForDate(todayLocal(), startDay));
    };
    const timer = setInterval(advance, 30_000);
    window.addEventListener("focus", advance);
    return () => { clearInterval(timer); window.removeEventListener("focus", advance); };
  }, [startDay]);
  useEffect(() => { setSearch(""); setCategoryFilter(""); setPayerFilter(""); setVisibleCount(100); setDialog(null); }, [familyId, month]);

  async function changeMember(memberId: string, nextRole?: Exclude<Role, "owner">) {
    if (demo) { setError("demoDisabled"); return; }
    setMemberBusy(memberId);
    try {
      await api(`families/${familyId}/members/${memberId}`, nextRole ? "PATCH" : "DELETE", nextRole ? { role: nextRole } : {});
      await reload();
    } catch (issue) { setError(issue instanceof ApiError ? issue.code : "connectionError"); }
    finally { setMemberBusy(""); }
  }
  async function joinFamily() {
    setJoinBusy(true); setError("");
    try {
      const result = await api<{ familyId: string }>("join", "POST", { token: inviteToken });
      await loadFamilies(); setFamilyId(result.familyId); setInviteToken("");
      window.history.replaceState(null, "", "/");
    } catch (issue) { setError(issue instanceof ApiError ? issue.code : "connectionError"); }
    finally { setJoinBusy(false); }
  }
  function loadMore() { setVisibleCount(count => count + 100); }

  const themeControls = <div className="appearance-controls">
    <button className="quiet-button language-button" onClick={() => setLanguage(language === "ru" ? "en" : "ru")} aria-label={language === "ru" ? "Switch to English" : "Переключить на русский"}>{language === "ru" ? "EN" : "RU"}</button>
    <button className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={t(theme === "dark" ? "lightTheme" : "darkTheme")}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
  </div>;
  const brand = <div className="brand"><span className="brand-mark"><Leaf size={22} /></span><div>{t("brand")}<small>{t("tagline")}</small></div></div>;
  const errorBox = error && <div className="error-banner" role="alert"><span>{t(error)}</span><button className="icon-button" onClick={() => setError("")} aria-label={t("close")}><X size={17} /></button></div>;

  if (authLoading) return <main className="loading-screen">{brand}<LoaderCircle className="spinner" /><p>{t("loading")}</p></main>;
  if (!user) return <div className="login-shell">
    <header className="login-header">{brand}{themeControls}</header>
    <main className="login-main"><section className="login-copy"><div className="eyebrow"><ShieldCheck size={15} /> {language === "ru" ? "Ваш общий бюджет" : "Your shared budget"}</div><h1>{inviteToken ? t("joinTitle") : t("welcome")}</h1><p className="login-description">{inviteToken ? t("joinText") : t("welcomeText")}</p>
      {errorBox}<button className="button primary google-button" disabled={!authConfigured} onClick={() => void signIn("google", { redirectTo: inviteToken ? `/?invite=${inviteToken}` : "/" })}><span className="google-letter" aria-hidden="true">G</span>{t("signIn")}</button>
      <p className="small muted">{authConfigured ? t("googlePrivacy") : t("unavailable")}</p><Link className="demo-link" href="/demo">{t("seeDemo")} <ArrowUpRight size={16} /></Link>
    </section><section className="login-preview" aria-label={t("seeDemo")}><div className="preview-top"><span className="small muted">{t("monthBudget")}</span><span className="sample-label">{language === "ru" ? "Пример · ILS" : "Sample · ILS"}</span></div><div className="preview-amount">₪12,000<span>.00</span></div><div className="preview-line"><span>{t("remaining")}</span><strong>₪6,330.50</strong></div><div className="budget-track"><span style={{ width: "47.25%" }} /></div><div className="preview-categories">{["food", "home", "transport"].map((category, i) => <div key={category}><span className={`category-symbol category-${category}`}><CategoryIcon category={category as Category} /></span><span>{t(category)}</span><div className="mini-track"><span style={{ width: `${[45, 80, 27][i]}%` }} /></div></div>)}</div><div className="preview-people"><span className="avatar">А</span><span className="avatar">А</span><span className="small muted">{language === "ru" ? "Всё складывается вместе" : "It all adds up, together"}</span></div></section></main>
  </div>;

  const family = snapshot?.family || selectedFamily;
  const role = family?.members.find(member => member.userId === user.id)?.role ?? "viewer";
  const formatMoney = (value: number) => money(value, family?.currency ?? "ILS", language);
  const personName = (id: string) => family?.members.find(member => member.userId === id)?.name || t("removedPerson");
  const displayDate = (date: string) => new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00`));
  const period = snapshot?.period || budgetPeriod(month, startDay);
  const periodDate = (date: string) => new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${date}T12:00:00`));
  const expenseTitle = (expense: Expense) => demo && language === "en" ? ({ "Продукты на неделю": "Weekly groceries", "Заправка": "Fuel", "Интернет": "Internet", "Кофе вдвоём": "Coffee together", "Аренда": "Rent" }[expense.title] || expense.title) : expense.title;
  const filtered = snapshot?.expenses.filter(expense => (!search || `${expenseTitle(expense)} ${expense.title} ${expense.note} ${expense.account}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && (!categoryFilter || expense.category === categoryFilter) && (!payerFilter || expense.payerId === payerFilter)) || [];
  const navItems: { tab: Tab; icon: typeof Home }[] = [{ tab: "overview", icon: LayoutDashboard }, { tab: "expenses", icon: List }, { tab: "budgets", icon: Wallet }, { tab: "plans", icon: Repeat }, { tab: "family", icon: Users }, { tab: "history", icon: History }];

  function ExpenseList({ expenses, compact = false }: { expenses: Expense[]; compact?: boolean }) {
    if (!expenses.length) return <div className="empty-state"><span className="empty-icon"><Wallet size={25} /></span><h3>{search || categoryFilter || payerFilter ? t("noResults") : t("noExpenses")}</h3><p>{t("noExpensesText")}</p>{canAdd(role) && <button className="button secondary" onClick={() => setDialog({ kind: "expense" })}><Plus size={16} />{t("addExpense")}</button>}</div>;
    return <div className="expense-list">{expenses.map(expense => {
      const scheduled = "planId" in expense ? expense as ScheduledPayment : null;
      const plan = scheduled ? snapshot?.plans.find(item => item._id === scheduled.planId) : undefined;
      return <div className="expense-row" key={expense._id}>
      <span className={`category-symbol category-${expense.category}`}><CategoryIcon category={expense.category} /></span>
      <div className="expense-detail"><strong>{expenseTitle(expense)}</strong><span className="small muted">{t(expense.category)} · {personName(expense.payerId)}{!compact && ` · ${displayDate(expense.date)}`}</span>{scheduled && <span className="automatic-tag">{t("automaticPayment")} · {scheduled.paymentNumber} {t("ofPayments")} {scheduled.paymentCount}</span>}{!compact && expense.note && <span className="expense-note">{expense.note}</span>}{!compact && <span className="tiny muted">{t("author")}: {personName(expense.authorId)}{expense.account && ` · ${expense.account}`}</span>}</div>
      <strong className="expense-amount">{formatMoney(expense.amountMinor)}</strong>
      {!compact && canEdit(role, user!.id, expense.authorId) && (!plan || !plan.cancelledFrom) && <div className="row-actions"><button className="icon-button" aria-label={`${t(scheduled ? "editPlan" : "editExpense")}: ${expenseTitle(expense)}`} onClick={() => plan ? setDialog({ kind: "plan", plan }) : setDialog({ kind: "expense", expense })}><Pencil size={15} /></button><button className="icon-button" aria-label={`${t(scheduled ? "cancelPlan" : "delete")}: ${expenseTitle(expense)}`} onClick={() => plan ? setDialog({ kind: "cancelPlan", plan }) : setDialog({ kind: "deleteExpense", expense })}><Trash2 size={15} /></button></div>}
    </div>; })}</div>;
  }

  return <div className="app-shell">
    <aside className="sidebar">{brand}<div className="family-picker"><label className="small muted" htmlFor="family-select">{t("family")}</label><select id="family-select" value={familyId} onChange={event => event.target.value === "__create__" ? setDialog({ kind: "create" }) : setFamilyId(event.target.value)}>{demo ? <option value="demo-family">{language === "ru" ? "Наш семейный бюджет" : "Our family budget"}</option> : families.map(item => <option key={item._id} value={item._id}>{item.name}</option>)}{!families.length && !demo && <option value="">—</option>}<option value="__create__">＋ {t("newFamily")}</option></select></div>
      <nav className="main-nav" aria-label={t("mobileNav")}>{navItems.map(({ tab: item, icon: Icon }) => <button key={item} className={tab === item ? "nav-item active" : "nav-item"} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}><Icon size={19} /><span>{t(item)}</span>{tab === item && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><button className="quiet-button create-family-link" onClick={() => setDialog({ kind: "create" })}><Plus size={16} />{t("newFamily")}</button><div className="user-profile"><span className="avatar">{user.name[0]?.toUpperCase()}</span><div><strong>{user.name}</strong><span className="tiny muted">{t(role)}</span></div><button className="icon-button" aria-label={t("signOut")} onClick={() => demo ? window.location.assign("/") : void signOut({ redirectTo: inviteToken ? `/?invite=${inviteToken}` : "/" })}><LogOut size={16} /></button></div></div>
    </aside>
    <div className="app-content"><header className="topbar"><div className="breadcrumb"><span>{demo ? t("family") : family?.name || t("family")}</span><ChevronRight size={14} /><strong>{t(tab)}</strong></div>{themeControls}</header>
    <main className="workspace">
      {demo && <div className="demo-banner"><CircleHelp size={16} /><span>{t("demo")}</span><Link href="/">{t("backLogin")}</Link></div>}{errorBox}
      {inviteToken && <section className="join-card"><Users size={24} /><div><h3>{t("joinTitle")}</h3><p className="small muted">{t("joinText")} ({user.email})</p></div><button className="button primary" disabled={joinBusy} onClick={() => void joinFamily()}>{joinBusy ? <LoaderCircle size={16} className="spinner" /> : <Plus size={16} />}{t("acceptInvite")}</button><button className="quiet-button" onClick={() => { setInviteToken(""); window.history.replaceState(null, "", "/"); }}>{t("declineInvite")}</button></section>}
      {!familyId ? <section className="onboarding"><span className="empty-icon"><Home size={30} /></span><h1>{t("createFamily")}</h1><p>{t("createText")}</p><button className="button primary" onClick={() => setDialog({ kind: "create" })}><Plus size={17} />{t("createFamily")}</button></section> : <>
      <div className="page-heading"><div><div className="eyebrow">{language === "ru" ? "Всё под контролем" : "A clear view"}</div><h1>{tab === "overview" ? t("thisMonth") : t(tab)}</h1></div><div className="heading-actions">{["overview", "expenses", "budgets"].includes(tab) && <label className="month-picker"><span className="sr-only">{t("thisMonth")}</span><input type="month" value={month} min="2000-01" max="2099-12" onChange={event => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value)) { followCurrentPeriod.current = event.target.value === budgetMonthForDate(todayLocal(), startDay); setMonth(event.target.value); } }} /></label>}{canAdd(role) && <button className="button primary" disabled={!snapshot} onClick={() => setDialog(tab === "plans" ? { kind: "plan" } : { kind: "expense" })}><Plus size={17} />{t(tab === "plans" ? "addPlan" : "addExpense")}</button>}</div></div>
      {["overview", "expenses", "budgets"].includes(tab) && <div className="period-toolbar"><span className="small muted">{periodDate(period.start)} — {periodDate(period.end)}</span>{month !== budgetMonthForDate(todayLocal(), startDay) && <button className="text-button" onClick={() => { followCurrentPeriod.current = true; setMonth(budgetMonthForDate(todayLocal(), startDay)); }}>{t("currentPeriod")}</button>}</div>}
      {!snapshot ? <div className="loading-panel"><LoaderCircle className="spinner" /><p>{t("loading")}</p><button className="button secondary" disabled={loading} onClick={() => void reload()}>{t("refresh")}</button></div> : <>
      {tab === "overview" && <>
        <div className="stats-grid"><section className="stat-card"><div className="stat-label"><span>{t("spent")}</span><ArrowUpRight size={17} /></div><div className="stat-value">{formatMoney(snapshot.totalMinor)}</div><span className="small muted">{snapshot.count} {t("operations")}</span></section><section className="stat-card"><div className="stat-label"><span>{t("monthBudget")}</span><Wallet size={17} /></div><div className={`stat-value ${!snapshot.budget ? "stat-placeholder" : ""}`}>{snapshot.budget ? formatMoney(snapshot.budget.totalMinor) : t("notSet")}</div>{canManage(role) ? <button className="stat-link" onClick={() => setDialog({ kind: "budget" })}>{snapshot.budget ? t("editBudget") : t("setBudget")}<ChevronRight size={13} /></button> : <span className="small muted">{t("perMonth")}</span>}</section><section className="stat-card remaining-card"><div className="stat-label"><span>{snapshot.budget && snapshot.committedMinor > snapshot.budget.totalMinor ? t("overBudget") : t("remaining")}</span><ArrowDownLeft size={17} /></div><div className="stat-value">{snapshot.budget ? formatMoney(Math.abs(snapshot.budget.totalMinor - snapshot.committedMinor)) : "—"}</div><span className="small muted">{snapshot.budget && snapshot.budget.totalMinor > 0 ? `${Math.round(snapshot.committedMinor / snapshot.budget.totalMinor * 100)}% ${t("used")}` : t("notSet")}</span></section></div>
        {snapshot.scheduledMinor > 0 && <section className="scheduled-strip"><Repeat size={18} /><div><strong>{t("recurringThisPeriod")}: {formatMoney(snapshot.scheduledMinor)}</strong><p className="small muted">{t("recurringIncluded")}</p></div><button className="text-button" onClick={() => setTab("plans")}>{t("plans")}<ChevronRight size={14} /></button></section>}
        <div className="dashboard-grid"><section className="panel category-panel"><div className="panel-heading"><h2>{snapshot.budget ? t("limits") : t("breakdown")}</h2><Wallet size={17} className="muted" /></div>{categories.filter(category => (snapshot.committedCategoryTotals[category] || 0) > 0 || (snapshot.budget?.categoryLimits[category] || 0) > 0).map(category => {
          const value = snapshot.committedCategoryTotals[category] || 0;
          const limit = snapshot.budget?.categoryLimits[category] || 0;
          const denominator = limit || snapshot.committedMinor || 1;
          return <div className="category-budget-row" key={category}><div className="category-budget-heading"><span className="category-name"><CategoryIcon category={category} />{t(category)}</span><span className="small"><strong>{formatMoney(value)}</strong>{limit > 0 && <span className="muted"> / {formatMoney(limit)}</span>}</span></div><div className={`budget-track ${limit > 0 && value > limit ? "exceeded" : ""}`} role="progressbar" aria-label={t(category)} aria-valuenow={Math.min(100, Math.round(value / denominator * 100))} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, value / denominator * 100)}%` }} /></div></div>;
        })}{!snapshot.totalMinor && !snapshot.budget && <div className="empty-state compact"><h3>{t("noBudget")}</h3><p>{t("noBudgetText")}</p>{canManage(role) && <button className="button secondary" onClick={() => setDialog({ kind: "budget" })}>{t("setBudget")}</button>}</div>}</section><section className="panel recent-panel"><div className="panel-heading"><h2>{t("recent")}</h2><button className="text-button" onClick={() => setTab("expenses")}>{t("viewAll")}<ChevronRight size={14} /></button></div><ExpenseList expenses={snapshot.expenses.slice(0, 5)} compact /></section></div>
        <section className="family-strip"><div className="family-strip-avatars">{family?.members.slice(0, 4).map(member => <span className="avatar" key={member.userId}>{member.name[0]?.toUpperCase()}</span>)}</div><div><strong>{t("members")}: {family?.members.length}</strong><p className="small muted">{language === "ru" ? "Каждый расход — часть общей картины." : "Every expense is part of the bigger picture."}</p></div><button className="text-button" onClick={() => setTab("family")}>{t("family")}<ChevronRight size={14} /></button></section>
      </>}
      {tab === "expenses" && <section className="panel full-panel"><div className="expense-total"><span className="muted">{t("spent")}</span><strong>{formatMoney(snapshot.totalMinor)}</strong><span className="small muted">{snapshot.count} {t("operations")}</span></div><div className="filters"><label className="search-field"><Search size={17} /><input aria-label={t("search")} placeholder={t("search")} value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label={t("category")} value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="">{t("allCategories")}</option>{categories.map(category => <option key={category} value={category}>{t(category)}</option>)}</select><select aria-label={t("payer")} value={payerFilter} onChange={event => setPayerFilter(event.target.value)}><option value="">{t("allPeople")}</option>{family?.members.map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}</select></div><p className="tiny muted filter-note">{t("filterNote")}</p><ExpenseList expenses={filtered.slice(0,visibleCount)} /><div className="list-footer"><span className="small muted">{t("loaded")}: {Math.min(visibleCount,filtered.length)} / {filtered.length}</span>{visibleCount < filtered.length && <button className="button secondary" onClick={loadMore}>{t("loadMore")}</button>}</div></section>}
      {tab === "budgets" && <section className="panel cycle-panel"><div><h2>{t("cycleSettings")}</h2><p className="cycle-day">{startDay} <span className="small muted">{t("monthlyDay")}</span></p><p className="small muted">{t("cycleDescription")}</p></div>{canManage(role) && <button className="button secondary" onClick={() => setDialog({ kind: "settings" })}><Pencil size={16} />{t("changeCycle")}</button>}</section>}
      {tab === "budgets" && <section className="panel full-panel"><div className="panel-heading"><h2>{t("monthBudget")}</h2>{canManage(role) && <button className="button secondary" onClick={() => setDialog({ kind: "budget" })}><Pencil size={16} />{t("setBudget")}</button>}</div><div className="budget-summary"><div><span className="muted">{t("totalBudget")}</span><strong>{snapshot.budget ? formatMoney(snapshot.budget.totalMinor) : t("notSet")}</strong></div><div><span className="muted">{t("spent")}</span><strong>{formatMoney(snapshot.totalMinor)}</strong></div></div><p className="small muted">{canManage(role) ? t("budgetHelp") : t("readOnlyBudget")}</p>{snapshot.budget?.inheritedFromMonth && <p className="small muted">{t("inheritedBudget")}: {snapshot.budget.inheritedFromMonth}</p>}<div className="budget-category-grid">{categories.map(category => <div className="budget-category-card" key={category}><span className={`category-symbol category-${category}`}><CategoryIcon category={category} /></span><div><strong>{t(category)}</strong><span className="small muted">{t("spent")}: {formatMoney(snapshot.committedCategoryTotals[category] || 0)}</span></div><span>{snapshot.budget?.categoryLimits[category] ? formatMoney(snapshot.budget.categoryLimits[category]!) : "—"}</span></div>)}</div></section>}
      {tab === "plans" && <PaymentPlans plans={snapshot.plans} currency={snapshot.family.currency} language={language} role={role} userId={user.id} onAdd={() => setDialog({ kind: "plan" })} onEdit={plan => setDialog({ kind: "plan", plan })} onCancel={plan => setDialog({ kind: "cancelPlan", plan })} />}
      {tab === "family" && <><section className="panel full-panel"><div className="panel-heading"><h2>{t("members")}</h2>{canManage(role) && <button className="button primary" onClick={() => setDialog({ kind: "invite" })}><Plus size={16} />{t("invite")}</button>}</div><div className="members-list">{family?.members.map(member => <div className="member-row" key={member.userId}><span className="avatar">{member.name[0]?.toUpperCase()}</span><div className="member-info"><strong>{member.name}</strong><span className="small muted">{member.email}</span><span className="tiny muted">{t(`${member.role}Help`)}</span></div>{canChangeMember(role, member.role) ? <div className="member-actions"><select aria-label={`${t("role")}: ${member.name}`} value={member.role} disabled={memberBusy === member.userId || demo} onChange={event => void changeMember(member.userId, event.target.value as Exclude<Role, "owner">)}>{(role === "owner" ? ["admin", "contributor", "viewer"] : ["contributor", "viewer"]).map(item => <option key={item} value={item}>{t(item)}</option>)}</select><button className="icon-button" aria-label={`${t("revoke")}: ${member.name}`} disabled={memberBusy === member.userId} onClick={() => setDialog({ kind: "removeMember", userId: member.userId, name: member.name })}><Trash2 size={16} /></button></div> : <span className="role-badge"><ShieldCheck size={13} />{t(member.role)}</span>}</div>)}</div></section>{snapshot.invitations.length > 0 && <section className="panel full-panel pending-panel"><h2>{t("pendingInvites")}</h2>{snapshot.invitations.map(invitation => <div className="member-row" key={invitation._id}><div className="member-info"><strong>{invitation.email}</strong><span className="small muted">{t(invitation.role)} · {t("expires")} {displayDate(invitation.expiresAt.slice(0, 10))}</span></div>{(role === "owner" || invitation.role !== "admin") && <button className="button secondary" disabled={memberBusy === invitation._id} onClick={async () => { setMemberBusy(invitation._id); try { await api(`families/${familyId}/invitations/${invitation._id}`, "DELETE"); await reload(); } catch (issue) { setError(issue instanceof ApiError ? issue.code : "connectionError"); } finally { setMemberBusy(""); } }}>{t("revoke")}</button>}</div>)}</section>}</>}
      {tab === "history" && <section className="panel full-panel"><div className="panel-heading"><h2>{t("activity")}</h2><History size={19} className="muted" /></div>{!snapshot.activity.length ? <p className="muted">{t("noActivity")}</p> : <div className="activity-list">{snapshot.activity.map(activity => <div className="activity-row" key={activity._id}><span className="activity-dot" /><div><strong>{t(activity.action)}</strong><p>{activity.title}{activity.amountMinor !== undefined && ` · ${formatMoney(activity.amountMinor)}`}</p><span className="small muted">{activity.actorName} · {new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(activity.at))}</span></div></div>)}</div>}</section>}
      <footer className="workspace-footer"><span className="small muted"><span className="status-dot" />{loading ? t("refreshing") : syncedAt ? `${t("sync")} ${syncedAt.toLocaleTimeString(language === "ru" ? "ru-RU" : "en-GB", { hour: "2-digit", minute: "2-digit" })}` : demo ? "ILS" : ""}</span><button className="quiet-button" disabled={loading} onClick={() => void reload()}><RefreshCw size={14} className={loading ? "spinner" : ""} />{t("refresh")}</button></footer>
      </>}
      </>}
    </main></div>
    {dialog && <BudgetDialog dialog={dialog} language={language} demo={demo} user={user} snapshot={snapshot} month={month} role={role} onDemoSettings={setDemoStartDay} onClose={() => setDialog(null)} onSaved={async (newFamilyId) => { if (newFamilyId) { await loadFamilies(); setFamilyId(newFamilyId); } else await reload(); }} />}
  </div>;
}

function CategoryIcon({ category }: { category: Category }) {
  const Icon = { food: Leaf, home: Home, transport: ArrowUpRight, bills: CreditCard, health: ShieldCheck, leisure: Sun, shopping: Wallet, other: MoreHorizontal }[category];
  return <Icon size={17} aria-hidden="true" />;
}

function BudgetDialog({ dialog, language, demo, user, snapshot, month, role, onClose, onSaved, onDemoSettings }: {
  dialog: Dialog; language: Language; demo: boolean; user: Person; snapshot: Snapshot | null;
  month: string; role: Role; onClose: () => void; onSaved: (familyId?: string) => Promise<void>;
  onDemoSettings: (day: number) => void;
}) {
  const t = (key: string) => translate(language, key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [cycleDay, setCycleDay] = useState(dialog.kind === "create" ? 10 : snapshot?.family.budgetStartDay ?? 1);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const expense = dialog.kind === "expense" ? dialog.expense : undefined;
  const plan = dialog.kind === "plan" ? dialog.plan : undefined;
  const family = snapshot?.family;
  const heading = dialog.kind === "expense" ? t(expense ? "editExpense" : "addExpense") : dialog.kind === "plan" ? t(plan ? "editPlan" : "addPlan") : t({ budget: "monthBudget", settings: "cycleSettings", invite: "invite", create: "createFamily", deleteExpense: "deleteExpense", removeMember: "removeMember", cancelPlan: "cancelPlan" }[dialog.kind]);
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement;
    dialogRef.current?.showModal();
    return () => { previouslyFocused.current?.focus(); };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    if (demo) { if (dialog.kind === "settings") { onDemoSettings(cycleDay); onClose(); } return; }
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      if (dialog.kind === "create") {
        const result = await api<{ family: Family }>("families", "POST", { name: String(form.get("name")), currency: String(form.get("currency")), budgetStartDay: cycleDay });
        await onSaved(result.family._id); onClose(); return;
      }
      if (!family) return;
      const base = `families/${family._id}`;
      if (dialog.kind === "expense") {
        const input = { title: String(form.get("title")), amountMinor: toMinor(String(form.get("amount"))), date: String(form.get("date")), category: String(form.get("category")), payerId: String(form.get("payer")), note: String(form.get("note") || ""), account: String(form.get("account") || "") };
        if (input.amountMinor <= 0) throw new Error("invalidAmount");
        await api(`${base}/expenses${expense ? `/${expense._id}` : ""}`, expense ? "PATCH" : "POST", { ...input, ...(expense ? { revision: expense.revision } : {}) });
      } else if (dialog.kind === "budget") {
        const categoryLimits = Object.fromEntries(categories.map(category => [category, toMinor(String(form.get(category) || "0"))]));
        const totalMinor = toMinor(String(form.get("total") || "0"));
        if (Object.values(categoryLimits).reduce((a, b) => a + b, 0) > totalMinor) throw new Error("categoryBudgetExceeded");
        await api(`${base}/budget`, "PUT", { month, totalMinor, categoryLimits, revision: snapshot?.budget?.revision || 0 });
      } else if (dialog.kind === "plan") {
        const input = { title: String(form.get("title")), totalMinor: toMinor(String(form.get("total"))), paymentCount: Number(form.get("paymentCount")), firstDate: String(form.get("firstDate")), category: String(form.get("category")), payerId: String(form.get("payer")), note: String(form.get("note") || ""), account: String(form.get("account") || "") };
        if (!planSchema.safeParse(input).success) throw new Error("invalidPlan");
        await api(`${base}/plans${plan ? `/${plan._id}` : ""}`, plan ? "PATCH" : "POST", { ...input, ...(plan ? { revision: plan.revision } : {}) });
      } else if (dialog.kind === "cancelPlan") {
        await api(`${base}/plans/${dialog.plan._id}`, "DELETE", { revision: dialog.plan.revision, cancelledFrom: String(form.get("cancelledFrom")) });
      } else if (dialog.kind === "settings") {
        await api(`${base}/settings`, "PUT", { budgetStartDay: cycleDay, revision: family.settingsRevision ?? 0 });
      } else if (dialog.kind === "invite") {
        const result = await api<{ token: string }>(`${base}/invitations`, "POST", { email: String(form.get("email")).trim().toLowerCase(), role: String(form.get("role")) });
        setLink(`${window.location.origin}/?invite=${result.token}`); await onSaved(); return;
      } else if (dialog.kind === "deleteExpense") {
        await api(`${base}/expenses/${dialog.expense._id}`, "DELETE", { revision: dialog.expense.revision });
      } else if (dialog.kind === "removeMember") { await api(`${base}/members/${dialog.userId}`, "DELETE"); }
      await onSaved(); onClose();
    } catch (issue) { setError(issue instanceof ApiError ? issue.code : issue instanceof Error && ["invalidAmount", "categoryBudgetExceeded", "invalidPlan"].includes(issue.message) ? issue.message : "connectionError"); }
    finally { setBusy(false); }
  }
  const moneyInput = (name: string, label: string, value = "", required = false) => <label className="field"><span>{label}</span><div className="amount-input"><input name={name} inputMode="decimal" defaultValue={value} required={required} placeholder="0.00" autoComplete="off" maxLength={12} /><span>{family?.currency || "ILS"}</span></div></label>;
  const dayField = <label className="field"><span>{t("resetDay")}</span><select name="budgetStartDay" value={cycleDay} onChange={event => setCycleDay(Number(event.target.value))}>{Array.from({ length: 31 }, (_, index) => index + 1).map(day => <option key={day} value={day}>{day}</option>)}</select></label>;
  const preview = budgetPeriod(month, cycleDay);
  const dateLabel = (date: string) => new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", { dateStyle: "medium" }).format(new Date(`${date}T12:00:00`));

  return <dialog ref={dialogRef} className="budget-dialog" aria-labelledby="dialog-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <div className="dialog-heading"><h2 id="dialog-title">{heading}</h2><button className="icon-button" disabled={busy} onClick={onClose} aria-label={t("close")}><X size={20} /></button></div>
    <form onSubmit={event => void submit(event)}>
      {dialog.kind === "plan" && <PlanFields plan={plan} family={family} user={user} language={language} />}
      {dialog.kind === "cancelPlan" && <><p>{dialog.plan.title}</p><p className="small muted">{t("cancelPlanHelp")}</p><label className="field"><span>{t("cancelFrom")}</span><input name="cancelledFrom" type="date" min={todayLocal()} max="2099-12-31" defaultValue={todayLocal()} required /></label></>}
      {dialog.kind === "expense" && <><label className="field"><span>{t("title")}</span><input name="title" maxLength={100} required defaultValue={expense?.title || ""} placeholder={t("titlePlaceholder")} /></label><div className="form-grid">{moneyInput("amount", t("amount"), expense ? minorInput(expense.amountMinor) : "", true)}<label className="field"><span>{t("date")}</span><input type="date" name="date" min="2000-01-01" max="2099-12-31" required defaultValue={expense?.date || todayLocal()} /></label><label className="field"><span>{t("category")}</span><select name="category" defaultValue={expense?.category || "food"}>{categories.map(category => <option key={category} value={category}>{t(category)}</option>)}</select></label><label className="field"><span>{t("payer")}</span><select name="payer" defaultValue={expense?.payerId || user.id}>{family?.members.map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}{expense && !family?.members.some(member => member.userId === expense.payerId) && <option value={expense.payerId}>{t("removedPerson")}</option>}</select></label></div><label className="field"><span>{t("account")}</span><input name="account" maxLength={50} defaultValue={expense?.account || ""} placeholder={t("accountPlaceholder")} /></label><label className="field"><span>{t("note")}</span><textarea name="note" rows={3} maxLength={500} defaultValue={expense?.note || ""} /></label></>}
      {dialog.kind === "budget" && <>{moneyInput("total", t("totalBudget"), snapshot?.budget ? minorInput(snapshot.budget.totalMinor) : "", true)}<h3 className="form-subheading">{t("categoryBudget")}</h3><div className="form-grid">{categories.map(category => <div key={category}>{moneyInput(category, t(category), minorInput(snapshot?.budget?.categoryLimits[category] || 0))}</div>)}</div><p className="small muted">{t("budgetHelp")}</p></>}
      {dialog.kind === "create" && <><p className="muted">{t("createText")}</p><label className="field"><span>{t("familyName")}</span><input name="name" maxLength={60} required placeholder={t("familyPlaceholder")} /></label><label className="field"><span>{t("currency")}</span><select name="currency" defaultValue="ILS">{currencies.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></label>{dayField}<p className="small muted">{t("shortMonthHelp")}</p></>}
      {dialog.kind === "settings" && <><p className="small muted">{t("cycleDescription")}</p>{dayField}<div className="cycle-preview"><strong>{dateLabel(preview.start)} — {dateLabel(preview.end)}</strong></div><p className="small muted">{t("shortMonthHelp")}</p><p className="small muted">{t("cycleChangeHelp")}</p></>}
      {dialog.kind === "invite" && <><p className="small muted">{t("inviteText")}</p>{link ? <div className="invite-result"><label className="field"><span>{t("invite")}</span><input value={link} readOnly onFocus={event => event.target.select()} /></label><button type="button" className="button secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } }}>{copied ? <Check size={16} /> : <Copy size={16} />}{t(copied ? "copied" : "copyLink")}</button></div> : <><label className="field"><span>{t("email")}</span><input name="email" type="email" required maxLength={254} placeholder="name@gmail.com" /></label><label className="field"><span>{t("role")}</span><select name="role" defaultValue="contributor">{(role === "owner" ? ["contributor", "viewer", "admin"] : ["contributor", "viewer"]).map(item => <option key={item} value={item}>{t(item)}</option>)}</select></label></>}</>}
      {dialog.kind === "deleteExpense" && <><p>{dialog.expense.title}</p><p className="muted">{t("deleteText")}</p></>}
      {dialog.kind === "removeMember" && <><p>{dialog.name}</p><p className="muted">{t("removeText")}</p></>}
      {error && <div className="form-error" role="alert">{t(error)}</div>}{demo && dialog.kind !== "settings" && <p className="small muted">{t("demoDisabled")}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t(link ? "close" : "cancel")}</button>{!link && <button className={`button ${["deleteExpense", "removeMember", "cancelPlan"].includes(dialog.kind) ? "danger" : "primary"}`} disabled={busy || (demo && dialog.kind !== "settings")} type="submit">{busy && <LoaderCircle size={16} className="spinner" />}{t(busy ? "saving" : demo && dialog.kind === "settings" ? "previewSettings" : dialog.kind === "invite" ? "createLink" : dialog.kind === "create" ? "create" : dialog.kind === "cancelPlan" ? "cancelPlan" : ["deleteExpense", "removeMember", "cancelPlan"].includes(dialog.kind) ? "delete" : "save")}</button>}</div>
    </form>
  </dialog>;
}
