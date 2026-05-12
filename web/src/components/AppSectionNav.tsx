"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  description?: string;
};

type Props = {
  items: NavItem[];
};

export default function AppSectionNav({ items }: Props) {
  const pathname = usePathname();

  return (
    <nav className="section-nav section-nav--sidebar">
      {items.map((item) => {
        const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`section-nav__item ${active ? "section-nav__item--active" : ""}`}
          >
            <span className="section-nav__label">{item.label}</span>
            {item.description ? <span className="section-nav__meta">{item.description}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
