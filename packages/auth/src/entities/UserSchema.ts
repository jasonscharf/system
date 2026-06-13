import { avatarUrlIRI, displayNameIRI, emailIRI, UserIRI } from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";
import { AUTH_GRAPH, AUTH_NS } from "../constants.js";

export const UserSchema = new EntitySchema({
    typeIRI: UserIRI,
    ns: AUTH_NS,
    graphIri: AUTH_GRAPH,
    properties: {
        email: emailIRI,
        displayName: displayNameIRI,
        avatarUrl: avatarUrlIRI,
    },
});
