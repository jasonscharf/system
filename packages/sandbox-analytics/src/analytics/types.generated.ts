// auto-generated — do not edit by hand
import { IRI } from '@jasonscharf/core';
import type { User, UserDevice, UserIdentity, UserSession } from '@jasonscharf/core';

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

export const ProjectIRI = new IRI('http://tern.dev/ns/analytics/Project');

declare module '@jasonscharf/core' {
    interface User {
        /** Platform role: 'owner', 'member', or 'viewer'. */
        analyticsRole: string;
        /** Timestamp of the user's most recent analytics activity. */
        lastActiveAt?: Date;
        /** GDPR tracking consent flag. */
        consentedToTracking?: boolean;
    }
}

export const analyticsRoleIRI = new IRI('http://tern.dev/ns/analytics/analyticsRole');
export const lastActiveAtIRI = new IRI('http://tern.dev/ns/analytics/lastActiveAt');
export const consentedToTrackingIRI = new IRI('http://tern.dev/ns/analytics/consentedToTracking');
export const projectNameIRI = new IRI('http://tern.dev/ns/analytics/projectName');
export const projectSlugIRI = new IRI('http://tern.dev/ns/analytics/projectSlug');
export const isActiveIRI = new IRI('http://tern.dev/ns/analytics/isActive');
export const projectCreatedAtIRI = new IRI('http://tern.dev/ns/analytics/projectCreatedAt');
export const projectOwnerIRI = new IRI('http://tern.dev/ns/analytics/projectOwner');
export const projectMemberIRI = new IRI('http://tern.dev/ns/analytics/projectMember');
