// auto-generated — do not edit by hand

import type { User } from "@jasonscharf/core";
import { IRI } from "@jasonscharf/core";

/** An analytics workspace scoped to a team or product. */
export interface Project {
    /** Human-readable project name. */
    projectName: string;
    /** URL-safe identifier.  SHACL pattern: ^[a-z0-9][a-z0-9-]+[a-z0-9]$ */
    projectSlug: string;
    /** Whether this project is currently active. */
    isActive?: boolean;
    /** Project creation timestamp. */
    projectCreatedAt?: Date;
    /** The user who created and owns this project. */
    projectOwner: User;
    /** A collaborator with access to this project (0 or more). */
    projectMember?: User[];
}

export const ProjectIRI = new IRI("urn:tern:ext:labs:Project");

declare module "@jasonscharf/core" {
    interface User {
        /** Platform role: 'owner', 'member', or 'viewer'. */
        analyticsRole: string;
        /** Timestamp of the user's most recent analytics activity. */
        lastActiveAt?: Date;
        /** GDPR tracking consent flag. */
        consentedToTracking?: boolean;
    }
}

export const analyticsRoleIRI = new IRI("urn:tern:ext:labs:analyticsRole");
export const lastActiveAtIRI = new IRI("urn:tern:ext:labs:lastActiveAt");
export const consentedToTrackingIRI = new IRI("urn:tern:ext:labs:consentedToTracking");
export const projectNameIRI = new IRI("urn:tern:ext:labs:projectName");
export const projectSlugIRI = new IRI("urn:tern:ext:labs:projectSlug");
export const isActiveIRI = new IRI("urn:tern:ext:labs:isActive");
export const projectCreatedAtIRI = new IRI("urn:tern:ext:labs:projectCreatedAt");
export const projectOwnerIRI = new IRI("urn:tern:ext:labs:projectOwner");
export const projectMemberIRI = new IRI("urn:tern:ext:labs:projectMember");
