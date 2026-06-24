/**
 * Pure-ish CRUD operations on memory entry arrays.
 * These functions decide what the new entry list should be and return a result.
 * The caller is responsible for persisting the returned entries.
 */

import { scanContent } from "./content-scanner.js";
import { normalizeMemoryLookupText } from "./memory-lookup.js";
import { ENTRY_DELIMITER } from "../constants.js";
import { encodeEntry, stripMetadata } from "./memory-entries.js";
import {
	buildSuccessResponse,
	buildMemoryFullError,
	fifoEvictAndAdd,
} from "./memory-crud.js";
import type { MemoryResult, MemoryOverflowStrategy } from "../types.js";

export interface AddOptions {
	target: "memory" | "user" | "failure";
	content: string;
	entries: string[];
	limit: number;
	strategy: MemoryOverflowStrategy;
	addedMessage?: string;
	tryConsolidate?: () => Promise<boolean>;
}

export function computeAddResult(options: AddOptions): {
	result: MemoryResult | null;
	newEntries: string[] | null;
	needsConsolidationRetry: boolean;
} {
	const {
		target,
		content,
		entries,
		limit,
		strategy,
		addedMessage = "Entry added.",
	} = options;
	const trimmed = content.trim();
	if (!trimmed) {
		return {
			result: { success: false, error: "Content cannot be empty." },
			newEntries: null,
			needsConsolidationRetry: false,
		};
	}

	const scanError = scanContent(trimmed);
	if (scanError) {
		return {
			result: { success: false, error: scanError },
			newEntries: null,
			needsConsolidationRetry: false,
		};
	}

	const strippedEntries = entries.map((e) => stripMetadata(e));
	if (strippedEntries.includes(trimmed)) {
		const current = entries.join(ENTRY_DELIMITER).length;
		return {
			result: buildSuccessResponse(
				target,
				entries,
				current,
				limit,
				"Entry already exists (no duplicate added).",
			),
			newEntries: null,
			needsConsolidationRetry: false,
		};
	}

	const today = new Date().toISOString().split("T")[0];
	const encoded = encodeEntry(trimmed, today, today);

	const newTotal = [...entries, encoded].join(ENTRY_DELIMITER).length;
	if (newTotal > limit) {
		if (strategy === "fifo-evict") {
			return { result: null, newEntries: null, needsConsolidationRetry: false };
		}
		if (strategy === "auto-consolidate" && options.tryConsolidate) {
			return { result: null, newEntries: null, needsConsolidationRetry: true };
		}
		return {
			result: buildMemoryFullError(
				target,
				entries.join(ENTRY_DELIMITER).length,
				limit,
				trimmed.length,
			),
			newEntries: null,
			needsConsolidationRetry: false,
		};
	}

	const newEntries = [...entries, encoded];
	return {
		result: buildSuccessResponse(
			target,
			newEntries,
			newEntries.join(ENTRY_DELIMITER).length,
			limit,
			addedMessage,
		),
		newEntries,
		needsConsolidationRetry: false,
	};
}

export interface ReplaceOptions {
	target: "memory" | "user" | "failure";
	oldText: string;
	newContent: string;
	entries: string[];
	limit: number;
}

export function computeReplaceResult(options: ReplaceOptions): {
	result: MemoryResult | null;
	newEntries: string[] | null;
} {
	const { target, oldText, newContent, entries, limit } = options;
	const normalizedOld = normalizeMemoryLookupText(oldText);
	const trimmedNew = newContent.trim();
	if (!normalizedOld)
		return {
			result: { success: false, error: "old_text cannot be empty." },
			newEntries: null,
		};
	if (!trimmedNew)
		return {
			result: {
				success: false,
				error: "new_content cannot be empty. Use 'remove' to delete entries.",
			},
			newEntries: null,
		};

	const scanError = scanContent(trimmedNew);
	if (scanError)
		return { result: { success: false, error: scanError }, newEntries: null };

	const matches = entries.filter((e) =>
		stripMetadata(e).includes(normalizedOld),
	);
	if (matches.length === 0)
		return {
			result: { success: false, error: `No entry matched '${normalizedOld}'.` },
			newEntries: null,
		};
	if (matches.length > 1 && new Set(matches).size > 1) {
		return {
			result: {
				success: false,
				error: `Multiple entries matched '${normalizedOld}'. Be more specific.`,
				matches: matches.map(
					(e) => stripMetadata(e).slice(0, 80) + (e.length > 80 ? "..." : ""),
				),
			},
			newEntries: null,
		};
	}

	const idx = entries.indexOf(matches[0]);
	const decoded = decodeEntry(matches[0]);
	const today = new Date().toISOString().split("T")[0];
	const encoded = encodeEntry(trimmedNew, decoded.created, today);

	const testEntries = [...entries];
	testEntries[idx] = encoded;
	const newTotal = testEntries.join(ENTRY_DELIMITER).length;

	if (newTotal > limit) {
		return {
			result: {
				success: false,
				error: `Replacement would put memory at ${newTotal}/${limit} chars. Shorten or remove other entries first.`,
			},
			newEntries: null,
		};
	}

	return {
		result: buildSuccessResponse(
			target,
			testEntries,
			newTotal,
			limit,
			"Entry replaced.",
		),
		newEntries: testEntries,
	};
}

export interface RemoveOptions {
	target: "memory" | "user" | "failure";
	oldText: string;
	entries: string[];
	limit: number;
}

export function computeRemoveResult(options: RemoveOptions): {
	result: MemoryResult | null;
	newEntries: string[] | null;
} {
	const { target, oldText, entries, limit } = options;
	const normalizedOld = normalizeMemoryLookupText(oldText);
	if (!normalizedOld)
		return {
			result: { success: false, error: "old_text cannot be empty." },
			newEntries: null,
		};

	const matches = entries.filter((e) =>
		stripMetadata(e).includes(normalizedOld),
	);
	if (matches.length === 0)
		return {
			result: { success: false, error: `No entry matched '${normalizedOld}'.` },
			newEntries: null,
		};
	if (matches.length > 1 && new Set(matches).size > 1) {
		return {
			result: {
				success: false,
				error: `Multiple entries matched '${normalizedOld}'. Be more specific.`,
				matches: matches.map(
					(e) =>
						stripMetadata(e).slice(0, 80) +
						(stripMetadata(e).length > 80 ? "..." : ""),
				),
			},
			newEntries: null,
		};
	}

	const idx = entries.indexOf(matches[0]);
	const newEntries = [...entries];
	newEntries.splice(idx, 1);
	const newTotal = newEntries.join(ENTRY_DELIMITER).length;

	return {
		result: buildSuccessResponse(
			target,
			newEntries,
			newTotal,
			limit,
			"Entry removed.",
		),
		newEntries,
	};
}

function decodeEntry(raw: string): {
	text: string;
	created: string;
	lastReferenced: string;
} {
	const match = raw.match(
		/^(.*?)\s*<!--\s*created=([^,]+),\s*last=([^>]+)\s*-->\s*$/,
	);
	if (match) {
		return {
			text: match[1].trim(),
			created: match[2].trim(),
			lastReferenced: match[3].trim(),
		};
	}
	const today = new Date().toISOString().split("T")[0];
	return { text: raw.trim(), created: today, lastReferenced: today };
}
