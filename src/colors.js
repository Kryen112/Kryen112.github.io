/**
 * Colour for an item name in the message log.
 *
 * `flags` is a bitfield, not an enum: an item that is both progression and
 * useful arrives as 3, so testing equality against 1/2/4 dropped it through to
 * the filler colour -- which is why progression items sometimes rendered as
 * filler. Order and colours follow Archipelago's own _handle_item_name.
 */
export function itemColor(flags) {
    if (flags & 0b001) return "#9f79ee"; // progression
    if (flags & 0b010) return "#4f94cd"; // useful
    if (flags & 0b100) return "#ed7b6e"; // trap
    return "#09cbcb"; // filler
}
