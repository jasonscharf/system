// auto-generated — do not edit by hand

import { IRI } from "@jasonscharf/core";

/** A named menu: an aggregate root that owns a set of menu items. The slot keys which placeholder in the shell renders it. */
export interface Menu {
    /** Human-readable, accessible label for the menu (e.g. aria-label). */
    menuLabel?: string;
    /** Named shell slot this menu targets; absent means the default (unnamed) menu. */
    menuSlot?: string;
    /** Outward edge: a Menu contains a MenuItem (root→down). */
    hasItem?: MenuItem[];
}

export const MenuIRI = new IRI("urn:sys:ui:Menu");

/** A single contributed menu item. Activating it invokes a dispatch message of the configured kind. */
export interface MenuItem {
    /** Human-readable label rendered for the item. */
    label?: string;
    /** Ordering within siblings (ascending). Defaults to 0. */
    order?: number;
    /** Optional capability/feature-flag gate; the item (and its subtree) is omitted when the capability is not granted. */
    requires?: string;
    /** Optional icon name, resolved by the renderer. */
    icon?: string;
    /** Which dispatch message kind activation invokes: command, query, operation, or event. */
    dispatchKind?: string;
    /** Name of the dispatch message invoked on activation, e.g. 'nav.go'. Absent for pure grouping items. */
    message?: string;
    /** Serialized JSON argument/payload passed with the dispatch message on activation. */
    messageArg?: string;
    /** Parent item in the menu tree. Absent means a top-level item. */
    hasParent?: MenuItem;
}

export const MenuItemIRI = new IRI("urn:sys:ui:MenuItem");

export const menuLabelIRI = new IRI("urn:sys:ui:menuLabel");
export const menuSlotIRI = new IRI("urn:sys:ui:menuSlot");
export const labelIRI = new IRI("urn:sys:ui:label");
export const orderIRI = new IRI("urn:sys:ui:order");
export const requiresIRI = new IRI("urn:sys:ui:requires");
export const iconIRI = new IRI("urn:sys:ui:icon");
export const dispatchKindIRI = new IRI("urn:sys:ui:dispatchKind");
export const messageIRI = new IRI("urn:sys:ui:message");
export const messageArgIRI = new IRI("urn:sys:ui:messageArg");
export const hasItemIRI = new IRI("urn:sys:ui:hasItem");
export const hasParentIRI = new IRI("urn:sys:ui:hasParent");
