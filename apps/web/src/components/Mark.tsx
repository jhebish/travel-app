import { MARK_CUTS, MARK_FRAME, MARK_SOLE, MARK_VIEWBOX, MARK_VIEWBOX_TIGHT, MARK_WING, markCut, type MarkCut } from "@travel/core";

/**
 * The Pylos mark: a winged Greek sandal. The sandal takes the text colour, so it follows the theme;
 * the wing is gold (--warm). `tight` crops to the drawing (about 2:1) for lockups beside the wordmark.
 */
export function Mark({
  width,
  tight,
  cut,
  title,
  wing = "var(--warm)",
  className,
}: {
  width: number;
  tight?: boolean;
  cut?: MarkCut;
  /** A name for screen readers. Without one the mark is decorative. */
  title?: string;
  wing?: string;
  className?: string;
}) {
  const box = tight ? MARK_VIEWBOX_TIGHT : MARK_VIEWBOX;
  const [, , w = 200, h = 200] = box.split(" ").map(Number);
  const c = MARK_CUTS[cut ?? markCut(tight ? (width * 200) / w : width)];
  return (
    <svg
      className={className ? `mark ${className}` : "mark"}
      width={width}
      height={Math.round((width * h) / w)}
      viewBox={box}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <g transform={MARK_FRAME}>
        <path d={MARK_SOLE} fill="currentColor" stroke={c.sole ? "currentColor" : undefined} strokeWidth={c.sole || undefined} />
        <path d={c.straps} fill="none" stroke="currentColor" strokeWidth={c.strap} strokeLinecap="round" strokeLinejoin="round" />
        <g className="mark-wing">
          <path d={MARK_WING} style={{ fill: wing }} transform={c.wing} />
        </g>
      </g>
    </svg>
  );
}
