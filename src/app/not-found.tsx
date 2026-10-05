// 404. Kevin made this page disappear (and then regretted it).
import Link from "next/link";
import { Empty, PageHead } from "@/components/ui";

export default function NotFound() {
  return (
    <main data-accent="candy">
      <PageHead title="404 — Kevin made this page disappear." quip="I made my family disappear." />
      <div className="card">
        <Empty title="Nothing here but a bucket of paint on a string.">
          <div className="scream" aria-hidden="true">😱</div>
          <p>Whatever you were looking for isn&apos;t in this house. Check the address, or head back and defend the fort.</p>
          <Link className="btn" href="/">Go home</Link>
        </Empty>
      </div>
    </main>
  );
}
