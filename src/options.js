/**
 * What the seed's options mean once the seed's age and the other options are
 * taken into account. Pure, so the rules are testable without a connection.
 */
import { legacySeed } from "./version.js";

/**
 * Shop Checks. LEGACY (remove after 2026-11): a seed from before 1.8.1 never
 * shipped the key, so for those the seed's own location list decides -- only
 * Shop Checks creates locations in the shop range.
 */
export function resolveShopChecks(slotData, seedHasShopLocations) {
    if (slotData.shop_checks !== undefined) return slotData.shop_checks ? 1 : 0;
    return legacySeed(slotData) && seedHasShopLocations() ? 1 : 0;
}

/**
 * Progressive Shop and Enforce Shop Logic only mean something once the shop
 * holds checks. Current seeds ship them zeroed then; for older ones the same
 * rule is applied here.
 */
export function resolveProgressiveShop(slotData, shopChecks) {
    return shopChecks ? (slotData.progressive_shop ?? 0) : 0;
}

export function resolveEnforceShopLogic(slotData, shopChecks) {
    return shopChecks ? (slotData.enforce_shop_logic ?? 0) : 0;
}

/** Gold per Thrown Ring is Ring Link's payout, so it is nothing without Ring Link. */
export function resolveRingGold(slotData) {
    return (slotData.ring_link ?? 0) ? (slotData.ring_gold ?? 0) : 0;
}

export const SHOP_HINTS_OFF = 0;
export const SHOP_HINTS_IMPORTANT_ONLY = 1;
export const SHOP_HINTS_ALL = 2;

/**
 * Shop Hints: off, important only, or all. LEGACY (remove after 2026-11):
 * before 1.8.12 this was a toggle with a separate Important Hints Only toggle
 * beside it, so a 1 from such a seed means "on", not "important only".
 */
export function resolveShopHints(slotData) {
    if (legacySeed(slotData)) {
        if (!(slotData.shop_hints ?? false)) return SHOP_HINTS_OFF;
        return slotData.important_hints_only ? SHOP_HINTS_IMPORTANT_ONLY : SHOP_HINTS_ALL;
    }
    return slotData.shop_hints ?? SHOP_HINTS_ALL;
}
