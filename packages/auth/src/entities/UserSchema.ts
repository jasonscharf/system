import { avatarUrlIRI, displayNameIRI, emailIRI, UserIRI } from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";
import { AUTH_NS } from "../constants.js";

export const UserSchema = new EntitySchema({
    typeIRI: UserIRI,
    ns: AUTH_NS,
    properties: {
        email: emailIRI,
        displayName: displayNameIRI,
        avatarUrl: avatarUrlIRI,
    },
});
