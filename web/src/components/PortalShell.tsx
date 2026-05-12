import ThemeToggle from "@/components/ThemeToggle";
import AppSectionNav from "@/components/AppSectionNav";
import type { PortalNavItem } from "@/lib/portalNav";

type Props = {
  badge: string;
  brandPill?: string;
  eyebrow: string;
  title: string;
  description: string;
  navItems: PortalNavItem[];
  initialTheme: "light" | "dark";
  sidebarFooter?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
};

export default function PortalShell({
  badge,
  brandPill = "GOJO Health App",
  eyebrow,
  title,
  description,
  navItems,
  initialTheme,
  sidebarFooter,
  headerActions,
  children,
}: Props) {
  return (
    <div className="min-h-screen">
      <div className="grid-dots" />
      <div className="portal-shell">
        <aside className="portal-sidebar">
          <div className="portal-sidebar__brand">
            <div className="portal-sidebar__logo">G</div>
            <div>
              <p className="portal-sidebar__product">GOJO Health App</p>
              <p className="portal-sidebar__meta">{badge}</p>
            </div>
          </div>

          <div className="portal-sidebar__controls">
            <ThemeToggle initialTheme={initialTheme} />
          </div>

          <AppSectionNav items={navItems} />

          <div className="portal-sidebar__footer">
            {sidebarFooter}
            <form action="/api/auth/logout" method="post">
              <button className="portal-logout-button" type="submit">
                <span className="portal-logout-button__icon" aria-hidden="true">↳</span>
                <span>Logout</span>
              </button>
            </form>
          </div>
        </aside>

        <main className="portal-content">
          <header className="portal-page-header fade-up">
            <div className="stack-sm">
              <div className="app-header__cluster">
                <span className="badge">{badge}</span>
                <span className="pill">{brandPill}</span>
              </div>
              <div>
                <p className="eyebrow">{eyebrow}</p>
                <h1 className="portal-page-title">{title}</h1>
                <p className="subtle text-sm mt-2 max-w-3xl leading-6">{description}</p>
              </div>
            </div>
            {headerActions ? <div className="stack-sm">{headerActions}</div> : null}
          </header>

          <div className="portal-page-body">{children}</div>
        </main>
      </div>
    </div>
  );
}
