import {
    avatarUrlIRI,
    createdAtIRI,
    displayNameIRI,
    emailIRI,
    UserIRI,
    updatedAtIRI,
} from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";
import { AUTH_NS } from "../constants.js";

export const UserSchema = new EntitySchema({
    typeIRI: UserIRI,
    ns: AUTH_NS,
    properties: {
        email: emailIRI,
        displayName: displayNameIRI,
        avatarUrl: avatarUrlIRI,
        createdAt: createdAtIRI,
        updatedAt: updatedAtIRI,
    },
    defaults: {
        createdAt: () => new Date(),
        updatedAt: () => new Date(),
    },
});
