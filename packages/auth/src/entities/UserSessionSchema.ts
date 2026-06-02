import { randomBytes } from "node:crypto";
import {
    createdAtIRI,
    expiresAtIRI,
    ipAddressIRI,
    isActiveIRI,
    sessionDeviceIRI,
    sessionTokenIRI,
    sessionUserIRI,
    UserSessionIRI,
} from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";
import { AUTH_NS } from "../constants.js";

export const UserSessionSchema = new EntitySchema({
    typeIRI: UserSessionIRI,
    ns: AUTH_NS,
    properties: {
        sessionToken: sessionTokenIRI,
        expiresAt: expiresAtIRI,
        isActive: isActiveIRI,
        ipAddress: ipAddressIRI,
        createdAt: createdAtIRI,
        sessionUser: sessionUserIRI,
        sessionDevice: sessionDeviceIRI,
    },
    defaults: {
        sessionToken: () => randomBytes(32).toString("hex"),
        createdAt: () => new Date(),
        isActive: true,
    },
});
