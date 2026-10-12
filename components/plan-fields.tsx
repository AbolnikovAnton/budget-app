"use client";

import { useState } from "react";
import { categories, money, minorInput, toMinor, todayLocal, type Family, type InstallmentPlan, type Language, type Person } from "@/lib/domain";
import { paymentAmount, paymentDate } from "@/lib/calculators";
import { translate } from "@/lib/i18n";

export default function PlanFields({ plan, family, user, language }: { plan?: InstallmentPlan; family?: Family; user: Person; language: Language }) {
  const [total,setTotal] = useState(plan ? minorInput(plan.totalMinor) : "");
  const [count,setCount] = useState(plan?.paymentCount || 12);
  const [firstDate,setFirstDate] = useState(plan?.firstDate || todayLocal());
  const t = (key: string) => translate(language,key);
  const currency = family?.currency || "ILS";
  let preview: { minimum: number; maximum: number; lastDate: string } | null = null;
  try { const minor = toMinor(total); preview = { minimum: paymentAmount(minor,count,count - 1), maximum: paymentAmount(minor,count,0), lastDate: paymentDate(firstDate,count - 1) }; } catch { /* Show the preview once valid source values are entered. */ }
  return <>
    <p className="small muted">{t("planFormHelp")}</p>
    <label className="field"><span>{t("title")}</span><input name="title" maxLength={100} required defaultValue={plan?.title || ""} placeholder={t("noPlansText")} /></label>
    <div className="form-grid"><label className="field"><span>{t("totalAmount")}</span><div className="amount-input"><input name="total" inputMode="decimal" value={total} onChange={event => setTotal(event.target.value)} required placeholder="0.00" maxLength={12} /><span>{currency}</span></div></label><label className="field"><span>{t("paymentCount")}</span><input name="paymentCount" type="number" value={count || ""} onChange={event => setCount(Number(event.target.value))} min={1} max={600} step={1} required /></label></div>
    <label className="field"><span>{t("firstPayment")}</span><input name="firstDate" type="date" value={firstDate} onChange={event => setFirstDate(event.target.value)} min="2000-01-01" max="2099-12-31" required /></label>
    {preview && <div className="cycle-preview" aria-live="polite"><span className="small muted">{t("monthlyPayment")}</span><strong>{preview.minimum === preview.maximum ? money(preview.minimum,currency,language) : `${money(preview.minimum,currency,language)} – ${money(preview.maximum,currency,language)}`}</strong><span className="small muted">{t("endOfPayments")}: {new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", { dateStyle: "medium" }).format(new Date(`${preview.lastDate}T12:00:00`))}</span></div>}
    <div className="form-grid"><label className="field"><span>{t("category")}</span><select name="category" defaultValue={plan?.category || "bills"}>{categories.map(category => <option key={category} value={category}>{t(category)}</option>)}</select></label><label className="field"><span>{t("payer")}</span><select name="payer" defaultValue={plan?.payerId || user.id}>{family?.members.map(member => <option key={member.userId} value={member.userId}>{member.name}</option>)}{plan && !family?.members.some(member => member.userId === plan.payerId) && <option value={plan.payerId}>{t("removedPerson")}</option>}</select></label></div>
    <label className="field"><span>{t("account")}</span><input name="account" maxLength={50} defaultValue={plan?.account || ""} placeholder={t("accountPlaceholder")} /></label><label className="field"><span>{t("note")}</span><textarea name="note" rows={2} maxLength={500} defaultValue={plan?.note || ""} /></label>
    <p className="small muted">{t("roundingHelp")}</p>{plan && <p className="small muted">{t("planEditHelp")}</p>}
  </>;
}
