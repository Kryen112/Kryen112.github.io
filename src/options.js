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
