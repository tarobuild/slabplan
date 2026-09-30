import type { FocusEvent } from "react"

/**
 * Keeps a focused item in a horizontal scroller fully visible, including its
 * focus ring. Browsers skip focus scrolling when the next item is already
 * partly on screen, which leaves the ring cut off at the scroller's edge;
 * scrolling to the nearest edge honours the scroller's `scroll-padding`.
 */
export function revealOnFocus(event: FocusEvent<HTMLElement>) {
  event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest" })
}
