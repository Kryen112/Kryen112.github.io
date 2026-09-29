// Connection details carried in the page address.
//
// The room page on archipelago.gg links every player name to an archipelago://
// address, and the apworld's launcher component turns that into
// https://kryen112.github.io/?host=archipelago.gg&port=56476&slot=KryenSR so
// the connect form can be filled in without retyping anything. Only the
// details that are present come back, keyed by the form's field names, so a
// plain visit changes nothing.

const QUERY_FIELDS = { host: "host", port: "port", slot: "slotName" };

export function connectionFromQuery(search) {
    const params = new URLSearchParams(search);
    const details = {};
    for (const [param, field] of Object.entries(QUERY_FIELDS)) {
        const value = (params.get(param) || "").trim();
        if (value === "") {
            continue;
        }
        if (param === "port" && !/^\d{1,5}$/.test(value)) {
            continue;
        }
        details[field] = value;
    }
    return details;
}
