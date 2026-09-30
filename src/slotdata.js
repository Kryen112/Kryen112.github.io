/**
 * Every option the apworld ships in slot_data, in its order.
 *
 * The apworld keeps the same list as SLOT_DATA_OPTIONS in constants.py, and
 * each repo pins the other's when both are checked out. A seed from apworld
 * 1.8.12 or later that lacks one of these is out of step with this site, and
 * the connect log says so rather than letting the option run at its default.
 */
export const SLOT_DATA_OPTIONS = [
    "goal",
    "ranger_class_randomizer",
    "ranger_class_selected",
    "classes_req_for_castle",
    "classes_req_for_submarine_shrine",
    "classes_req_for_pyramid",
    "classes_req_for_ice_castle",
    "classes_req_for_hell_castle",
    "stages_req_for_castle",
    "stages_req_for_submarine_shrine",
    "stages_req_for_pyramid",
    "stages_req_for_ice_castle",
    "stages_req_for_hell_castle",
    "shuffle_books",
    "shuffle_enemies",
    "gold_multiplier",
    "xp_multiplier",
    "drop_multiplier",
    "randomize_book_costs",
    "shop_hints",
    "trap_disguise",
    "trap_percentage",
    "free_respec",
    "progressive_shop",
    "enforce_logic",
    "enforce_shop_logic",
    "ring_gold",
    "ring_link",
    "ring_link_ratio",
    "shop_checks",
    "remove_null_compo",
    "removable_compos",
    "death_link",
];

/** The options a seed should carry but does not. */
export function missingSlotDataKeys(slotData) {
    return SLOT_DATA_OPTIONS.filter((key) => !(key in (slotData ?? {})));
}
