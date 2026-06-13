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
        accessToken: accessTokenIRI,
        refreshToken: refreshTokenIRI,
        tokenExpiresAt: tokenExpiresAtIRI,
        // The owning user, stored as a property holding the user's IRI — matching
        // how sessionUser / deviceUser / attemptUser are modeled on their schemas.
        identityOf: identityOfIRI,
    },
});
