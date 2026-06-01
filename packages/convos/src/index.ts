// ── Constants ─────────────────────────────────────────────────────────────────

// ── Service ───────────────────────────────────────────────────────────────────
export type { ConvoServiceOptions } from "./ConvoService.js";
export { ConvoService } from "./ConvoService.js";
export { CONVOS_GRAPH, CONVOS_NS } from "./constants.js";
// ── Extension lifecycle ───────────────────────────────────────────────────────
export {
    CONVOS_EXTENSION_NAME,
    convosExtension,
    getConvoService,
    getConvosInstall,
    getNotificationService,
} from "./extension.js";
export type { ConvosInstallResult } from "./install.js";
export {
    CONVO_MODERATOR_ROLE_NAME,
    CONVO_USER_ROLE_NAME,
    installConvos,
    uninstallConvos,
} from "./install.js";
export type { NotificationServiceOptions } from "./NotificationService.js";
export { NotificationService } from "./NotificationService.js";

// ── Permissions ───────────────────────────────────────────────────────────────
export {
    ALL_CONVOS_PERMISSIONS,
    CONVO_MODERATOR_PERMISSIONS,
    CONVO_USER_PERMISSIONS,
    PERM_CONVO_ARCHIVE,
    PERM_CONVO_ASSIGN,
    PERM_CONVO_CLOSE,
    PERM_CONVO_CREATE,
    PERM_CONVO_READ,
    PERM_INBOX_CREATE,
    PERM_INBOX_MANAGE,
    PERM_MESSAGE_DELETE_ANY,
    PERM_MESSAGE_DELETE_OWN,
    PERM_MESSAGE_EDIT_ANY,
    PERM_MESSAGE_EDIT_OWN,
    PERM_MESSAGE_POST,
    PERM_PARTICIPANT_MANAGE,
} from "./permissions.js";

// ── Repositories ──────────────────────────────────────────────────────────────
export { ConversationRepository } from "./repository/ConversationRepository.js";
export { DraftRepository } from "./repository/DraftRepository.js";
export { InboxRepository } from "./repository/InboxRepository.js";
export { MessageRepository } from "./repository/MessageRepository.js";
export type { CreateNotificationInput } from "./repository/NotificationRepository.js";
export { NotificationRepository } from "./repository/NotificationRepository.js";
export { ParticipantRepository } from "./repository/ParticipantRepository.js";
export { ReadReceiptRepository } from "./repository/ReadReceiptRepository.js";
// ── Types ─────────────────────────────────────────────────────────────────────
export type {
    ContentType,
    ConversationEntity,
    ConversationStatus,
    DedupePolicy,
    DraftEntity,
    InboxEntity,
    InboxMembershipEntity,
    InboxRole,
    MessageEntity,
    MessageRevisionEntity,
    NotificationEntity,
    NotificationType,
    ParticipantEntity,
    ParticipantRole,
    ReadReceiptEntity,
    SendNotificationInput,
} from "./types.js";
