/**
 * Tern infrastructure extension for Conversations.
 *
 * Registers as "tern.convos", requires "tern.rbac", and:
 *   1. Seeds all convos RBAC permissions and the two built-in roles
 *      (ConvoUser, ConvoModerator) via installConvos() — idempotent.
 *   2. Constructs and returns a fully-wired ConvoService and NotificationService.
 *
 * Usage in a consuming app:
 *
 *   import { rbacExtension, getRbacService }  from "@jasonscharf/server";
 *   import { convosExtension, getConvoService, getNotificationService,
 *             getConvosInstall }               from "@jasonscharf/convos";
 *
 *   const rbacInstalled  = await ternApp.use(rbacExtension);
 *   const convosInstalled = await ternApp.use(convosExtension);
 *
 *   const rbac    = getRbacService(rbacInstalled);
 *   const convos  = getConvoService(convosInstalled);
 *   const notifs  = getNotificationService(convosInstalled);
 *   const install = getConvosInstall(convosInstalled);
 *   // install.userRoleIri, install.moderatorRoleIri available for grants
 *
 * All services are also merged into the HandlerContext so WS message handlers
 * can access them as ctx.convos, ctx.notifs, ctx.convosInstall.
 */

import type { ExtensionInstallContext, InstalledExtension, TernExtension } from "@jasonscharf/app";
import type { TripleStore } from "@jasonscharf/data";
import type { RbacService } from "@jasonscharf/server";
import { buildServerContext, getRbacService } from "@jasonscharf/server";
import { ConvoService } from "./ConvoService.js";
import type { ConvosInstallResult } from "./install.js";
import { installConvos } from "./install.js";
import { NotificationService } from "./NotificationService.js";
import { ConversationRepository } from "./repository/ConversationRepository.js";
import { DraftRepository } from "./repository/DraftRepository.js";
import { InboxRepository } from "./repository/InboxRepository.js";
import { MessageRepository } from "./repository/MessageRepository.js";
import { NotificationRepository } from "./repository/NotificationRepository.js";
import { ParticipantRepository } from "./repository/ParticipantRepository.js";
import { ReadReceiptRepository } from "./repository/ReadReceiptRepository.js";

export const CONVOS_EXTENSION_NAME = "tern.convos" as const;

export const convosExtension: TernExtension = {
    name: CONVOS_EXTENSION_NAME,
    version: "0.1.0",
    description: "Conversations, threads, inboxes, notifications, and read receipts.",
    requires: ["tern.rbac"],

    async install({ store, extensions }: ExtensionInstallContext) {
        const typedStore = store as TripleStore;

        const rbacInstalled = extensions.get("tern.rbac");
        if (!rbacInstalled) {
            throw new Error("convosExtension: tern.rbac not found in installed extensions");
        }
        const rbac = getRbacService(rbacInstalled) as RbacService;

        const convosInstall = await installConvos(buildServerContext(typedStore), rbac);

        const notificationRepo = new NotificationRepository(typedStore);

        const convos = new ConvoService({
            conversations: new ConversationRepository(typedStore),
            messages: new MessageRepository(typedStore),
            participants: new ParticipantRepository(typedStore),
            drafts: new DraftRepository(typedStore),
            inboxes: new InboxRepository(typedStore),
            notifications: notificationRepo,
            receipts: new ReadReceiptRepository(typedStore),
            rbac,
        });

        const notifs = new NotificationService({ notifications: notificationRepo });

        return { convos, notifs, convosInstall };
    },
};

/**
 * Type-safe accessor — extracts the ConvoService from an InstalledExtension
 * returned by `ternApp.use(convosExtension)`.
 */
export function getConvoService(installed: InstalledExtension): ConvoService {
    const svc = installed.services.convos;
    if (!(svc instanceof ConvoService)) {
        throw new Error(
            "getConvoService: expected ConvoService — did you call ternApp.use(convosExtension)?",
        );
    }
    return svc;
}

/**
 * Type-safe accessor — extracts the NotificationService from an InstalledExtension
 * returned by `ternApp.use(convosExtension)`.
 */
export function getNotificationService(installed: InstalledExtension): NotificationService {
    const svc = installed.services.notifs;
    if (!(svc instanceof NotificationService)) {
        throw new Error(
            "getNotificationService: expected NotificationService — did you call ternApp.use(convosExtension)?",
        );
    }
    return svc;
}

/**
 * Type-safe accessor — extracts the ConvosInstallResult (which carries the
 * ConvoUser and ConvoModerator role IRIs) from an InstalledExtension.
 */
export function getConvosInstall(installed: InstalledExtension): ConvosInstallResult {
    const result = installed.services.convosInstall;
    if (!result || typeof result !== "object" || !("userRoleIri" in result)) {
        throw new Error(
            "getConvosInstall: expected ConvosInstallResult — did you call ternApp.use(convosExtension)?",
        );
    }
    return result as ConvosInstallResult;
}
