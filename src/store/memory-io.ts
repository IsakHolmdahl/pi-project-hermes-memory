/**
 * File I/O for memory entries.
 * Atomic writes via temp directory + fs.rename in the same directory.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ENTRY_DELIMITER } from "../constants.js";

export async function readMemoryFile(filePath: string): Promise<string[]> {
	try {
		const raw = await fs.readFile(filePath, "utf-8");
		if (!raw.trim()) return [];
		return raw
			.split(ENTRY_DELIMITER)
			.map((e) => e.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

export async function saveMemoryFile(
	memoryDir: string,
	filePath: string,
	entries: string[],
): Promise<void> {
	const content = entries.length ? entries.join(ENTRY_DELIMITER) : "";
	const tmpDir = await fs.mkdtemp(path.join(memoryDir, ".tmp-"));
	const tmpPath = path.join(tmpDir, "write.tmp");

	try {
		await fs.writeFile(tmpPath, content, "utf-8");
		await fs.rename(tmpPath, filePath);
	} catch (err) {
		try {
			await fs.unlink(tmpPath);
		} catch {
			/* ignore */
		}
		throw err;
	} finally {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
}
