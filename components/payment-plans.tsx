"use client";

import { useState } from "react";
import { CalendarDays, Pencil, Plus, Repeat, X } from "lucide-react";
import { canAdd, canEdit, money, todayLocal, type Currency, type InstallmentPlan, type Language, type Role } from "@/lib/domain";
import { paymentAmount, planProgress } from "@/lib/calculators";
import { translate } from "@/lib/i18n";

export default function PaymentPlans({ plans, currency, language, role, userId, onAdd, onEdit, onCancel }: {
  plans: InstallmentPlan[]; currency: Currency; language: Language; role: Role; userId: string;
  onAdd: () => void; onEdit: (plan: InstallmentPlan) => void; onCancel: (plan: InstallmentPlan) => void;
}) {
  const [expanded, setExpanded] = useState("");
  const [visible, setVisible] = useState(20);
  const t = (key: string) => translate(language,key);
  const amount = (value: number) => money(value,currency,language);
  const date = (value: string) => new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
  const today = todayLocal();
  return <>
    <section className="panel full-panel plans-intro"><div className="panel-heading"><h2>{t("plans")}</h2>{canAdd(role) && <button className="button primary" onClick={onAdd}><Plus size={16} />{t("addPlan")}</button>}</div><p className="small muted">{t("recurringIncluded")}</p></section>
    {!plans.length && <section className="panel empty-state"><span className="empty-icon"><Repeat size={25} /></span><h3>{t("noPlans")}</h3><p>{t("noPlansText")}</p></section>}
    <div className="plans-grid">{plans.slice(0,visible).map(plan => {
      const progress = planProgress(plan,today);
      const minimum = paymentAmount(plan.totalMinor,plan.paymentCount,plan.paymentCount - 1);
      const maximum = paymentAmount(plan.totalMinor,plan.paymentCount,0);
      const editable = canEdit(role,userId,plan.authorId) && !plan.cancelledFrom;
      return <section className="panel plan-card" key={plan._id}>
        <div className="panel-heading"><div><h2>{plan.title}</h2><span className="small muted">{t(plan.category)} · {plan.cancelledFrom ? `${t("cancelledPlan")} ${date(plan.cancelledFrom)}` : t(progress.remainingCount ? "activePlan" : "completedPlan")}</span></div>{editable && <div className="row-actions"><button className="icon-button" aria-label={`${t("editPlan")}: ${plan.title}`} onClick={() => onEdit(plan)}><Pencil size={16} /></button><button className="icon-button" aria-label={`${t("cancelPlan")}: ${plan.title}`} onClick={() => onCancel(plan)}><X size={17} /></button></div>}</div>
        <div className="plan-amount"><span className="small muted">{t("monthlyPayment")}</span><strong>{minimum === maximum ? amount(minimum) : `${amount(minimum)} – ${amount(maximum)}`}</strong><span className="small muted">{plan.paymentCount} {t("paymentsCountShort")} · {t("totalAmount")}: {amount(plan.totalMinor)}</span></div>
        <div className="plan-dates"><div><CalendarDays size={15} /><span className="small muted">{t("firstPayment")}</span><strong>{date(plan.firstDate)}</strong></div><div><CalendarDays size={15} /><span className="small muted">{t("endOfPayments")}</span><strong>{progress.last ? date(progress.last.date) : "—"}</strong></div></div>
        <div className="plan-progress"><span className="small muted">{t("elapsedPayments")}: {progress.elapsedCount} / {plan.paymentCount}</span><div className="budget-track" role="progressbar" aria-label={t("elapsedPayments")} aria-valuenow={progress.elapsedCount} aria-valuemin={0} aria-valuemax={plan.paymentCount}><span style={{ width: `${progress.elapsedCount / plan.paymentCount * 100}%` }} /></div><span className="small muted">{t("remainingPayments")}: {progress.remainingCount} · {amount(progress.remainingMinor)}</span></div>
        {progress.next && <p className="small muted">{t("nextPayment")}: {date(progress.next.date)} · {amount(progress.next.amountMinor)}</p>}
        <button className="text-button" aria-expanded={expanded === plan._id} onClick={() => setExpanded(expanded === plan._id ? "" : plan._id)}>{t("paymentSchedule")}</button>
        {expanded === plan._id && <table className="schedule-table"><thead><tr><th>{t("paymentNumber")}</th><th>{t("date")}</th><th>{t("amount")}</th></tr></thead><tbody>{progress.schedule.map(payment => <tr key={payment._id}><td>{payment.paymentNumber} / {payment.paymentCount}</td><td>{date(payment.date)}</td><td>{amount(payment.amountMinor)}</td></tr>)}</tbody></table>}
      </section>;
    })}</div>
    {visible < plans.length && <button className="button secondary" onClick={() => setVisible(count => count + 20)}>{t("loadMore")}</button>}
  </>;
}
