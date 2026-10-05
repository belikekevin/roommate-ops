"use client";
// Client only for the active-page highlight.
import Link from "next/link";
import { usePathname } from "next/navigation";

// [href, label, tooltip, emoji, accent]. The tooltips are Kevin being Kevin; the labels stay boring so people can
// find things. The emoji shows only on the active tab (CSS ::before), and the accent recolours it to match its page.
const NAV = [
  ["/", "Home", "This is my house. I have to defend it.", "😜", "red"],
  ["/money", "Money", "Keep the change, ya filthy animal.", "💸", "green"],
  ["/cart", "Cart", "A lovely cheese pizza, just for me.", "🍕", "gold"],
  ["/chores", "Chores", "Buzz, your girlfriend… woof.", "🧹", "red"],
  ["/reminders", "Reminders", "KEVIN!!!", "⏰", "ice"],
  ["/inbox", "Inbox", "Mail from the Wet Bandits?", "📬", "candy"],
  ["/upkeep", "Upkeep", "Trap check.", "🪣", "green"],
  ["/members", "Roommates", "The McCallisters.", "🧦", "gold"],
] as const;

// "/cart/checkout" still lights up Cart.
const isActive = (href: string, path: string) => path === href || (href !== "/" && path.startsWith(`${href}/`));

export function NavLinks({ unread = 0 }: { unread?: number }) {
  const path = usePathname();
  const current = NAV.find(([href]) => isActive(href, path));
  return (
    <nav className="nav" data-accent={current?.[4]}>
      {NAV.map(([href, label, tip, emoji]) => (
        <Link key={href} href={href} title={tip} data-emoji={emoji} aria-current={isActive(href, path) ? "page" : undefined}>
          {label}
          {href === "/inbox" && unread > 0 && <span className="badge" aria-label={`${unread} unread`}>{unread}</span>}
        </Link>
      ))}
    </nav>
  );
}
