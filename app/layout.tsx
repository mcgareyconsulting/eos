import type { Metadata } from "next";
import { Nunito_Sans } from "next/font/google";
import "./globals.css";

// HPB brand typeface — Nunito Sans across all written communication.
const nunitoSans = Nunito_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "High Plains Bank",
  description: "Level 10 meetings, scorecards, rocks, and the rest of EOS.",
};

// Runs before paint to avoid a flash of the wrong theme.
const noFlashScript = `(() => {
  try {
    const t = localStorage.getItem('theme');
    const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (t === 'dark' || (!t && sysDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch (_) {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${nunitoSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body className="min-h-full bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
