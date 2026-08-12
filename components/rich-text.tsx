import { Fragment } from "react";
import { parseRichText, type BlockNode, type InlineNode } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

// Read-side renderer for description/body fields (P3-2). Builds React elements
// from the AST in lib/rich-text.ts — no `dangerouslySetInnerHTML` anywhere, so
// there is no HTML sink to sanitize and the XSS posture matches the comment
// linkifier the 2026-08-04 audit cleared. Every href goes through safeHref()
// during parsing; anything else stays literal text.
//
// No "use client": server components (Headlines tab) and client components
// (detail modals, L10 segments) both render it.

const LINK_CLASS =
  "break-words text-hpb-blue underline decoration-hpb-blue/30 underline-offset-2 hover:decoration-hpb-blue dark:text-hpb-gold dark:decoration-hpb-gold/40";

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case "text":
            return <Fragment key={i}>{node.text}</Fragment>;
          case "strong":
            return (
              <strong key={i} className="font-semibold">
                <Inline nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inline nodes={node.children} />
              </em>
            );
          case "link":
            return (
              <a
                key={i}
                href={node.href}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                <Inline nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function Block({ block }: { block: BlockNode }) {
  if (block.kind === "paragraph") {
    // pre-wrap keeps the single newlines the parser left in place, so a
    // description written before this feature renders exactly as it used to.
    return (
      <p className="whitespace-pre-wrap">
        <Inline nodes={block.children} />
      </p>
    );
  }

  const items = block.items.map((item, i) => (
    <li key={i} className="whitespace-pre-wrap">
      <Inline nodes={item.children} />
    </li>
  ));

  return block.kind === "bullet-list" ? (
    <ul className="list-disc space-y-0.5 pl-[1.15em] marker:text-zinc-400">
      {items}
    </ul>
  ) : (
    <ol
      start={block.start}
      className="list-decimal space-y-0.5 pl-[1.35em] marker:text-zinc-400 marker:tabular-nums"
    >
      {items}
    </ol>
  );
}

/**
 * Renders a description/body string with the supported markup. Typography
 * (size, color) is inherited from `className` / the parent, so each surface
 * keeps the exact look it has today. Renders nothing for empty input —
 * callers own their own "No description." placeholder.
 */
export function RichText({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  const blocks = parseRichText(value);
  if (blocks.length === 0) return null;

  // Single paragraph is the overwhelmingly common case (and every pre-existing
  // description): render it without the extra wrapper so nothing shifts.
  if (blocks.length === 1 && blocks[0].kind === "paragraph") {
    return (
      <p className={cn("whitespace-pre-wrap", className)}>
        <Inline nodes={blocks[0].children} />
      </p>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}
