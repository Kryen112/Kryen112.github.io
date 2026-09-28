/**
 * Trap disguises, in the spirit of Ocarina of Time's ice traps.
 *
 * A trap in a shop or book shows the name of some other item in the room with
 * its spelling knocked slightly askew -- "Unlock Laek", "Progressive Eisland
 * Shoppe". It reads as a real item at a glance and gives itself away only if
 * you look properly.
 *
 * Everything here is derived from the location id, so a given trap always wears
 * the same face: across a reconnect, a reload, or a second look at the same
 * shelf. Nothing is stored.
 */

/** FNV-1a. Small, fast, and stable across browsers, which Math.random is not. */
export function hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

/** mulberry32: a deterministic stream from one seed. */
export function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

const VOWEL_SWAPS = { a: "ea", e: "ie", i: "ei", o: "oa", u: "oo" };
const VOWELS = "aeiou";

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/** Fisher-Yates on a copy, so the caller's list is left alone. */
function shuffled(rng, list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/** Swap two neighbouring letters: Lake -> Laek. */
function transpose(word, rng) {
    if (word.length < 3) return word;
    const at = 1 + Math.floor(rng() * (word.length - 2));
    return word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2);
}

/** Round a word off the old-fashioned way: Shop -> Shoppe. */
function embellish(word, _rng) {
    const last = word[word.length - 1];
    if (!last || VOWELS.includes(last.toLowerCase())) return word;
    // Already doubled, and a third would read as a typo rather than a spelling.
    if (word[word.length - 2]?.toLowerCase() === last.toLowerCase()) return word;
    return `${word}${last}e`;
}

/** Stretch a vowel into a digraph: Island -> Eisland. */
function stretchVowel(word, rng) {
    const spots = [...word].map((c, i) => [c, i]).filter(([c]) => VOWELS.includes(c.toLowerCase()));
    if (spots.length === 0) return word;
    const [letter, at] = pick(rng, spots);
    const swap = VOWEL_SWAPS[letter.toLowerCase()];
    const cased = letter === letter.toUpperCase() ? swap[0].toUpperCase() + swap.slice(1) : swap;
    return word.slice(0, at) + cased + word.slice(at + 1);
}

/** Lean on a consonant: Grass -> Grasss, read aloud the same, spelled wrong. */
function doubleConsonant(word, rng) {
    const spots = [...word]
        .map((c, i) => [c, i])
        .filter(
            ([c, i]) =>
                // Not the first letter: SShop reads as a slipped key.
                i > 0 &&
                /[a-z]/i.test(c) &&
                !VOWELS.includes(c.toLowerCase()) &&
                // Never make a third of a pair: Hell -> Helll reads as a slip.
                word[i - 1]?.toLowerCase() !== c.toLowerCase() &&
                word[i + 1]?.toLowerCase() !== c.toLowerCase(),
        );
    if (spots.length === 0) return word;
    const [letter, at] = pick(rng, spots);
    return word.slice(0, at) + letter + word.slice(at);
}

const RULES = [transpose, embellish, stretchVowel, doubleConsonant];

/**
 * Misspell a name without losing its shape.
 *
 * Only wordy tokens are touched, so "Grassland 1" keeps its 1 and a trap can
 * still be told apart from its neighbours on the shelf.
 */
export function misspell(name, rng) {
    const tokens = `${name}`.split(" ");
    let wordy = tokens.map((token, i) => [token, i]).filter(([token]) => /[a-z]{3,}/i.test(token));
    if (wordy.length === 0) return name;

    // Leave the leading word alone when there is something else to mangle.
    // "Unlock" and "Progressive" open half the item list, so bending those is
    // what gives a disguise away; the distinctive word is the one to bend.
    if (wordy.length > 1 && wordy[0][1] === 0) {
        wordy = wordy.slice(1);
    }

    // One word for a short name, two for a long one -- enough to look wrong,
    // not so much that it stops looking like an item.
    const howMany = wordy.length > 2 ? 2 : 1;
    const chosen = new Set();
    while (chosen.size < howMany) {
        chosen.add(pick(rng, wordy)[1]);
    }

    for (const index of chosen) {
        const original = tokens[index];
        // Work through the rules in a rolled order and take the first that
        // actually bites. Picking at random could land on one that does not
        // apply -- embellish does nothing to a word ending in a vowel -- and a
        // word that survives leaves the trap wearing its real name.
        for (const rule of shuffled(rng, RULES)) {
            const mangled = rule(original, rng);
            if (mangled !== original) {
                tokens[index] = mangled;
                break;
            }
        }
    }
    return tokens.join(" ");
}

/**
 * The face a trap wears at one location.
 *
 * `names` is every item name in the room, so a Stick Ranger trap can turn up
 * wearing a misspelled Hollow Knight item. Returns null when there is nothing
 * to dress it in, and the caller keeps the real name.
 */
export function disguiseFor(locationId, names) {
    if (!names || names.length === 0) return null;
    const rng = seededRandom(hashString(`stick-ranger-trap:${locationId}`));
    const chosen = names[Math.floor(rng() * names.length)];
    const disguised = misspell(chosen, rng);
    return disguised === chosen ? null : disguised;
}
