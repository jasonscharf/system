import { IRI, NS_ROOT } from "@jasonscharf/core";

export const RBAC_NS = `${NS_ROOT}rbac:`;
export const RBAC_GRAPH = new IRI(`${RBAC_NS}graph`);

// Stable system entity IDs — must match values in migration 004_rbac
export const SYS_TENANT_ID = "sys0000000000000000000000000001";
export const SYS_SUPERUSERS_ID = "sys0000000000000000000000000002";
export const SYS_SUPERADMIN_ID = "sys0000000000000000000000000003";
export const SYS_WILDCARD_PERM_ID = "sys0000000000000000000000000004";
export const SYS_GRANT_ID = "sys0000000000000000000000000005";

// Derived system IRIs
export const SYS_TENANT_IRI = `${RBAC_NS}tenant:${SYS_TENANT_ID}`;
export const SYS_SUPERUSERS_IRI = `${RBAC_NS}group:${SYS_SUPERUSERS_ID}`;
export const SYS_SUPERADMIN_IRI = `${RBAC_NS}role:${SYS_SUPERADMIN_ID}`;
export const SYS_WILDCARD_PERM_IRI = `${RBAC_NS}permission:${SYS_WILDCARD_PERM_ID}`;
export const SYS_GRANT_IRI = `${RBAC_NS}grant:${SYS_GRANT_ID}`;

export const WILDCARD_PERMISSION = "*";

export const RDF_TYPE = new IRI("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
export const XSD_NS = "http://www.w3.org/2001/XMLSchema#";
export const XSD_STRING = new IRI(`${XSD_NS}string`);
export const XSD_BOOLEAN = new IRI(`${XSD_NS}boolean`);
export const XSD_DATETIME = new IRI(`${XSD_NS}dateTime`);
