import { avatarUrlIRI, displayNameIRI, emailIRI, UserIRI } from "@terncosoftware/core";
import { EntitySchema } from "@terncosoftware/entities";
import { AUTH_NS } from "../constants.js";

export const UserSchema = new EntitySchema({
    typeIRI: UserIRI,
    ns: AUTH_NS,
    properties: {
        // email is intentionally NOT PII here: it is a lookup key (findByEmail)
        // that needs deterministic query-term encryption not yet built — deferred
        // (TRN-194 follow-up).  displayName / avatarUrl are at-rest PII.
        email: emailIRI,
        displayName: { iri: displayNameIRI, pii: true },
        avatarUrl: { iri: avatarUrlIRI, pii: true },
    },
});
