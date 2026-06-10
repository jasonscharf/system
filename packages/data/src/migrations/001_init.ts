import { makeUri, NS_CORE } from "@jasonscharf/core";
import type { Knex } from "knex";
import { C, T } from "../schema.js";

/**
 * Single combined migration: schema + triggers + system bootstrap.
 *
 * Creates the full triple store schema (namespaces, names, nodes, edges) with
 * all columns and indexes in one pass, installs DB-level timestamp triggers,
 * and seeds the RBAC system entities:
 *
 *   sys:rbac:install   — the system Install (Root → Install)
 *   sys:rbac:tenant    — the system Tenant  (Install → Tenant)
 *   sys:rbac:superusers — a Group whose members have unrestricted access
 *   sys:rbac:superadmin — a Role that grants the wildcard (*) permission
 *
 * The grant chain is:
 *   superusers --[hasPrincipal]-- PolicyGrant --[hasRole]--> superadmin
 *   superadmin --[grants]--> wildcard (permissionKey = "*")
 *
 * All system entities use stable IDs (sys000…001 through sys000…006) so their
 * IRIs are predictable and importable as constants without a DB lookup.
 */

const RBAC_NS = makeUri(NS_CORE, "rbac");
const RBAC_GRAPH_IRI = makeUri(RBAC_NS, "graph");
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";

// Stable system IDs — must match constants in @jasonscharf/server
const SYS_INSTALL_ID = "sys0000000000000000000000000006";
const SYS_TENANT_ID = "sys0000000000000000000000000001";
const SYS_SUPERUSERS_ID = "sys0000000000000000000000000002";
const SYS_SUPERADMIN_ID = "sys0000000000000000000000000003";
const SYS_WILDCARD_ID = "sys0000000000000000000000000004";
const SYS_GRANT_ID = "sys0000000000000000000000000005";

// Derived IRIs
const SYS_INSTALL_IRI = makeUri(RBAC_NS, "install", SYS_INSTALL_ID);
const SYS_TENANT_IRI = makeUri(RBAC_NS, "tenant", SYS_TENANT_ID);
const SYS_SUPERUSERS_IRI = makeUri(RBAC_NS, "group", SYS_SUPERUSERS_ID);
const SYS_SUPERADMIN_IRI = makeUri(RBAC_NS, "role", SYS_SUPERADMIN_ID);
const SYS_WILDCARD_IRI = makeUri(RBAC_NS, "permission", SYS_WILDCARD_ID);
const SYS_GRANT_IRI = makeUri(RBAC_NS, "grant", SYS_GRANT_ID);

// Class IRIs
const CLS_INSTALL = makeUri(RBAC_NS, "Install");
const CLS_TENANT = makeUri(RBAC_NS, "Tenant");
const CLS_USER_GROUP = makeUri(RBAC_NS, "UserGroup");
const CLS_ROLE = makeUri(RBAC_NS, "Role");
const CLS_PERMISSION = makeUri(RBAC_NS, "Permission");
const CLS_POLICY_GRANT = makeUri(RBAC_NS, "PolicyGrant");

// Predicate IRIs
const P_INSTALL_NAME = makeUri(RBAC_NS, "installName");
const P_IS_SYSTEM_INSTALL = makeUri(RBAC_NS, "isSystemInstall");
const P_HAS_TENANT = makeUri(RBAC_NS, "hasTenant");
const P_TENANT_NAME = makeUri(RBAC_NS, "tenantName");
const P_IS_SYSTEM_TENANT = makeUri(RBAC_NS, "isSystemTenant");
const P_GROUP_NAME = makeUri(RBAC_NS, "groupName");
const P_IS_SYSTEM_GROUP = makeUri(RBAC_NS, "isSystemGroup");
const P_ROLE_NAME = makeUri(RBAC_NS, "roleName");
const P_IS_SYSTEM_ROLE = makeUri(RBAC_NS, "isSystemRole");
const P_PERMISSION_KEY = makeUri(RBAC_NS, "permissionKey");
const P_IS_DENIAL = makeUri(RBAC_NS, "isDenial");
const P_GRANTS = makeUri(RBAC_NS, "grants");
const P_GRANT_PRINCIPAL = makeUri(RBAC_NS, "hasPrincipal");
const P_GRANT_ROLE = makeUri(RBAC_NS, "hasRole");

// ── Schema helpers ────────────────────────────────────────────────────────────

async function internIRINode(knex: Knex, iriStr: string): Promise<number> {
    const existing = (await knex(T.nodes)
        .where({ [C.kind]: "iri", [C.iri]: iriStr })
        .select(C.id)
        .first()) as { id: number } | undefined;
    if (existing) {
        return existing.id;
    }
    const [row] = (await knex(T.nodes)
        .insert({ [C.kind]: "iri", [C.iri]: iriStr })
        .returning(C.id)) as [{ id: number } | number];
    return typeof row === "object" ? row.id : row;
}

function coerceLiteralToJson(value: string, datatypeIri: string): string | number | boolean {
    if (datatypeIri === XSD_BOOLEAN) {
        return value === "true";
    }
    return value;
}

async function internLiteralNode(knex: Knex, value: string, datatype: string): Promise<number> {
    const existing = (await knex(T.nodes)
        .where({ [C.kind]: "literal", [C.value]: value, [C.datatype]: datatype })
        .select(C.id)
        .first()) as { id: number } | undefined;
    if (existing) {
        return existing.id;
    }
    const json = JSON.stringify({ v: coerceLiteralToJson(value, datatype), dt: datatype });
    const [row] = (await knex(T.nodes)
        .insert({
            [C.kind]: "literal",
            [C.value]: value,
            [C.datatype]: datatype,
            [C.valueJson]: json,
        })
        .returning(C.id)) as [{ id: number } | number];
    return typeof row === "object" ? row.id : row;
}

async function assertEdge(knex: Knex, s: number, p: number, o: number, g: number): Promise<void> {
    const exists = await knex(T.edges)
        .where({
            [C.subject]: s,
            [C.predicate]: p,
            [C.object]: o,
            [C.graph]: g,
            [C.isDeleted]: false,
        })
        .select(C.id)
        .first();
    if (exists) {
        return;
    }
    await knex(T.edges).insert({
        [C.subject]: s,
        [C.predicate]: p,
        [C.object]: o,
        [C.graph]: g,
        [C.isDeleted]: false,
    });
}

// ── Migration ─────────────────────────────────────────────────────────────────

export async function up(knex: Knex): Promise<void> {
    const client = (knex.client as { config: { client: string } }).config.client;
    const isPg = client === "pg" || client === "postgresql";

    // ── Schema ────────────────────────────────────────────────────────────────

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
            t.timestamp(C.createdAt, { useTz: true }).notNullable().defaultTo(knex.fn.now());
            t.timestamp(C.updatedAt, { useTz: true }).notNullable().defaultTo(knex.fn.now());
            if (isPg) {
                t.specificType(C.valueJson, "jsonb").nullable();
            } else {
                t.json(C.valueJson).nullable();
            }
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
            t.timestamp(C.createdAt, { useTz: true }).notNullable().defaultTo(knex.fn.now());
            t.timestamp(C.updatedAt, { useTz: true }).notNullable().defaultTo(knex.fn.now());
            t.boolean(C.isDeleted).notNullable().defaultTo(false);
            t.timestamp(C.deletedAt, { useTz: true }).nullable();
            // No UNIQUE constraint — soft-delete means the same quad can appear
            // multiple times in history. Active-quad deduplication is enforced at
            // the application level (SELECT-before-INSERT in TripleStore.insert).
            t.index([C.subject]);
            t.index([C.predicate]);
            t.index([C.object]);
            t.index([C.graph]);
            t.index([C.isDeleted, C.subject], "tern_edges_active_subject_idx");
            t.index([C.isDeleted, C.predicate], "tern_edges_active_predicate_idx");
            t.index([C.isDeleted, C.object], "tern_edges_active_object_idx");
        });
    }

    // ── Triggers ──────────────────────────────────────────────────────────────

    if (isPg) {
        await knex.raw(`
            CREATE OR REPLACE FUNCTION tern_node_timestamps()
            RETURNS TRIGGER LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    NEW.created_at = NOW();
                    NEW.updated_at = NOW();
                ELSE
                    NEW.created_at = OLD.created_at;
                    NEW.updated_at = NOW();
                END IF;
                RETURN NEW;
            END; $$;
        `);

        await knex.raw(`
            CREATE OR REPLACE FUNCTION tern_edge_timestamps()
            RETURNS TRIGGER LANGUAGE plpgsql AS $$
            BEGIN
                IF TG_OP = 'INSERT' THEN
                    NEW.created_at = NOW();
                    NEW.updated_at = NOW();
                ELSE
                    NEW.created_at = OLD.created_at;
                    NEW.updated_at = NOW();
                    IF NEW.is_deleted AND NOT OLD.is_deleted THEN
                        NEW.deleted_at = NOW();
                    END IF;
                END IF;
                RETURN NEW;
            END; $$;
        `);

        await knex.raw(`DROP TRIGGER IF EXISTS tern_nodes_timestamps ON ${T.nodes}`);
        await knex.raw(`
            CREATE TRIGGER tern_nodes_timestamps
            BEFORE INSERT OR UPDATE ON ${T.nodes}
            FOR EACH ROW EXECUTE FUNCTION tern_node_timestamps();
        `);

        await knex.raw(`DROP TRIGGER IF EXISTS tern_edges_timestamps ON ${T.edges}`);
        await knex.raw(`
            CREATE TRIGGER tern_edges_timestamps
            BEFORE INSERT OR UPDATE ON ${T.edges}
            FOR EACH ROW EXECUTE FUNCTION tern_edge_timestamps();
        `);
    } else {
        const ISO = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

        await knex.raw(`
            CREATE TRIGGER IF NOT EXISTS tern_nodes_ts_insert
            AFTER INSERT ON ${T.nodes}
            BEGIN
                UPDATE ${T.nodes}
                SET created_at = ${ISO},
                    updated_at = ${ISO}
                WHERE id = NEW.id;
            END;
        `);

        await knex.raw(`
            CREATE TRIGGER IF NOT EXISTS tern_edges_ts_insert
            AFTER INSERT ON ${T.edges}
            BEGIN
                UPDATE ${T.edges}
                SET created_at = ${ISO},
                    updated_at = ${ISO}
                WHERE id = NEW.id;
            END;
        `);

        await knex.raw(`
            CREATE TRIGGER IF NOT EXISTS tern_edges_ts_soft_delete
            AFTER UPDATE OF is_deleted ON ${T.edges}
            WHEN NEW.is_deleted = 1 AND OLD.is_deleted = 0
            BEGIN
                UPDATE ${T.edges}
                SET updated_at = ${ISO},
                    deleted_at = ${ISO}
                WHERE id = NEW.id;
            END;
        `);
    }

    // ── System bootstrap ──────────────────────────────────────────────────────

    const nsExists = await knex(T.namespaces).where(C.prefix, "rbac").first();
    if (!nsExists) {
        await knex(T.namespaces).insert({ [C.prefix]: "rbac", [C.iri]: RBAC_NS });
    }

    const graph = await internIRINode(knex, RBAC_GRAPH_IRI);
    const rdfType = await internIRINode(knex, RDF_TYPE);

    // Classes
    const clsInstall = await internIRINode(knex, CLS_INSTALL);
    const clsTenant = await internIRINode(knex, CLS_TENANT);
    const clsUserGroup = await internIRINode(knex, CLS_USER_GROUP);
    const clsRole = await internIRINode(knex, CLS_ROLE);
    const clsPermission = await internIRINode(knex, CLS_PERMISSION);
    const clsPolicyGrant = await internIRINode(knex, CLS_POLICY_GRANT);

    // Predicates
    const pInstallName = await internIRINode(knex, P_INSTALL_NAME);
    const pIsSystemInstall = await internIRINode(knex, P_IS_SYSTEM_INSTALL);
    const pHasTenant = await internIRINode(knex, P_HAS_TENANT);
    const pTenantName = await internIRINode(knex, P_TENANT_NAME);
    const pIsSystemTenant = await internIRINode(knex, P_IS_SYSTEM_TENANT);
    const pGroupName = await internIRINode(knex, P_GROUP_NAME);
    const pIsSystemGroup = await internIRINode(knex, P_IS_SYSTEM_GROUP);
    const pRoleName = await internIRINode(knex, P_ROLE_NAME);
    const pIsSystemRole = await internIRINode(knex, P_IS_SYSTEM_ROLE);
    const pPermissionKey = await internIRINode(knex, P_PERMISSION_KEY);
    const pIsDenial = await internIRINode(knex, P_IS_DENIAL);
    const pGrants = await internIRINode(knex, P_GRANTS);
    const pGrantPrincipal = await internIRINode(knex, P_GRANT_PRINCIPAL);
    const pGrantRole = await internIRINode(knex, P_GRANT_ROLE);

    // Entities
    const nSystemInstall = await internIRINode(knex, SYS_INSTALL_IRI);
    const nSystemTenant = await internIRINode(knex, SYS_TENANT_IRI);
    const nSuperusers = await internIRINode(knex, SYS_SUPERUSERS_IRI);
    const nSuperadmin = await internIRINode(knex, SYS_SUPERADMIN_IRI);
    const nWildcard = await internIRINode(knex, SYS_WILDCARD_IRI);
    const nGrant = await internIRINode(knex, SYS_GRANT_IRI);

    // Literals
    const litTrue = await internLiteralNode(knex, "true", XSD_BOOLEAN);
    const litFalse = await internLiteralNode(knex, "false", XSD_BOOLEAN);
    const litSystemName = await internLiteralNode(knex, "System", XSD_STRING);
    const litSuperusersName = await internLiteralNode(knex, "Superusers", XSD_STRING);
    const litSuperadminName = await internLiteralNode(knex, "Superadmin", XSD_STRING);
    const litWildcardKey = await internLiteralNode(knex, "*", XSD_STRING);

    // ── System Install ────────────────────────────────────────────────────────

    await assertEdge(knex, nSystemInstall, rdfType, clsInstall, graph);
    await assertEdge(knex, nSystemInstall, pInstallName, litSystemName, graph);
    await assertEdge(knex, nSystemInstall, pIsSystemInstall, litTrue, graph);

    // ── System Tenant (owned by Install) ─────────────────────────────────────

    await assertEdge(knex, nSystemInstall, pHasTenant, nSystemTenant, graph);
    await assertEdge(knex, nSystemTenant, rdfType, clsTenant, graph);
    await assertEdge(knex, nSystemTenant, pTenantName, litSystemName, graph);
    await assertEdge(knex, nSystemTenant, pIsSystemTenant, litTrue, graph);

    // ── Superusers Group ──────────────────────────────────────────────────────

    await assertEdge(knex, nSuperusers, rdfType, clsUserGroup, graph);
    await assertEdge(knex, nSuperusers, pGroupName, litSuperusersName, graph);
    await assertEdge(knex, nSuperusers, pIsSystemGroup, litTrue, graph);

    // ── Superadmin Role ───────────────────────────────────────────────────────

    await assertEdge(knex, nSuperadmin, rdfType, clsRole, graph);
    await assertEdge(knex, nSuperadmin, pRoleName, litSuperadminName, graph);
    await assertEdge(knex, nSuperadmin, pIsSystemRole, litTrue, graph);

    // ── Wildcard Permission ───────────────────────────────────────────────────

    await assertEdge(knex, nWildcard, rdfType, clsPermission, graph);
    await assertEdge(knex, nWildcard, pPermissionKey, litWildcardKey, graph);

    // Superadmin grants the wildcard
    await assertEdge(knex, nSuperadmin, pGrants, nWildcard, graph);

    // ── PolicyGrant: superusers → superadmin ──────────────────────────────────

    await assertEdge(knex, nGrant, rdfType, clsPolicyGrant, graph);
    await assertEdge(knex, nGrant, pGrantPrincipal, nSuperusers, graph);
    await assertEdge(knex, nGrant, pGrantRole, nSuperadmin, graph);
    await assertEdge(knex, nGrant, pIsDenial, litFalse, graph);
}

export async function down(knex: Knex): Promise<void> {
    const client = (knex.client as { config: { client: string } }).config.client;
    const isPg = client === "pg" || client === "postgresql";

    if (isPg) {
        await knex.raw(`DROP TRIGGER IF EXISTS tern_nodes_timestamps ON ${T.nodes}`);
        await knex.raw(`DROP TRIGGER IF EXISTS tern_edges_timestamps ON ${T.edges}`);
        await knex.raw(`DROP FUNCTION IF EXISTS tern_node_timestamps()`);
        await knex.raw(`DROP FUNCTION IF EXISTS tern_edge_timestamps()`);
    } else {
        await knex.raw("DROP TRIGGER IF EXISTS tern_nodes_ts_insert");
        await knex.raw("DROP TRIGGER IF EXISTS tern_edges_ts_insert");
        await knex.raw("DROP TRIGGER IF EXISTS tern_edges_ts_soft_delete");
    }

    await knex.schema.dropTableIfExists(T.edges);
    await knex.schema.dropTableIfExists(T.nodes);
    await knex.schema.dropTableIfExists(T.namespaces);
}
