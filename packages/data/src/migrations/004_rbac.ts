import { makeUri, NS_CORE } from "@jasonscharf/core";
import type { Knex } from "knex";
import { C, T } from "../schema.js";

/**
 * Bootstraps the RBAC graph with three system-level entities:
 *
 *   sys:rbac:tenant     — the single root Tenant all system entities live under
 *   sys:rbac:superusers — a Group whose members have unrestricted system access
 *   sys:rbac:superadmin — a Role that grants the wildcard (*) permission
 *
 * The grant chain is:
 *   superusers --[grantPrincipal]-- PolicyGrant --[grantRole]--> superadmin
 *   superadmin --[grants]--> wildcard (permissionKey = "*")
 *
 * All entities use stable IDs (sys000…001 through sys000…005) so the IRIs
 * are predictable and importable as constants without a DB lookup.
 */

const RBAC_NS = makeUri(NS_CORE, "rbac");
const RBAC_GRAPH_IRI = makeUri(RBAC_NS, "graph");
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";

// Stable system IDs — must match constants in @jasonscharf/server
const SYS_TENANT_ID = "sys0000000000000000000000000001";
const SYS_SUPERUSERS_ID = "sys0000000000000000000000000002";
const SYS_SUPERADMIN_ID = "sys0000000000000000000000000003";
const SYS_WILDCARD_ID = "sys0000000000000000000000000004";
const SYS_GRANT_ID = "sys0000000000000000000000000005";

// Derived IRIs
const SYS_TENANT_IRI = makeUri(RBAC_NS, "tenant", SYS_TENANT_ID);
const SYS_SUPERUSERS_IRI = makeUri(RBAC_NS, "group", SYS_SUPERUSERS_ID);
const SYS_SUPERADMIN_IRI = makeUri(RBAC_NS, "role", SYS_SUPERADMIN_ID);
const SYS_WILDCARD_IRI = makeUri(RBAC_NS, "permission", SYS_WILDCARD_ID);
const SYS_GRANT_IRI = makeUri(RBAC_NS, "grant", SYS_GRANT_ID);

// Class IRIs
const CLS_TENANT = makeUri(RBAC_NS, "Tenant");
const CLS_USER_GROUP = makeUri(RBAC_NS, "UserGroup");
const CLS_ROLE = makeUri(RBAC_NS, "Role");
const CLS_PERMISSION = makeUri(RBAC_NS, "Permission");
const CLS_POLICY_GRANT = makeUri(RBAC_NS, "PolicyGrant");

// Predicate IRIs
const P_TENANT_NAME = makeUri(RBAC_NS, "tenantName");
const P_IS_SYSTEM_TENANT = makeUri(RBAC_NS, "isSystemTenant");
const P_GROUP_NAME = makeUri(RBAC_NS, "groupName");
const P_IS_SYSTEM_GROUP = makeUri(RBAC_NS, "isSystemGroup");
const P_ROLE_NAME = makeUri(RBAC_NS, "roleName");
const P_IS_SYSTEM_ROLE = makeUri(RBAC_NS, "isSystemRole");
const P_PERMISSION_KEY = makeUri(RBAC_NS, "permissionKey");
const P_IS_DENIAL = makeUri(RBAC_NS, "isDenial");
const P_IN_TENANT = makeUri(RBAC_NS, "isInTenant");
const P_GRANTS = makeUri(RBAC_NS, "grants");
const P_GRANT_PRINCIPAL = makeUri(RBAC_NS, "hasPrincipal");
const P_GRANT_ROLE = makeUri(RBAC_NS, "hasRole");

// ── Helpers ───────────────────────────────────────────────────────────────────

async function internName(knex: Knex, iriStr: string): Promise<number> {
    const existing = (await knex(T.names).where(C.iri, iriStr).select(C.id).first()) as
        | { id: number }
        | undefined;
    if (existing) {
        return existing.id;
    }
    const [row] = (await knex(T.names)
        .insert({ [C.iri]: iriStr })
        .returning(C.id)) as [{ id: number } | number];
    return typeof row === "object" ? row.id : row;
}

async function internIRINode(knex: Knex, iriStr: string): Promise<number> {
    const nameId = await internName(knex, iriStr);
    const existing = (await knex(T.nodes)
        .where({ [C.kind]: "iri", [C.nameId]: nameId })
        .select(C.id)
        .first()) as { id: number } | undefined;
    if (existing) {
        return existing.id;
    }
    const [row] = (await knex(T.nodes)
        .insert({ [C.kind]: "iri", [C.nameId]: nameId })
        .returning(C.id)) as [{ id: number } | number];
    return typeof row === "object" ? row.id : row;
}

async function internLiteralNode(knex: Knex, value: string, datatype: string): Promise<number> {
    const existing = (await knex(T.nodes)
        .where({ [C.kind]: "literal", [C.value]: value, [C.datatype]: datatype })
        .select(C.id)
        .first()) as { id: number } | undefined;
    if (existing) {
        return existing.id;
    }
    const json = JSON.stringify({ v: value, dt: datatype });
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
    const nsExists = await knex(T.namespaces).where(C.prefix, "rbac").first();
    if (!nsExists) {
        await knex(T.namespaces).insert({ [C.prefix]: "rbac", [C.iri]: RBAC_NS });
    }

    // ── Intern all node IRIs ──────────────────────────────────────────────────

    const graph = await internIRINode(knex, RBAC_GRAPH_IRI);
    const rdfType = await internIRINode(knex, RDF_TYPE);

    // Classes
    const clsTenant = await internIRINode(knex, CLS_TENANT);
    const clsUserGroup = await internIRINode(knex, CLS_USER_GROUP);
    const clsRole = await internIRINode(knex, CLS_ROLE);
    const clsPermission = await internIRINode(knex, CLS_PERMISSION);
    const clsPolicyGrant = await internIRINode(knex, CLS_POLICY_GRANT);

    // Predicates
    const pTenantName = await internIRINode(knex, P_TENANT_NAME);
    const pIsSystemTenant = await internIRINode(knex, P_IS_SYSTEM_TENANT);
    const pGroupName = await internIRINode(knex, P_GROUP_NAME);
    const pIsSystemGroup = await internIRINode(knex, P_IS_SYSTEM_GROUP);
    const pRoleName = await internIRINode(knex, P_ROLE_NAME);
    const pIsSystemRole = await internIRINode(knex, P_IS_SYSTEM_ROLE);
    const pPermissionKey = await internIRINode(knex, P_PERMISSION_KEY);
    const pIsDenial = await internIRINode(knex, P_IS_DENIAL);
    const pInTenant = await internIRINode(knex, P_IN_TENANT);
    const pGrants = await internIRINode(knex, P_GRANTS);
    const pGrantPrincipal = await internIRINode(knex, P_GRANT_PRINCIPAL);
    const pGrantRole = await internIRINode(knex, P_GRANT_ROLE);

    // Entities
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

    // ── System Tenant ─────────────────────────────────────────────────────────

    await assertEdge(knex, nSystemTenant, rdfType, clsTenant, graph);
    await assertEdge(knex, nSystemTenant, pTenantName, litSystemName, graph);
    await assertEdge(knex, nSystemTenant, pIsSystemTenant, litTrue, graph);

    // ── Superusers Group ──────────────────────────────────────────────────────

    await assertEdge(knex, nSuperusers, rdfType, clsUserGroup, graph);
    await assertEdge(knex, nSuperusers, pGroupName, litSuperusersName, graph);
    await assertEdge(knex, nSuperusers, pIsSystemGroup, litTrue, graph);
    await assertEdge(knex, nSuperusers, pInTenant, nSystemTenant, graph);

    // ── Superadmin Role ───────────────────────────────────────────────────────

    await assertEdge(knex, nSuperadmin, rdfType, clsRole, graph);
    await assertEdge(knex, nSuperadmin, pRoleName, litSuperadminName, graph);
    await assertEdge(knex, nSuperadmin, pIsSystemRole, litTrue, graph);
    await assertEdge(knex, nSuperadmin, pInTenant, nSystemTenant, graph);

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
    // Soft-delete every edge in the RBAC named graph
    const graphNameRow = (await knex(T.names).where(C.iri, RBAC_GRAPH_IRI).select(C.id).first()) as
        | { id: number }
        | undefined;
    if (!graphNameRow) {
        return;
    }
    const graphNodeRow = (await knex(T.nodes)
        .where({ [C.kind]: "iri", [C.nameId]: graphNameRow.id })
        .select(C.id)
        .first()) as { id: number } | undefined;
    if (!graphNodeRow) {
        return;
    }

    const now = new Date().toISOString();
    await knex(T.edges)
        .where(C.graph, graphNodeRow.id)
        .where(C.isDeleted, false)
        .update({ [C.isDeleted]: true, [C.deletedAt]: now });

    await knex(T.namespaces).where(C.prefix, "rbac").delete();
}
