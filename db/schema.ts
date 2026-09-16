import { relations } from 'drizzle-orm'
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// TAVERN V2 SPEC

export const characters = sqliteTable('characters', {
    id: integer('id', { mode: 'number' }).notNull().primaryKey(),
    type: text('type', { enum: ['user', 'character'] }).notNull(),

    name: text('name').notNull().default('User'),
    description: text('description').notNull().default(''),
    first_mes: text('first_mes').notNull().default(''),
    mes_example: text('mes_example').notNull().default(''),
    creator_notes: text('creator_notes').notNull().default(''),
    system_prompt: text('system_prompt').notNull().default(''),
    scenario: text('scenario').notNull().default(''),
    personality: text('personality').notNull().default(''),
    post_history_instructions: text('post_history_instructions').notNull().default(''),
    //character_book: text('character_book').default(''),
    image_id: integer('image_id', { mode: 'number' })
        .notNull()
        .$defaultFn(() => Date.now()),
    creator: text('creator').notNull().default(''),
    character_version: text('character_version').notNull().default(''),
    last_modified: integer('last_modified', { mode: 'number' })
        .$defaultFn(() => Date.now())
        .$onUpdateFn(() => Date.now()),
    // addition 15/8/2025
    background_image: integer('background_image', { mode: 'number' }),
})

export const characterGreetings = sqliteTable('character_greetings', {
    id: integer('id', { mode: 'number' }).notNull().primaryKey(),
    character_id: integer('character_id')
        .notNull()
        .references(() => characters.id, { onDelete: 'cascade' }),
    greeting: text('greeting').notNull(),
})

export const tags = sqliteTable('tags', {
    id: integer('id', { mode: 'number' }).notNull().primaryKey(),
    tag: text('tag').notNull().unique(),
})

export const characterTags = sqliteTable(
    'character_tags',
    {
        character_id: integer('character_id', { mode: 'number' })
            .notNull()
            .references(() => characters.id, { onDelete: 'cascade' }),
        tag_id: integer('tag_id', { mode: 'number' })
            .notNull()
            .references(() => tags.id, { onDelete: 'cascade' }),
    },
    (table) => {
        return { pk: primaryKey({ columns: [table.character_id, table.tag_id] }) }
    }
)

export const characterRelations = relations(characters, ({ many }) => ({
    alternate_greetings: many(characterGreetings),
    tags: many(characterTags),
    lorebooks: many(characterLorebooks),
    chats: many(chats),
}))

export const greetingsRelations = relations(characterGreetings, ({ one }) => ({
    character_id: one(characters, {
        fields: [characterGreetings.character_id],
        references: [characters.id],
    }),
}))

export const characterTagsRelations = relations(characterTags, ({ one }) => ({
    tag: one(tags, {
        fields: [characterTags.tag_id],
        references: [tags.id],
    }),
    character: one(characters, {
        fields: [characterTags.character_id],
        references: [characters.id],
    }),
}))

export const tagsRelations = relations(tags, ({ many }) => ({
    characters: many(characterTags),
}))

// CHATS

export const chats = sqliteTable('chats', {
    id: integer('id', { mode: 'number' }).primaryKey().notNull(),
    create_date: integer('create_date', { mode: 'timestamp' })
        .notNull()
        .$defaultFn(() => new Date()),
    character_id: integer('character_id', { mode: 'number' })
        .notNull()
        .references(() => characters.id, { onDelete: 'cascade' }),
    user_id: integer('user_id', { mode: 'number' }),
    last_modified: integer('last_modified', { mode: 'number' })
        .$defaultFn(() => Date.now())
        .$onUpdateFn(() => Date.now()),
    name: text('name').notNull().default('New Chat'),
    scroll_offset: integer('scroll_offset', { mode: 'number' }).notNull().default(0),
    auto_summary: integer('auto_summary', { mode: 'boolean' }).notNull().default(false),
    summary: text('summary').notNull().default(''),
    summary_updated_at: integer('summary_updated_at', { mode: 'number' }),
    summary_turn_count: integer('summary_turn_count', { mode: 'number' }).notNull().default(0),
    summary_token_count: integer('summary_token_count', { mode: 'number' }).notNull().default(0),
})

export const chatEntries = sqliteTable('chat_entries', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    chat_id: integer('chat_id', { mode: 'number' })
        .notNull()
        .references(() => chats.id, { onDelete: 'cascade' }),
    is_user: integer('is_user', { mode: 'boolean' }).notNull(),
    name: text('name').notNull(),
    order: integer('order').notNull(),
    swipe_id: integer('swipe_id', { mode: 'number' }).default(0).notNull(),
})

export const chatSwipes = sqliteTable('chat_swipes', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    entry_id: integer('entry_id', { mode: 'number' })
        .notNull()
        .references(() => chatEntries.id, { onDelete: 'cascade' }),
    swipe: text('swipe').notNull().default(''),

    send_date: integer('send_date', { mode: 'timestamp' })
        .notNull()
        .$defaultFn(() => new Date()),

    gen_started: integer('gen_started', { mode: 'timestamp' })
        .notNull()
        .$defaultFn(() => new Date()),

    gen_finished: integer('gen_finished', { mode: 'timestamp' })
        .notNull()
        .$defaultFn(() => new Date()),
})

/**
 * Fixed buckets for extracted key facts. The extractor names the fact itself but
 * must place it in one of these, which keeps the editor groupable and stops the
 * model from inventing a parallel taxonomy every run.
 */
export const CHAT_KEY_FACT_CATEGORIES = [
    'identity',
    'relationship',
    'commitment',
    'world',
    'preference',
] as const

export const chatKeyFacts = sqliteTable(
    'chat_key_facts',
    {
        id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
        chat_id: integer('chat_id', { mode: 'number' })
            .notNull()
            .references(() => chats.id, { onDelete: 'cascade' }),
        category: text('category', { enum: CHAT_KEY_FACT_CATEGORIES })
            .notNull()
            .default('identity'),
        key: text('key').notNull(),
        value: text('value').notNull(),
        /** Why the fact changed, written when a later turn overwrites `value`. */
        note: text('note').notNull().default(''),
        previous_value: text('previous_value').notNull().default(''),
        /** Superseded or fulfilled facts are kept and flagged rather than deleted. */
        stale: integer('stale', { mode: 'boolean' }).notNull().default(false),
        created_at: integer('created_at', { mode: 'number' })
            .notNull()
            .$defaultFn(() => Date.now()),
        updated_at: integer('updated_at', { mode: 'number' })
            .notNull()
            .$defaultFn(() => Date.now()),
    },
    (table) => {
        return {
            chatKeyIdx: uniqueIndex('chat_key_facts_chat_id_key_idx').on(table.chat_id, table.key),
        }
    }
)

export const chatsRelations = relations(chats, ({ many, one }) => ({
    messages: many(chatEntries),
    keyFacts: many(chatKeyFacts),
    character: one(characters, {
        fields: [chats.character_id],
        references: [characters.id],
    }),
}))

export const chatKeyFactsRelations = relations(chatKeyFacts, ({ one }) => ({
    chat: one(chats, {
        fields: [chatKeyFacts.chat_id],
        references: [chats.id],
    }),
}))

export const chatEntriesRelations = relations(chatEntries, ({ one, many }) => ({
    chat: one(chats, {
        fields: [chatEntries.chat_id],
        references: [chats.id],
    }),
    swipes: many(chatSwipes),
    attachments: many(chatAttachments),
}))

export const swipesRelations = relations(chatSwipes, ({ one }) => ({
    entry: one(chatEntries, {
        fields: [chatSwipes.entry_id],
        references: [chatEntries.id],
    }),
}))

export const chatAttachments = sqliteTable('chat_attachment', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    chat_entry_id: integer('chat_entry_id', { mode: 'number' })
        .notNull()
        .references(() => chatEntries.id, { onDelete: 'cascade' }),
    uri: text('uri').notNull(),
    type: text('type', { enum: ['audio', 'image', 'document'] }).notNull(),
    mime_type: text('mime_type').notNull(),
    name: text('name').notNull(),
    size: integer('size').notNull().default(0),
})

export const mediaAttachmentsRelations = relations(chatAttachments, ({ one }) => ({
    entry: one(chatEntries, {
        fields: [chatAttachments.chat_entry_id],
        references: [chatEntries.id],
    }),
}))

// INSTRUCT

const defaultSystemPrompt =
    '{{system_prompt}}\n{{character_desc}}\n{{personality}}\n{{scenario}}\n{{user_desc}}'

export const instructs = sqliteTable('instructs', {
    id: integer('id', { mode: 'number' }).primaryKey(),
    name: text('name').notNull(),

    system_prompt: text('system_prompt').notNull(),
    stop_sequence: text('stop_sequence').notNull(),
    activation_regex: text('activation_regex').notNull(),
    user_alignment_message: text('user_alignment_message').notNull(),
    macro: integer('macro', { mode: 'boolean' }).notNull(),

    timestamp: integer('timestamp', { mode: 'boolean' }).notNull().default(false),
    examples: integer('examples', { mode: 'boolean' }).notNull().default(true),
    format_type: integer('format_type').notNull().default(0),

    scenario: integer('scenario', { mode: 'boolean' }).notNull().default(true),
    personality: integer('personality', { mode: 'boolean' }).notNull().default(true),

    hide_think_tags: integer('hide_think_tags', { mode: 'boolean' }).notNull().default(true),
    use_common_stop: integer('use_common_stop', { mode: 'boolean' }).notNull().default(true),

    send_images: integer('send_images', { mode: 'boolean' }).notNull().default(true),
    send_audio: integer('send_audio', { mode: 'boolean' }).notNull().default(true),
    send_documents: integer('send_documents', { mode: 'boolean' }).notNull().default(true),
    last_image_only: integer('last_image_only', { mode: 'boolean' }).notNull().default(true),

    system_prompt_format: text('system_prompt_format').notNull().default(defaultSystemPrompt),
})

// LOREBOOKS

export const lorebooks = sqliteTable('lorebooks', {
    id: integer('id', { mode: 'number' }).primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    scanDepth: integer('scan_depth'),
    tokenBudget: integer('token_budget'),
    recursiveScanning: integer('recursive_scanning', { mode: 'boolean' }).default(false),
})

export const lorebookEntries = sqliteTable('lorebook_entries', {
    id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
    lorebook_id: integer('lorebook_id', { mode: 'number' })
        .notNull()
        .references(() => lorebooks.id, { onDelete: 'cascade' }),
    keys: text('keys').notNull(),
    content: text('content').notNull(),
    enable: integer('enable', { mode: 'boolean' }).default(true),
    insertion_order: integer('insertion_order').default(100),
    case_sensitive: integer('case_sensitive', { mode: 'boolean' }).default(true),

    name: text('name').notNull(),
    priority: integer('priority').default(100),
})

export const characterLorebooks = sqliteTable(
    'character_lorebooks',
    {
        character_id: integer('character_id', { mode: 'number' }).references(() => characters.id, {
            onDelete: 'cascade',
        }),
        lorebook_id: integer('lorebook_id', { mode: 'number' }).references(() => lorebooks.id, {
            onDelete: 'cascade',
        }),
    },
    (table) => {
        return { pk: primaryKey({ columns: [table.character_id, table.lorebook_id] }) }
    }
)

export const lorebooksRelations = relations(lorebooks, ({ many }) => ({
    entries: many(lorebookEntries),
    lorebooks: many(characterLorebooks),
}))

export const lorebookEntriesRelations = relations(lorebookEntries, ({ one }) => ({
    lorebook: one(lorebooks, {
        fields: [lorebookEntries.lorebook_id],
        references: [lorebooks.id],
    }),
}))

export const characterLorebooksRelations = relations(characterLorebooks, ({ one }) => ({
    character: one(characters, {
        fields: [characterLorebooks.character_id],
        references: [characters.id],
    }),
    lorebook: one(lorebooks, {
        fields: [characterLorebooks.lorebook_id],
        references: [lorebooks.id],
    }),
}))

// TODO:

////// group chats - 2 tables

// export const groupChats = sqliteTable('group_chats', {})

// export const characterGroupChats = sqliteTable('character_group_chats', {})

// Types

export type ChatSwipe = typeof chatSwipes.$inferSelect
export type ChatEntryType = typeof chatEntries.$inferSelect
export type ChatType = typeof chats.$inferSelect
export type ChatAttachmentType = typeof chatAttachments.$inferSelect
export type ChatKeyFactType = typeof chatKeyFacts.$inferSelect
export type ChatKeyFactCategory = (typeof CHAT_KEY_FACT_CATEGORIES)[number]
