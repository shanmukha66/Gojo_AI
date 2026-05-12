import type { Metadata } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { cookies } from "next/headers";
import { getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "GOJO Health App | Explainable AI-RAG Assistance",
  description:
    "Dual-interface clinical support and patient guidance with explainable, evidence-grounded AI.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  const user = getCurrentUser(sessionId);
  const initialTheme = user ? getUserPreferences(user.id).theme : "dark";
  const themeInitScript = `
    (function () {
      try {
        var stored = localStorage.getItem("gojo-theme");
        var theme = stored === "light" || stored === "dark" ? stored : "${initialTheme}";
        document.documentElement.dataset.theme = theme;
      } catch (error) {
        document.documentElement.dataset.theme = "${initialTheme}";
      }
    })();
  `;

  return (
    <html lang="en" suppressHydrationWarning data-theme={initialTheme}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${dmSans.variable} ${spaceGrotesk.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
