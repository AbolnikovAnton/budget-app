import BudgetApp from "@/components/budget-app";
export const dynamic = "force-dynamic";
export default function DemoPage() { return <BudgetApp initialMonth={new Date().toISOString().slice(0, 7)} authConfigured={false} demo />; }
