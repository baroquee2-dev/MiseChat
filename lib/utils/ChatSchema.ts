import { z } from 'zod'

const SwipeSchema = z.object({
    swipe: z.string(),
    id: z.number().optional(),
    entry_id: z.number(),
    send_date: z.coerce.date(),
    gen_started: z.coerce.date(),
    gen_finished: z.coerce.date(),
    active: z.boolean().optional().default(false),
    token_length: z.number().nullable().optional(),
    reset_length: z.number().nullable().optional(),
})

const AttachmentSchema = z.object({
    id: z.number(),
    type: z.enum(['audio', 'image', 'document']),
    name: z.string(),
    chat_entry_id: z.number(),
    uri: z.string(),
    mime_type: z.string(),
    size: z.number(),
})

const MessageSchema = z.object({
    id: z.number().optional(),
    name: z.string(),
    chat_id: z.number(),
    is_user: z.boolean(),
    order: z.number(),
    swipe_id: z.number(),
    swipes: z.array(SwipeSchema),
    attachments: z.array(AttachmentSchema),
})

export const ChatImportSchema = z.object({
    id: z.number().optional(),
    name: z.string(),
    last_modified: z.number().nullable(),
    character_id: z.number(),
    create_date: z.coerce.date(),
    user_id: z.number().nullable(),
    scroll_offset: z.number(),
    auto_summary: z.boolean().default(false),
    summary: z.string().default(''),
    summary_updated_at: z.number().nullable().default(null),
    summary_turn_count: z.number().default(0),
    summary_token_count: z.number().default(0),
    messages: z.array(MessageSchema),
})

export type Swipe = z.infer<typeof SwipeSchema>
export type Attachment = z.infer<typeof AttachmentSchema>
export type Message = z.infer<typeof MessageSchema>
export type Chat = z.infer<typeof ChatImportSchema>
