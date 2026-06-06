import {
    attemptUserIRI,
    authRedirectUrlIRI,
    claimIRI,
    createdAtIRI,
    errorCodeIRI,
    ipAddressIRI,
    LoginAttemptIRI,
    nonceIRI,
    providerIRI,
    statusIRI,
    updatedAtIRI,
    userAgentIRI,
    utmCampaignIRI,
    utmMediumIRI,
    utmSourceIRI,
} from "@jasonscharf/core";
import { EntitySchema } from "@jasonscharf/entities";
import { AUTH_NS } from "../constants.js";

export const LoginAttemptSchema = new EntitySchema({
    typeIRI: LoginAttemptIRI,
    ns: AUTH_NS,
    properties: {
        provider: providerIRI,
        status: statusIRI,
        nonce: nonceIRI,
        errorCode: errorCodeIRI,
        ipAddress: ipAddressIRI,
        userAgent: userAgentIRI,
        claim: claimIRI,
        utmSource: utmSourceIRI,
        utmMedium: utmMediumIRI,
        utmCampaign: utmCampaignIRI,
        authRedirectUrl: authRedirectUrlIRI,
        createdAt: createdAtIRI,
        updatedAt: updatedAtIRI,
        attemptUser: attemptUserIRI,
    },
    defaults: {
        status: "pending",
        createdAt: () => new Date(),
        updatedAt: () => new Date(),
    },
});
