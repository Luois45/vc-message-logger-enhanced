/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { access, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { IpcEvents } from "@utils/IpcEvents";
import { Queue } from "@utils/Queue";
import { dialog, IpcMainInvokeEvent, ipcRenderer, shell } from "electron";

import { getSettings } from "../../main/ipcMain";
import { DATA_DIR } from "../../main/utils/constants";

// so we can filter the native helpers by this key
export function messageLoggerEnhancedUniqueIdThingyIdkMan() { }

// Map<attachmetId, path>()
const nativeSavedImages = new Map<string, string>();
export const getNativeSavedImages = () => nativeSavedImages;

let logsDir: string;
let imageCacheDir: string;

const getImageCacheDir = async () => imageCacheDir ?? await getDefaultNativeImageDir();
const getLogsDir = async () => logsDir ?? await getDefaultNativeDataDir();

export async function initDirs() {
    const settings = getSettings();
    const { ld, icd } = settings.plugins.MessageLoggerEnhanced;

    logsDir = ld || await getDefaultNativeDataDir();
    imageCacheDir = icd || await getDefaultNativeImageDir();
}
initDirs();

export async function init(_event: IpcMainInvokeEvent) {
    const imageDir = await getImageCacheDir();

    await ensureDirectoryExists(imageDir);
    const files = await readdir(imageDir);
    for (const filename of files) {
        const attachmentId = getAttachmentIdFromFilename(filename);
        nativeSavedImages.set(attachmentId, path.join(imageDir, filename));
    }
}

export async function getImageNative(_event: IpcMainInvokeEvent, attachmentId: string) {
    const imagePath = nativeSavedImages.get(attachmentId);
    if (!imagePath) return null;
    return await readFile(imagePath);
}

export async function writeImageNative(_event: IpcMainInvokeEvent, filename: string, content: Uint8Array) {
    if (!filename || !content) return;
    const imageDir = await getImageCacheDir();

    // returns the file name
    // ../../someMalicousPath.png -> someMalicousPath
    const attachmentId = getAttachmentIdFromFilename(filename);

    const existingImage = nativeSavedImages.get(attachmentId);
    if (existingImage) return;

    const imagePath = path.join(imageDir, filename);
    await writeFile(imagePath, content);

    nativeSavedImages.set(attachmentId, imagePath);
}

export async function deleteFileNative(_event: IpcMainInvokeEvent, attachmentId: string) {
    const imagePath = nativeSavedImages.get(attachmentId);
    if (!imagePath) return;

    await unlink(imagePath);
}

const LOGS_DATA_FILENAME = "message-logger-logs.json";
const dataWriteQueue = new Queue();

export async function getLogsFromFs(_event: IpcMainInvokeEvent) {
    const logsDir = await getLogsDir();

    await ensureDirectoryExists(logsDir);
    try {
        return JSON.parse(await readFile(path.join(logsDir, LOGS_DATA_FILENAME), "utf-8"));
    } catch { }

    return null;
}

export async function writeLogs(_event: IpcMainInvokeEvent, contents: string) {
    const logsDir = await getLogsDir();

    dataWriteQueue.push(() => writeFile(path.join(logsDir, LOGS_DATA_FILENAME), contents));
}


export async function getDefaultNativeImageDir(): Promise<string> {
    return path.join(await getDefaultNativeDataDir(), "savedImages");
}

export async function getDefaultNativeDataDir(): Promise<string> {
    return path.join(DATA_DIR, "MessageLoggerData");
}

export async function chooseDir(_event: IpcMainInvokeEvent, logKey: "logsDir" | "imageCacheDir", defaultPath: string) {

    const res = await dialog.showOpenDialog({ properties: ["openDirectory"], defaultPath: defaultPath });
    const dir = res.filePaths[0];

    if (!dir) return false;

    const settings = getSettings();
    settings.plugins.MessageLoggerEnhanced[logKey] = dir;

    await ipcRenderer.invoke(IpcEvents.SET_SETTINGS, JSON.stringify(settings, null, 4));

    switch (logKey) {
        case "logsDir": logsDir = dir; break;
        case "imageCacheDir": imageCacheDir = dir; break;
    }

    return true;
}

export async function showItemInFolder(_event: IpcMainInvokeEvent, filePath: string) {
    shell.showItemInFolder(filePath);
}


// utils

async function exists(filename: string) {
    try {
        await access(filename);
        return true;
    } catch (error) {
        return false;
    }
}

async function ensureDirectoryExists(cacheDir: string) {
    if (!await exists(cacheDir))
        await mkdir(cacheDir);
}

function getAttachmentIdFromFilename(filename: string) {
    return path.parse(filename).name;
}
