// auto-generated — do not edit by hand
import { IRI } from "../semantics/IRI.js";

export const LICENSING_NS = "urn:sys:core:licensing:";

/** A licensable product offered by the platform (e.g. analytics, optimization). */
export interface Product {
    productName?: string;
    productSlug?: string;
    productDescription?: string;
}

export const ProductIRI = new IRI(`${LICENSING_NS}Product`);

/** An agreement granting a Tenant the right to use one or more Products. */
export interface License {
    licenseStatus?: string;
    licenseStartDate?: Date;
    licenseEndDate?: Date;
    licenseAutoRenew?: boolean;
    licensePaymentRef?: string;
    licensePaymentStatus?: string;
}

export const LicenseIRI = new IRI(`${LICENSING_NS}License`);

/** Per-product limits and rights within a License. */
export interface Entitlement {
    entitlementSeatsLimit?: string;
    entitlementSessionsLimit?: string;
}

export const EntitlementIRI = new IRI(`${LICENSING_NS}Entitlement`);

// Topology edges
export const hasEntitlementIRI = new IRI(`${LICENSING_NS}hasEntitlement`);
export const entitlementProductIRI = new IRI(`${LICENSING_NS}entitlementProduct`);

// Product predicates
export const productNameIRI = new IRI(`${LICENSING_NS}productName`);
export const productSlugIRI = new IRI(`${LICENSING_NS}productSlug`);
export const productDescriptionIRI = new IRI(`${LICENSING_NS}productDescription`);

// License predicates
export const licenseStatusIRI = new IRI(`${LICENSING_NS}licenseStatus`);
export const licenseStartDateIRI = new IRI(`${LICENSING_NS}licenseStartDate`);
export const licenseEndDateIRI = new IRI(`${LICENSING_NS}licenseEndDate`);
export const licenseAutoRenewIRI = new IRI(`${LICENSING_NS}licenseAutoRenew`);
export const licensePaymentRefIRI = new IRI(`${LICENSING_NS}licensePaymentRef`);
export const licensePaymentStatusIRI = new IRI(`${LICENSING_NS}licensePaymentStatus`);

// Entitlement predicates
export const entitlementSeatsLimitIRI = new IRI(`${LICENSING_NS}entitlementSeatsLimit`);
export const entitlementSessionsLimitIRI = new IRI(`${LICENSING_NS}entitlementSessionsLimit`);
