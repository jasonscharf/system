import { randomBytes } from "node:crypto";
import {
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
        sessionUser: sessionUserIRI,
        sessionDevice: sessionDeviceIRI,
    },
    defaults: {
        sessionToken: () => randomBytes(32).toString("hex"),
        isActive: true,
    },
});
