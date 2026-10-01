/**
 * What a backup carries. The options form a hierarchy: a child is only meaningful
 * when its parent travels too, because chats point at characters, attachment files
 * are only reachable through chat rows, and API keys live inside the settings.
 */
export type BackupScope = {
    /** Characters, greetings, tags, lorebooks, their images and mouth frames. */
    characters: boolean
    /** Chats, messages, swipes, summaries and key facts. */
    chats: boolean
    /** The attachment files themselves, alongside their rows. */
    attachments: boolean
    /** Every app setting, plus the global chat background image. */
    settings: boolean
    /** API keys, which are fields inside the settings. */
    apiKeys: boolean
}

export const FULL_BACKUP_SCOPE: BackupScope = {
    characters: true,
    chats: true,
    attachments: true,
    settings: true,
    apiKeys: true,
}

/** Forces the hierarchy, so a child never ends up in a backup without its parent. */
export const normalizeScope = (scope: BackupScope): BackupScope => {
    const chats = scope.characters && scope.chats
    return {
        characters: scope.characters,
        chats: chats,
        attachments: chats && scope.attachments,
        settings: scope.settings,
        apiKeys: scope.settings && scope.apiKeys,
    }
}

/** Both top level options off, which would produce an empty backup. */
export const isEmptyScope = (scope: BackupScope) => !scope.characters && !scope.settings

// Children come before their parents so a delete never fights a foreign key.
const CHARACTER_TABLES = [
    'character_lorebooks',
    'lorebook_entries',
    'lorebooks',
    'character_tags',
    'tags',
    'character_greetings',
    'characters',
]
const CHAT_TABLES = ['chat_key_facts', 'chat_swipes', 'chat_entries', 'chats']
const ATTACHMENT_TABLES = ['chat_attachment']
/** Instruct presets are saved in the database, but belong to the settings screen. */
const SETTINGS_TABLES = ['instructs']

/**
 * Tables emptied in the exported copy of the database. Clearing a parent would
 * cascade into its children anyway; they are listed so the export does not depend
 * on the schema's cascade rules staying as they are.
 */
export const tablesToClear = (scope: BackupScope) => {
    const tables: string[] = []
    if (!scope.attachments) tables.push(...ATTACHMENT_TABLES)
    if (!scope.chats) tables.push(...CHAT_TABLES)
    if (!scope.characters) tables.push(...CHARACTER_TABLES)
    if (!scope.settings) tables.push(...SETTINGS_TABLES)
    return tables
}
