/**
 * Memory tool — registers the LLM-callable `memory` tool.
 * Ported from hermes-agent/tools/memory_tool.py (MEMORY_SCHEMA + memory_tool dispatch).
 * See PLAN.md → "Hermes Source File Reference Map" for source lines.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { MemoryStore } from "../store/memory-store.js";
import type { DatabaseManager } from "../store/db.js";
import {
	formatFailureMemoryContent,
	removeExactSyncedMemories,
	removeSyncedMemories,
	replaceSyncedMemories,
	syncMemoryEntry,
} from "../store/sqlite-memory-store.js";
import { MEMORY_TOOL_DESCRIPTION } from "../constants.js";
import type { MemoryCategory, MemoryResult } from "../types.js";

function appendSyncWarning(
	result: MemoryResult,
	warning: string,
): MemoryResult {
	const warnings = [...(((result as any).warnings ?? []) as string[]), warning];
	const message = result.message
		? `${result.message} Warning: ${warning}`
		: warning;
	return {
		...result,
		message,
		warning,
		warnings,
	} as MemoryResult;
}

function formatMemoryToolText(result: MemoryResult): string {
	const evictedEntries = result.evicted_entries ?? [];
	if (result.success && evictedEntries.length > 0) {
		const lines = [
			result.message ??
				`Memory updated. Rotated ${evictedEntries.length} older ${evictedEntries.length === 1 ? "entry" : "entries"} to stay within the limit.`,
			"",
			"Rotated active memory entries:",
			"",
		];

		evictedEntries.forEach((entry, index) => {
			lines.push(`${index + 1}. ${entry}`);
			lines.push("");
		});

		lines.push("If one of these entries should stay active, add it again.");
		if (result.usage) lines.push(`Usage: ${result.usage}`);
		return lines.join("\n").trim();
	}

	return JSON.stringify(result);
}

async function syncAddToSqlite(
	target: "memory" | "user" | "failure",
	content: string,
	category: MemoryCategory | undefined,
	failureReason: string | undefined,
	dbManager: DatabaseManager | null,
): Promise<string | null> {
	if (!dbManager) return null;

	try {
		if (target === "failure") {
			const failureCategory = category ?? "failure";
			syncMemoryEntry(dbManager, {
				content: formatFailureMemoryContent(content, {
					category: failureCategory,
					failureReason,
				}),
				target: "failure",
				project: null,
				category: failureCategory,
				failureReason,
			});
			return null;
		}

		syncMemoryEntry(dbManager, {
			content,
			target,
			project: null,
		});
		return null;
	} catch (err) {
		return `Saved to Markdown, but SQLite search sync failed: ${err instanceof Error ? err.message : String(err)}`;
	}
}

async function syncReplaceToSqlite(
	target: "memory" | "user" | "failure",
	oldText: string,
	newContent: string,
	dbManager: DatabaseManager | null,
): Promise<string | null> {
	if (!dbManager) return null;

	try {
		const syncResult = replaceSyncedMemories(dbManager, oldText, {
			content: newContent,
			target,
			project: null,
		});

		if (syncResult.matched === 0) {
			return "Saved to Markdown, but no matching SQLite memory row was updated. SQLite search may be temporarily stale.";
		}

		return null;
	} catch (err) {
		return `Saved to Markdown, but SQLite search sync failed: ${err instanceof Error ? err.message : String(err)}`;
	}
}

async function syncRemoveFromSqlite(
	target: "memory" | "user" | "failure",
	oldText: string,
	dbManager: DatabaseManager | null,
): Promise<string | null> {
	if (!dbManager) return null;

	try {
		const syncResult = removeSyncedMemories(dbManager, oldText, {
			target,
			project: null,
		});

		if (syncResult.matched === 0) {
			return "Saved to Markdown, but no matching SQLite memory row was removed. SQLite search may be temporarily stale.";
		}

		return null;
	} catch (err) {
		return `Saved to Markdown, but SQLite search sync failed: ${err instanceof Error ? err.message : String(err)}`;
	}
}

async function syncEvictionsFromSqlite(
	target: "memory" | "user" | "failure",
	evictedEntries: string[] | undefined,
	dbManager: DatabaseManager | null,
): Promise<void> {
	if (!dbManager) return;
	if (!evictedEntries || evictedEntries.length === 0) return;

	for (const entry of evictedEntries) {
		try {
			removeExactSyncedMemories(dbManager, entry, {
				target,
				project: null,
			});
		} catch {
			// FIFO already updated the Markdown source of truth. SQLite is only a
			// best-effort search mirror, so eviction cleanup must not fail the write.
		}
	}
}

export function registerMemoryTool(
	pi: ExtensionAPI,
	store: MemoryStore,
	dbManager: DatabaseManager | null = null,
): void {
	pi.registerTool({
		name: "memory",
		label: "Memory",
		description: MEMORY_TOOL_DESCRIPTION,
		promptSnippet:
			"Save or manage persistent memory that survives across sessions",
		promptGuidelines: [
			"Use the memory tool proactively when the user corrects you, shares a preference, or reveals personal details worth remembering.",
			"Use the memory tool when you discover environment facts, project conventions, or reusable patterns useful in future sessions.",
			"Do NOT use memory for temporary task state, TODO items, or session progress — only for durable, cross-session facts.",
			"Use target='failure' with category to save what didn't work (failures, corrections, insights).",
		],
		parameters: Type.Object({
			action: StringEnum(["add", "replace", "remove"] as const),
			target: StringEnum(["memory", "user", "failure"] as const),
			content: Type.Optional(
				Type.String({ description: "Entry content for add/replace" }),
			),
			old_text: Type.Optional(
				Type.String({
					description: "Substring identifying entry for replace/remove",
				}),
			),
			category: Type.Optional(
				StringEnum(
					[
						"failure",
						"correction",
						"insight",
						"preference",
						"convention",
						"tool-quirk",
					] as const,
					{
						description: "Category for failure memories",
					},
				),
			),
			failure_reason: Type.Optional(
				Type.String({ description: "Why it failed (for failure category)" }),
			),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const {
				action,
				target,
				content,
				old_text,
				category,
				failure_reason,
			} = params;

			let result: MemoryResult;
			let syncWarning: string | null = null;
			switch (action) {
				case "add":
					if (!content) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify({
										success: false,
										error: "Content is required for 'add' action.",
									}),
								},
							],
							details: {},
						};
					}
					// Handle failure target with category
					if (target === "failure") {
						const memoryCategory = (category || "failure") as MemoryCategory;
						result = await store.addFailure(content, {
							category: memoryCategory,
							failureReason: failure_reason,
						});
						if (result.success) {
							syncWarning = await syncAddToSqlite(
								target,
								content,
								memoryCategory,
								failure_reason,
								dbManager,
							);
						}
					} else {
						result = await store.add(target, content);
						if (result.success) {
							await syncEvictionsFromSqlite(
								target,
								result.evicted_entries,
								dbManager,
							);
							syncWarning = await syncAddToSqlite(
									target,
									content,
									undefined,
									undefined,
									dbManager,
								);
						}
					}
					break;

				case "replace":
					if (!old_text) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify({
										success: false,
										error: "old_text is required for 'replace' action.",
									}),
								},
							],
							details: {},
						};
					}
					if (!content) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify({
										success: false,
										error: "content is required for 'replace' action.",
									}),
								},
							],
							details: {},
						};
					}
					result = await store.replace(target, old_text, content);
					if (result.success) {
						syncWarning = await syncReplaceToSqlite(
							target,
							old_text,
							content,
							dbManager,
						);
					}
					break;

				case "remove":
					if (!old_text) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify({
										success: false,
										error: "old_text is required for 'remove' action.",
									}),
								},
							],
							details: {},
						};
					}
					result = await store.remove(target, old_text);
					if (result.success) {
						syncWarning = await syncRemoveFromSqlite(
							target,
							old_text,
							dbManager,
						);
					}
					break;

				default:
					result = {
						success: false,
						error: `Unknown action '${action}'. Use: add, replace, remove`,
					};
			}

			if (syncWarning && result.success) {
				result = appendSyncWarning(result, syncWarning);
			}

			return {
				content: [{ type: "text", text: formatMemoryToolText(result) }],
				details: result,
			};
		},
	});
}
