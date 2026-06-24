/**
 * Shared CRUD result builders and FIFO eviction logic.
 */

import { ENTRY_DELIMITER } from "../constants.js";
import { stripMetadata } from "./memory-entries.js";
import type { MemoryResult } from "../types.js";

export function buildSuccessResponse(
	target: "memory" | "user" | "failure",
	entries: string[],
	current: number,
	limit: number,
	message?: string,
): MemoryResult {
	const pct =
		limit > 0 ? Math.min(100, Math.floor((current / limit) * 100)) : 0;
	const resp: MemoryResult = {
		success: true,
		target,
		usage: `${pct}% — ${current}/${limit} chars`,
		entry_count: entries.length,
	};
	if (message) resp.message = message;
	return resp;
}

export function buildMemoryFullError(
	_target: "memory" | "user" | "failure",
	current: number,
	limit: number,
	contentLength: number,
): MemoryResult {
	return {
		success: false,
		error: `Memory at ${current}/${limit} chars. Adding this entry (${contentLength} chars) would exceed the limit. Replace or remove existing entries first.`,
	};
}

export async function fifoEvictAndAdd(
	target: "memory" | "user" | "failure",
	entries: string[],
	encoded: string,
	contentLength: number,
	limit: number,
	save: (remaining: string[]) => Promise<void>,
): Promise<MemoryResult> {
	if (encoded.length > limit) {
		return buildMemoryFullError(
			target,
			entries.join(ENTRY_DELIMITER).length,
			limit,
			contentLength,
		);
	}

	const remaining = [...entries];
	const evictedEntries: string[] = [];

	while (
		[...remaining, encoded].join(ENTRY_DELIMITER).length > limit &&
		remaining.length > 0
	) {
		const evicted = remaining.shift()!;
		evictedEntries.push(stripMetadata(evicted));
	}

	remaining.push(encoded);
	await save(remaining);

	return {
		...buildSuccessResponse(
			target,
			remaining,
			remaining.join(ENTRY_DELIMITER).length,
			limit,
			`Memory updated. Rotated ${evictedEntries.length} older ${evictedEntries.length === 1 ? "entry" : "entries"} to stay within the limit.`,
		),
		evicted_entries: evictedEntries,
		evicted_count: evictedEntries.length,
	};
}
