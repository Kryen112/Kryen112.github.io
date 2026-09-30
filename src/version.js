/**
 * Which apworld made the seed, and whether this site understands it.
 *
 * Seeds from apworld 1.8.12 on carry world_version; older ones carry nothing.
 * Every branch that exists only for those older seeds is marked LEGACY in the
 * source and keyed on legacySeed(), so they can be found and deleted together
 * once no such seed is still being played -- after LEGACY_SUPPORT_ENDS.
 */
export const LEGACY_SUPPORT_ENDS = "2026-11";

/** The logic description shape this client evaluates. rules.py bumps its own. */
export const SUPPORTED_LOGIC_VERSION = 1;

/** A seed from before the apworld said which version made it. */
export function legacySeed(slotData) {
    return slotData?.world_version == null;
}

/** -1, 0 or 1 for dotted version strings; missing parts count as 0. */
export function compareVersions(a, b) {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return Math.sign(diff);
    }
    return 0;
}

/**
 * What to tell the player about the seed's apworld against this site, or null
 * when they match. A newer seed is an error: the site cannot know what the
 * seed expects of it.
 */
export function versionNotice(seedVersion, siteVersion) {
    if (seedVersion == null) {
        return {
            level: "info",
            text: `This seed predates apworld 1.8.12; older shop and logic behaviour is kept for it until ${LEGACY_SUPPORT_ENDS}.`,
        };
    }
    const order = compareVersions(seedVersion, siteVersion);
    if (order > 0) {
        return {
            level: "error",
            text: `This seed was made with apworld ${seedVersion}, newer than this site (${siteVersion}). Reload to pick up a newer site; if this keeps showing, the site has not been released for it yet.`,
        };
    }
    if (order < 0) {
        return { level: "info", text: `Seed from apworld ${seedVersion}; this site is ${siteVersion}.` };
    }
    return null;
}

/** Why the seed's logic block cannot be evaluated here, or null when it can. */
export function logicNotice(logic) {
    if (!logic) return null;
    const version = logic.version ?? 1;
    if (version === SUPPORTED_LOGIC_VERSION) return null;
    return `This seed describes its logic in a shape this site does not know (version ${version}, this site reads ${SUPPORTED_LOGIC_VERSION}). Stages are coloured as unlocked or done only, and nothing is enforced.`;
}
