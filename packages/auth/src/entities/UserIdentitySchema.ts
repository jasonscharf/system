import {
    accessTokenIRI,
    identityOfIRI,
    providerEmailIRI,
    providerIRI,
    providerUserIdIRI,
    refreshTokenIRI,
    tokenExpiresAtIRI,
    UserIdentityIRI,
} from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";
import { AUTH_GRAPH, AUTH_NS } from "../constants.js";

export const UserIdentitySchema = new EntitySchema({
    typeIRI: UserIdentityIRI,
    ns: AUTH_NS,
    graphIri: AUTH_GRAPH,
    properties: {
        provider: providerIRI,
        providerUserId: providerUserIdIRI,
        providerEmail: providerEmailIRI,
        // accessToken / refreshToken are at-rest PII (TRN-194 / closes TRN-169):
        // EntityStore encrypts them on write and decrypts on read, so the nodes
        // table holds ciphertext while repo callers see cleartext.
        accessToken: { iri: accessTokenIRI, pii: true },
        refreshToken: { iri: refreshTokenIRI, pii: true },
        tokenExpiresAt: tokenExpiresAtIRI,
        // The owning user, stored as a property holding the user's IRI — matching
        // how sessionUser / deviceUser / attemptUser are modeled on their schemas.
        identityOf: identityOfIRI,
    },
});
