import { localDownload } from '@vali98/react-native-fs'
import { File, Paths } from 'expo-file-system'
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite'
import { unzipSync, zipSync } from 'fflate'

import { sqliteDB } from '@db'
import { Logger } from '@lib/state/Logger'
import {
    exportMouthSpriteBindings,
    importMouthSpriteBindings,
    MOUTH_SPRITE_DIR,
    type MouthSpriteSet,
} from '@lib/state/MouthSprites'

import { type BackupScope, normalizeScope, tablesToClear } from './BackupScope'
import { AppDirectory, copyFile, deleteFile, fileExists, listFiles, makeDirectory } from './File'
import {
    clearSettings,
    collectSettings,
    restoreSettings,
    type SettingsSnapshot,
} from './SettingsBackup'

export const SQLITE_DB_PATH = `${Paths.document.uri}/SQLite/db.db`
/** SQLite keeps recent writes in sidecar journals; a stale one corrupts a restored file. */
const SQLITE_SIDECARS = ['-wal', '-shm']
/** expo-sqlite addresses databases by name inside its own folder. */
const STAGING_DB_NAME = 'backup-staging.db'
const STAGING_DB_PATH = SQLITE_DB_PATH.replace(/db\.db$/, STAGING_DB_NAME)

const DB_ENTRY = 'db.db'
const MANIFEST_ENTRY = 'backup.json'
const MOUTH_BINDINGS_ENTRY = 'mouth-sprites.json'
const SETTINGS_ENTRY = 'settings.json'

const CHARACTERS_PREFIX = 'characters/'
const MOUTH_PREFIX = 'mouth/'
const ATTACHMENTS_PREFIX = 'attachments/'
const ASSETS_PREFIX = 'assets/'

/** Where each prefixed zip entry is written back to on import. */
const ENTRY_DIRECTORIES = [
    { prefix: CHARACTERS_PREFIX, directory: AppDirectory.CharacterPath },
    { prefix: MOUTH_PREFIX, directory: MOUTH_SPRITE_DIR },
    { prefix: ATTACHMENTS_PREFIX, directory: AppDirectory.Attachments },
    { prefix: ASSETS_PREFIX, directory: AppDirectory.Assets },
]

export type BackupManifest = { appVersion: string; scope: BackupScope }

const backupFileName = (appVersion: string) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return `${appVersion}-misechat-backup-${stamp}.zip`
}

const isZipName = (name: string) => name.toLowerCase().endsWith('.zip')

const readBytes = async (path: string) => new File(path).bytes()

const writeBytes = async (path: string, data: Uint8Array) => {
    const file = new File(path)
    if (file.exists) file.delete()
    file.create({ intermediates: true })
    file.write(data)
}

const encodeJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

const decodeJson = <T>(data: Uint8Array | undefined): T | undefined => {
    if (!data?.length) return undefined
    try {
        const parsed = JSON.parse(new TextDecoder().decode(data))
        return parsed && typeof parsed === 'object' ? (parsed as T) : undefined
    } catch {
        return undefined
    }
}

const collectDirectory = async (directory: string, prefix: string) => {
    const files: Record<string, Uint8Array> = {}
    await makeDirectory(directory)
    // Subdirectories are skipped, so mouth frames do not also arrive as character images.
    for (const name of listFiles(directory)) {
        const path = `${directory}${name}`
        if (!fileExists(path)) continue
        files[`${prefix}${name}`] = await readBytes(path)
    }
    return files
}

const clearDirectory = async (directory: string) => {
    await makeDirectory(directory)
    for (const name of listFiles(directory)) deleteFile(`${directory}${name}`)
}

const deleteDatabaseAt = (path: string) => {
    deleteFile(path)
    for (const suffix of SQLITE_SIDECARS) deleteFile(`${path}${suffix}`)
}

/** A copy of the database holding only what the scope asks for. */
const buildScopedDatabase = async (scope: BackupScope) => {
    // Recent writes may still sit in the write ahead log, which is not part of the file.
    sqliteDB.execSync('PRAGMA wal_checkpoint(TRUNCATE);')
    deleteDatabaseAt(STAGING_DB_PATH)
    if (!(await copyFile({ from: SQLITE_DB_PATH, to: STAGING_DB_PATH }))) {
        throw new Error('Could not stage the database for export')
    }

    const staged = openDatabaseSync(STAGING_DB_NAME)
    try {
        for (const table of tablesToClear(scope)) staged.execSync(`DELETE FROM ${table};`)
        staged.execSync('VACUUM;')
    } finally {
        staged.closeSync()
    }

    const bytes = await readBytes(STAGING_DB_PATH)
    deleteDatabaseAt(STAGING_DB_PATH)
    return bytes
}

/** Attachment rows hold absolute paths, which carry the package name of their install. */
const rewriteAttachmentPaths = (database: SQLiteDatabase) => {
    try {
        const rows = database.getAllSync<{ id: number; uri: string }>(
            'SELECT id, uri FROM chat_attachment;'
        )
        for (const row of rows) {
            const filename = row.uri.slice(row.uri.lastIndexOf('/') + 1)
            const uri = `${AppDirectory.Attachments}${filename}`
            if (uri === row.uri) continue
            database.runSync('UPDATE chat_attachment SET uri = ? WHERE id = ?;', uri, row.id)
        }
    } catch (e) {
        Logger.warn(`Could not repoint attachment paths: ${e}`)
    }
}

/** Stages the incoming database so its paths can be fixed before it goes live. */
const restoreDatabase = async (dbBytes: Uint8Array) => {
    deleteDatabaseAt(STAGING_DB_PATH)
    await writeBytes(STAGING_DB_PATH, dbBytes)

    const staged = openDatabaseSync(STAGING_DB_NAME)
    try {
        rewriteAttachmentPaths(staged)
    } finally {
        staged.closeSync()
    }

    // Flush the live database first so it has nothing left to write over the new file.
    sqliteDB.execSync('PRAGMA wal_checkpoint(TRUNCATE);')
    deleteDatabaseAt(SQLITE_DB_PATH)
    if (!(await copyFile({ from: STAGING_DB_PATH, to: SQLITE_DB_PATH }))) {
        throw new Error('Failed to copy database file')
    }
    deleteDatabaseAt(STAGING_DB_PATH)
}

/** Export the selected parts of the app as a single zip download. */
export const exportAppBackup = async (appVersion: string, scope: BackupScope) => {
    if (!fileExists(SQLITE_DB_PATH)) {
        throw new Error('Database file not found')
    }
    const wanted = normalizeScope(scope)
    const manifest: BackupManifest = { appVersion: appVersion, scope: wanted }

    const files: Record<string, Uint8Array> = {
        [MANIFEST_ENTRY]: encodeJson(manifest),
        [DB_ENTRY]: await buildScopedDatabase(wanted),
    }

    if (wanted.characters) {
        files[MOUTH_BINDINGS_ENTRY] = encodeJson(exportMouthSpriteBindings())
        Object.assign(files, await collectDirectory(AppDirectory.CharacterPath, CHARACTERS_PREFIX))
        Object.assign(files, await collectDirectory(MOUTH_SPRITE_DIR, MOUTH_PREFIX))
    }
    if (wanted.attachments) {
        Object.assign(files, await collectDirectory(AppDirectory.Attachments, ATTACHMENTS_PREFIX))
    }
    if (wanted.settings) {
        files[SETTINGS_ENTRY] = encodeJson(collectSettings(wanted.apiKeys))
        Object.assign(files, await collectDirectory(AppDirectory.Assets, ASSETS_PREFIX))
    }

    const zipped = zipSync(files, { level: 1 })
    const filename = backupFileName(appVersion)
    const cachePath = `${Paths.cache.uri}${filename}`
    await writeBytes(cachePath, zipped)
    await localDownload(cachePath.replace('file://', ''))
}

/** What a backup holds, for the import confirmation. Undefined for a legacy file. */
export const readBackupManifest = async (uri: string, name: string) => {
    if (!isZipName(name)) return undefined
    // Only the manifest is inflated; the images and database can be large.
    const unzipped = unzipSync(await readBytes(uri), {
        filter: (file) => file.name === MANIFEST_ENTRY,
    })
    return decodeJson<BackupManifest>(unzipped[MANIFEST_ENTRY])
}

/**
 * Restore from a backup zip, or a legacy bare db.db file. Whatever a backup does not
 * carry is cleared: restoring replaces the contents of the app, it does not merge.
 */
export const importAppBackup = async (uri: string, name: string) => {
    if (!isZipName(name)) {
        deleteDatabaseAt(SQLITE_DB_PATH)
        if (!(await copyFile({ from: uri, to: SQLITE_DB_PATH }))) {
            throw new Error('Failed to copy database file')
        }
        return
    }

    const unzipped = unzipSync(await readBytes(uri))
    const dbBytes = unzipped[DB_ENTRY]
    if (!dbBytes) {
        throw new Error('Backup zip is missing db.db')
    }

    await restoreDatabase(dbBytes)

    for (const { directory } of ENTRY_DIRECTORIES) await clearDirectory(directory)
    for (const [entry, data] of Object.entries(unzipped)) {
        const target = ENTRY_DIRECTORIES.find((item) => entry.startsWith(item.prefix))
        if (!target || !data?.length) continue
        const filename = entry.slice(target.prefix.length)
        if (!filename || filename.includes('/') || filename.includes('..')) continue
        await writeBytes(`${target.directory}${filename}`, data)
    }

    clearSettings()
    const settings = decodeJson<SettingsSnapshot>(unzipped[SETTINGS_ENTRY])
    if (settings) restoreSettings(settings)

    const bindings = decodeJson<Record<string, MouthSpriteSet>>(unzipped[MOUTH_BINDINGS_ENTRY])
    importMouthSpriteBindings(bindings ?? {})
}
