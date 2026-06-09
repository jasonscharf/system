// auto-generated — do not edit by hand

import { IRI } from "../semantics/IRI.js";

/** A licensable product offered by the platform (e.g. analytics, optimization). */
export interface Product {
    /** Display name of the product. */
    productName: string;
    /** URL-safe unique identifier, e.g. 'labs'. */
    productSlug: string;
    /** Human-readable description of the product. */
    productDescription?: string;
    /** Stock-keeping unit identifier for billing and catalog integration. */
    productSku?: string;
}

export const ProductIRI = new IRI("urn:sys:core:licensing:Product");

/** An agreement granting a Tenant the right to use one or more Products. */
export interface License {
    /** Outward edge: a License holds an Entitlement (license→entitlement). */
    hasEntitlement?: Entitlement[];
    /** License status: active | trialing | expired | cancelled | suspended. */
    licenseStatus: string;
    /** Date the license becomes effective. */
    licenseStartDate?: Date;
    /** Date the license expires. */
    licenseEndDate?: Date;
    /** Whether the license automatically renews before expiry. */
    licenseAutoRenew?: boolean;
    /** Provider-agnostic payment reference (subscription or order ID). */
    licensePaymentRef?: string;
    /** Current payment status: paid | pending | failed | refunded. */
    licensePaymentStatus?: string;
}

export const LicenseIRI = new IRI("urn:sys:core:licensing:License");

/** Per-product limits and rights within a License. */
export interface Entitlement {
    /** The Product covered by this Entitlement. */
    entitlementProduct: Product;
    /** Maximum number of seats (stored as string; absent = unlimited). */
    entitlementSeatsLimit?: string;
    /** Maximum monthly sessions (stored as string; absent = unlimited). */
    entitlementSessionsLimit?: string;
}

export const EntitlementIRI = new IRI("urn:sys:core:licensing:Entitlement");

export const hasEntitlementIRI = new IRI("urn:sys:core:licensing:hasEntitlement");
export const entitlementProductIRI = new IRI("urn:sys:core:licensing:entitlementProduct");
export const productNameIRI = new IRI("urn:sys:core:licensing:productName");
export const productSlugIRI = new IRI("urn:sys:core:licensing:productSlug");
export const productDescriptionIRI = new IRI("urn:sys:core:licensing:productDescription");
export const productSkuIRI = new IRI("urn:sys:core:licensing:productSku");
export const licenseStatusIRI = new IRI("urn:sys:core:licensing:licenseStatus");
export const licenseStartDateIRI = new IRI("urn:sys:core:licensing:licenseStartDate");
export const licenseEndDateIRI = new IRI("urn:sys:core:licensing:licenseEndDate");
export const licenseAutoRenewIRI = new IRI("urn:sys:core:licensing:licenseAutoRenew");
export const licensePaymentRefIRI = new IRI("urn:sys:core:licensing:licensePaymentRef");
export const licensePaymentStatusIRI = new IRI("urn:sys:core:licensing:licensePaymentStatus");
export const entitlementSeatsLimitIRI = new IRI("urn:sys:core:licensing:entitlementSeatsLimit");
export const entitlementSessionsLimitIRI = new IRI(
    "urn:sys:core:licensing:entitlementSessionsLimit",
);
