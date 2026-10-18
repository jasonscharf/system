import {
    applyListFrame,
    applyListQuery,
    defaultListQuery,
    diffListRows,
    type ListQuery,
    type ListSchema,
    type ListState,
    listWindowFrame,
    normalizeListQuery,
    placeListChange,
    planListPush,
} from "@jasonscharf/core/list";
import { describe, expect, it } from "vitest";

interface Person {
    [field: string]: string | number | boolean | null;
    id: string;
    name: string;
    age: number;
    admin: boolean;
}

const schema: ListSchema = {
    key: "id",
    fields: ["name", "age", "admin"],
    searchFields: ["name"],
    defaultSort: [{ field: "age", direction: "desc" }],
    maxLimit: 50,
};

const person = (id: string, name: string, age: number, admin = false): Person => ({
    id,
    name,
    age,
    admin,
});

const people: Person[] = [
    person("a", "Ada Lovelace", 36, true),
    person("b", "Grace Hopper", 85),
    person("c", "Alan Turing", 41),
    person("d", "Edsger Dijkstra", 72, true),
    person("e", "Barbara Liskov", 84),
];

function query(overrides: Partial<ListQuery> = {}): ListQuery {
    return { ...defaultListQuery(schema), ...overrides };
}

describe(normalizeListQuery, () => {
    it("keeps only the fields and operators the schema allows", () => {
        const q = normalizeListQuery(
            {
                sort: [
                    { field: "password", direction: "asc" },
                    { field: "name", direction: "x" },
                ],
                filters: [
                    { field: "secret", op: "eq", value: 1 },
                    { field: "age", op: "drop", value: 1 },
                    { field: "age", op: "gte", value: 40 },
                    { field: "admin", op: "in", value: [true, { no: 1 }] },
                ],
                search: "  ada  ",
                page: { offset: -4, limit: 5000 },
            },
            schema,
        );
        expect(q).toEqual({
            sort: [{ field: "name", direction: "asc" }],
            filters: [{ field: "age", op: "gte", value: 40 }],
            search: "ada",
            page: { offset: 0, limit: 50 },
        });
    });

    it("falls back to the schema default for anything that is not an object", () => {
        expect(normalizeListQuery("nope", schema)).toEqual(defaultListQuery(schema));
    });
});

describe(applyListQuery, () => {
    it("filters, searches, sorts and pages", () => {
        const window = applyListQuery(
            people,
            query({
                filters: [{ field: "age", op: "gt", value: 40 }],
                search: "a",
                sort: [{ field: "name", direction: "asc" }],
                page: { offset: 1, limit: 2 },
            }),
            schema,
        );
        expect(window.total).toBe(4);
        expect(window.rows.map((row) => row.id)).toEqual(["e", "d"]);
    });

    it("requires every search term to appear", () => {
        const window = applyListQuery(people, query({ search: "grace hop" }), schema);
        expect(window.rows.map((row) => row.id)).toEqual(["b"]);
        expect(applyListQuery(people, query({ search: "grace turing" }), schema).total).toBe(0);
    });

    it("breaks ties by key so the order is total", () => {
        const twins = [person("z", "Same", 1), person("y", "Same", 1)];
        const window = applyListQuery(twins, query(), schema);
        expect(window.rows.map((row) => row.id)).toEqual(["y", "z"]);
    });
});

describe(placeListChange, () => {
    const firstPage = applyListQuery(people, query({ page: { offset: 0, limit: 2 } }), schema);

    it("drops a change the filter never admits", () => {
        const q = query({ filters: [{ field: "admin", op: "eq", value: true }] });
        const window = applyListQuery(people, q, schema);
        const change = { key: "x", before: null, after: person("x", "Nobody", 1) };
        expect(placeListChange(window, change, q, schema)).toEqual({ kind: "dropped" });
    });

    it("places a new row at its sorted position on the first page", () => {
        const change = { key: "x", before: null, after: person("x", "Elder", 99) };
        const placed = placeListChange(firstPage, change, query(), schema);
        expect(placed.kind).toBe("placed");
        if (placed.kind === "placed") {
            expect(placed.window.rows.map((row) => row.id)).toEqual(["x", "b"]);
            expect(placed.window.total).toBe(6);
        }
    });

    it("moves only the total for a row below a full page", () => {
        const change = { key: "x", before: null, after: person("x", "Infant", 0) };
        const placed = placeListChange(firstPage, change, query(), schema);
        expect(placed).toEqual({ kind: "placed", window: { ...firstPage, total: 6 } });
    });

    it("is stale when a row enters above a later page", () => {
        const second = applyListQuery(people, query({ page: { offset: 2, limit: 2 } }), schema);
        const change = { key: "x", before: null, after: person("x", "Elder", 99) };
        expect(placeListChange(second, change, query(), schema)).toEqual({ kind: "stale" });
    });

    it("is stale when a row leaves the page and another would slide up", () => {
        const change = { key: "b", before: people[1], after: null };
        expect(placeListChange(firstPage, change, query(), schema)).toEqual({ kind: "stale" });
    });
});

/** A small seeded generator so a failing run can be replayed. */
function prng(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2 ** 32;
    };
}

describe(planListPush, () => {
    it("keeps every subscriber's page equal to a fresh read through random edits", () => {
        const random = prng(7);
        const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
        const queries: ListQuery[] = [
            query({ page: { offset: 0, limit: 3 } }),
            query({ page: { offset: 3, limit: 3 } }),
            query({ sort: [{ field: "name", direction: "asc" }], page: { offset: 0, limit: 4 } }),
            query({ filters: [{ field: "admin", op: "eq", value: true }] }),
            query({ search: "a", page: { offset: 1, limit: 2 } }),
        ];
        const names = ["Ada", "Alan", "Grace", "Edsger", "Barbara", "Ken", "Linus"];

        let rows: Person[] = [...people];
        const states: Array<ListState<Person> | null> = queries.map((q) => {
            const frame = listWindowFrame(rows, q, schema);
            return applyListFrame(null, frame, q, schema);
        });

        let nextId = 0;
        for (let step = 0; step < 400; step++) {
            const before = rows;
            const roll = random();
            if (roll < 0.4 || rows.length < 2) {
                rows = [
                    ...rows,
                    person(`n${nextId++}`, pick(names), Math.floor(random() * 100), random() < 0.5),
                ];
            } else if (roll < 0.7) {
                const victim = pick(rows);
                rows = rows.filter((row) => row !== victim);
            } else {
                const target = pick(rows);
                rows = rows.map((row) =>
                    row === target
                        ? { ...row, age: Math.floor(random() * 100), admin: random() < 0.5 }
                        : row,
                );
            }

            queries.forEach((q, i) => {
                const frame = planListPush(before, rows, q, schema);
                let state = states[i];
                if (frame !== null) {
                    state = applyListFrame(state, frame, q, schema);
                    // A duplicate push from a second process changes nothing.
                    if (state !== null) {
                        expect(applyListFrame(state, frame, q, schema)).toEqual(state);
                    }
                }
                if (state === null) {
                    state = applyListFrame(null, listWindowFrame(rows, q, schema), q, schema);
                }
                states[i] = state;
                expect(state?.window).toEqual(applyListQuery(rows, q, schema));
            });
        }
    });

    it("sends nothing when no row the subscriber can see changed", () => {
        const q = query({ filters: [{ field: "admin", op: "eq", value: true }] });
        const after = [...people, person("x", "Outsider", 10, false)];
        expect(planListPush(people, after, q, schema)).toBeNull();
    });
});

describe(diffListRows, () => {
    it("reports additions, removals and edits by key", () => {
        const after = [person("a", "Ada", 37, true), ...people.slice(1, 4), person("f", "New", 1)];
        expect(diffListRows(people, after, schema).map((change) => change.key)).toEqual([
            "a",
            "e",
            "f",
        ]);
    });
});
