import { IRI, makeUri, NS_CORE } from "@jasonscharf/core";

export const RBAC_NS = makeUri(NS_CORE, "rbac");
export const RBAC_GRAPH = new IRI(makeUri(RBAC_NS, "graph"));

// Stable system entity IDs — must match values in migration 001_init
export const SYS_INSTALL_ID = "sys0000000000000000000000000006";
export const SYS_TENANT_ID = "sys0000000000000000000000000001";
export const SYS_SUPERUSERS_ID = "sys0000000000000000000000000002";
export const SYS_SUPERADMIN_ID = "sys0000000000000000000000000003";
export const SYS_WILDCARD_PERM_ID = "sys0000000000000000000000000004";
export const SYS_GRANT_ID = "sys0000000000000000000000000005";

// Derived system IRIs
export const SYS_INSTALL_IRI = makeUri(RBAC_NS, "install", SYS_INSTALL_ID);
export const SYS_TENANT_IRI = makeUri(RBAC_NS, "tenant", SYS_TENANT_ID);
export const SYS_SUPERUSERS_IRI = makeUri(RBAC_NS, "group", SYS_SUPERUSERS_ID);
export const SYS_SUPERADMIN_IRI = makeUri(RBAC_NS, "role", SYS_SUPERADMIN_ID);
export const SYS_WILDCARD_PERM_IRI = makeUri(RBAC_NS, "permission", SYS_WILDCARD_PERM_ID);
export const SYS_GRANT_IRI = makeUri(RBAC_NS, "grant", SYS_GRANT_ID);

export const WILDCARD_PERMISSION = "*";

/**
 * Capability required to administer RBAC itself — create/update/delete tenants,
 * groups, roles, permissions, grants, resources, service accounts, manage
 * membership and impersonation, and introspect RBAC configuration.
 *
 * Enforced by RbacService on every admin method (TRN-206). Held implicitly by
 * the Superadmin role via the wildcard "*" permission, so the system-seeded
 * superusers group already satisfies it; grant it to additional roles to
 * delegate RBAC administration.
 */
export const RBAC_ADMIN_PERMISSION = "tern.rbac:admin";

export const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
export const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
export const XSD_STRING = new IRI(`${XSD_NS}string`);
export const XSD_BOOLEAN = new IRI(`${XSD_NS}boolean`);
export const XSD_DATETIME = new IRI(`${XSD_NS}dateTime`);
