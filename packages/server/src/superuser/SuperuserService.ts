import { SYS_SUPERUSERS_IRI } from "../rbac/constants.js";
import type { RbacService } from "../rbac/RbacService.js";
import type { SecurityContext } from "../SecurityContext.js";
import type { ServerContext } from "../ServerContext.js";

export interface SuperuserArgs {
    /** IRI of the user whose superuser status is being read or changed. */
    userIri: string;
}

/**
 * Superuser membership, expressed as membership of the system-seeded
 * SYS_SUPERUSERS group (see migration 004_rbac). It is deliberately a thin
 * facade over RBAC rather than a parallel mechanism: downstream applications
 * grant roles/permissions to the superusers group to decide what "superuser"
 * actually unlocks in their app.
 */
export class SuperuserService {
    private readonly _rbac: RbacService;

    constructor(rbac: RbacService) {
        this._rbac = rbac;
    }

    async isSuperuser(
        ctx: ServerContext,
        sec: SecurityContext,
        args: SuperuserArgs,
    ): Promise<boolean> {
        const members = await this._rbac.listMembers(ctx, sec, { groupIri: SYS_SUPERUSERS_IRI });
        return members.includes(args.userIri);
    }

    async grant(ctx: ServerContext, sec: SecurityContext, args: SuperuserArgs): Promise<void> {
        await this._rbac.addMember(ctx, sec, {
            groupIri: SYS_SUPERUSERS_IRI,
            memberIri: args.userIri,
        });
    }

    async revoke(ctx: ServerContext, sec: SecurityContext, args: SuperuserArgs): Promise<void> {
        await this._rbac.removeMember(ctx, sec, {
            groupIri: SYS_SUPERUSERS_IRI,
            memberIri: args.userIri,
        });
    }

    async list(ctx: ServerContext, sec: SecurityContext): Promise<string[]> {
        return this._rbac.listMembers(ctx, sec, { groupIri: SYS_SUPERUSERS_IRI });
    }
}
