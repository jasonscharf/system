// auto-generated — do not edit by hand

import type { User } from "../auth/types.generated.js";
import { IRI } from "../semantics/IRI.js";

/** Singleton membership set node that tracks platform superusers. */
export interface Superuser {
    /** A user who holds superuser privileges (one triple per superuser). */
    user?: User[];
    /** Timestamp when superuser access was most recently granted. */
    grantedAt?: Date;
}

export const SuperuserIRI = new IRI("urn:sys:core:superuser:Superuser");

export const userIRI = new IRI("urn:sys:core:superuser:user");
export const grantedAtIRI = new IRI("urn:sys:core:superuser:grantedAt");
