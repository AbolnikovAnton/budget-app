import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Вместе — семейный бюджет",
  description: "Спокойный контроль общих расходов. Quiet family budgeting.",
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru" suppressHydrationWarning><body>{children}</body></html>;
}
