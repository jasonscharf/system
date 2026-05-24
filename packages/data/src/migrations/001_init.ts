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

    if (!(await knex.schema.hasTable(T.names))) {
        await knex.schema.createTable(T.names, (t) => {
            t.increments(C.id).primary();
            t.text(C.iri).notNullable().unique();
            t.integer(C.namespaceId).references(`${T.namespaces}.${C.id}`).nullable();
            t.text(C.localName).nullable();
        });
    }

    if (!(await knex.schema.hasTable(T.nodes))) {
        // All RDF terms (IRI, blank node, literal) get a row here.
        // kind ∈ { 'iri', 'blank', 'literal' }  — enforced by the application.
        await knex.schema.createTable(T.nodes, (t) => {
            t.increments(C.id).primary();
            t.text(C.kind).notNullable();
            t.integer(C.nameId).references(`${T.names}.${C.id}`).nullable();
            t.text(C.blank).nullable();
            t.text(C.value).nullable();
            t.text(C.datatype).nullable();
            t.text(C.lang).nullable();
            t.unique([C.kind, C.nameId, C.blank, C.value, C.datatype, C.lang]);
        });
    }

    if (!(await knex.schema.hasTable(T.edges))) {
        await knex.schema.createTable(T.edges, (t) => {
            t.increments(C.id).primary();
            t.integer(C.subject).notNullable().references(`${T.nodes}.${C.id}`);
            t.integer(C.predicate).notNullable().references(`${T.nodes}.${C.id}`);
            t.integer(C.object).notNullable().references(`${T.nodes}.${C.id}`);
            t.integer(C.graph).nullable().references(`${T.nodes}.${C.id}`);
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
    await knex.schema.dropTableIfExists(T.names);
    await knex.schema.dropTableIfExists(T.namespaces);
}
