import type { Knex } from "knex";
import { C, T } from "../schema.js";

export async function up(knex: Knex): Promise<void> {
    if (!(await knex.schema.hasTable(T.namespaces))) {
        await knex.schema.createTable(T.namespaces, (t) => {
            t.increments(C.id).primary();
            t.text(C.prefix).notNullable().unique();
            t.text(C.iri).notNullable().unique();
        });
    }

    if (!(await knex.schema.hasTable(T.nodes))) {
        // All RDF terms get a row here.  kind ∈ { 'iri', 'blank', 'literal' }.
        //   IRI     nodes: iri holds the full IRI string; blank_id and value are null.
        //   Blank   nodes: blank_id holds the blank-node identifier; iri and value are null.
        //   Literal nodes: value holds the lexical form; iri and blank_id are null.
        //                  datatype holds the XSD/RDF datatype IRI; lang holds the language tag.
        await knex.schema.createTable(T.nodes, (t) => {
            t.increments(C.id).primary();
            t.text(C.kind).notNullable();
            t.text(C.iri).nullable();
            t.text(C.blankId).nullable();
            t.text(C.value).nullable();
            t.text(C.datatype).nullable();
            t.text(C.lang).nullable();
            t.unique([C.kind, C.iri, C.blankId, C.value, C.datatype, C.lang]);
        });
    }

    if (!(await knex.schema.hasTable(T.edges))) {
        await knex.schema.createTable(T.edges, (t) => {
            t.increments(C.id).primary();
            t.integer(C.subject).notNullable().references(`${T.nodes}.${C.id}`);
            t.integer(C.predicate).notNullable().references(`${T.nodes}.${C.id}`);
            t.integer(C.object).notNullable().references(`${T.nodes}.${C.id}`);
            t.integer(C.graph).notNullable().references(`${T.nodes}.${C.id}`);
            t.unique([C.subject, C.predicate, C.object, C.graph]);
            t.index([C.subject]);
            t.index([C.predicate]);
            t.index([C.object]);
            t.index([C.graph]);
        });
    }
}

export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists(T.edges);
    await knex.schema.dropTableIfExists(T.nodes);
    await knex.schema.dropTableIfExists(T.namespaces);
}
