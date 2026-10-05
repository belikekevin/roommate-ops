// Shared dashboard pieces. Styles live in app/globals.css; every page uses these so the house looks like one house.
import type { ReactNode } from "react";

/**
 * Page header. `title` + `quip` (rendered like a movie subtitle) are what every page passes today;
 * `badge` adds a gold pill beside the title and `emoji` a big goofy face on the right. Both optional.
 */
export function PageHead({
  title,
  quip,
  badge,
  emoji,
  children,
}: {
  title: string;
  quip?: string;
  badge?: string;
  emoji?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-head row">
      <div>
        {badge ? (
          <div className="page-title">
            <h1>{title}</h1>
            <span className="pill gold head-badge">{badge}</span>
          </div>
        ) : (
          <h1>{title}</h1>
        )}
        {quip && <p className="quip">{quip}</p>}
      </div>
      {(children || emoji) && <span className="spacer" />}
      {children}
      {emoji && <span className="head-emoji" aria-hidden="true">{emoji}</span>}
    </header>
  );
}

/** Empty state. `className="socks"` adds a little sock row under the text (the "all square" states use it). */
export function Empty({ title, className, children }: { title: string; className?: string; children?: ReactNode }) {
  return (
    <div className={className ? `empty ${className}` : "empty"}>
      <b>{title}</b>
      {children}
    </div>
  );
}

export function NoHousehold() {
  return (
    <div className="card">
      <Empty title="Nobody's home.">
        Add Kevin to a Telegram group and say hi, or run <code>npm run seed</code>.
      </Empty>
    </div>
  );
}
