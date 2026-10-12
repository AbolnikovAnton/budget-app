import BudgetApp from "@/components/budget-app";

export const dynamic = "force-dynamic";
export default function Page() {
  return <BudgetApp initialMonth={new Date().toISOString().slice(0, 7)} authConfigured={Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && process.env.MONGODB_URI)} />;
}
