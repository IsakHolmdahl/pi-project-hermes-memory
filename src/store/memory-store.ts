import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MEMORY_FILE, USER_FILE, ENTRY_DELIMITER } from "../constants.js";
import type {
	MemoryConfig,
	MemoryResult,
	MemorySnapshot,
	ConsolidationResult,
} from "../types.js";
import { resolveLocalHermesDir } from "../paths.js";
import { encodeEntry, stripMetadata } from "./memory-entries.js";
import { buildFailureMemoryText } from "./memory-failures.js";
import {
	buildSnapshot,
	formatSystemPromptContext,
} from "./memory-formatter.js";
import { readMemoryFile, saveMemoryFile } from "./memory-io.js";
import { buildMemoryFullError, fifoEvictAndAdd } from "./memory-crud.js";
import {
	computeAddResult,
	computeReplaceResult,
	computeRemoveResult,
} from "./memory-ops.js";

export class MemoryStore {
	private memoryEntries: string[] = [];
	private userEntries: string[] = [];
	private failureEntries: string[] = [];
	private snapshot: MemorySnapshot = { memory: "", user: "" };
	private consolidator:
		| ((
				target: "memory" | "user" | "failure",
				signal?: AbortSignal,
		  ) => Promise<ConsolidationResult>)
		| null = null;
	constructor(private config: MemoryConfig) {}
	setConsolidator(
		fn: (
			target: "memory" | "user" | "failure",
			signal?: AbortSignal,
		) => Promise<ConsolidationResult>,
	): void {
		this.consolidator = fn;
	}

	private get memoryDir(): string {
		return this.config.memoryDir ?? resolveLocalHermesDir();
	}

	private pathFor(target: "memory" | "user" | "failure"): string {
		if (target === "user") return path.join(this.memoryDir, USER_FILE);
		if (target === "failure") return path.join(this.memoryDir, "failures.md");
		return path.join(this.memoryDir, MEMORY_FILE);
	}

	private entriesFor(target: "memory" | "user" | "failure"): string[] {
		if (target === "user") return this.userEntries;
		if (target === "failure") return this.failureEntries;
		return this.memoryEntries;
	}

	private setEntries(
		target: "memory" | "user" | "failure",
		entries: string[],
	): void {
		if (target === "user") this.userEntries = entries;
		else if (target === "failure") this.failureEntries = entries;
		else this.memoryEntries = entries;
	}

	private charLimit(target: "memory" | "user" | "failure"): number {
		if (target === "failure") return this.config.memoryCharLimit * 2;
		return target === "user"
			? this.config.userCharLimit
			: this.config.memoryCharLimit;
	}

	private charCount(target: "memory" | "user" | "failure"): number {
		const entries = this.entriesFor(target);
		return entries.length ? entries.join(ENTRY_DELIMITER).length : 0;
	}

	private saveForTarget(
		target: "memory" | "user" | "failure",
	): (entries: string[]) => Promise<void> {
		return async (entries: string[]) => {
			this.setEntries(target, entries);
			await saveMemoryFile(
				this.memoryDir,
				this.pathFor(target),
				this.entriesFor(target),
			);
		};
	}

	async loadFromDisk(): Promise<void> {
		await fs.mkdir(this.memoryDir, { recursive: true });
		this.memoryEntries = await readMemoryFile(this.pathFor("memory"));
		this.userEntries = await readMemoryFile(this.pathFor("user"));
		this.failureEntries = await readMemoryFile(this.pathFor("failure"));
		this.memoryEntries = [...new Set(this.memoryEntries)];
		this.userEntries = [...new Set(this.userEntries)];
		this.failureEntries = [...new Set(this.failureEntries)];
		this.snapshot = buildSnapshot(
			this.memoryEntries.map((e) => stripMetadata(e)),
			this.userEntries.map((e) => stripMetadata(e)),
			this.config.memoryCharLimit,
			this.config.userCharLimit,
		);
	}

	async add(
		target: "memory" | "user" | "failure",
		content: string,
		signal?: AbortSignal,
		_retriesLeft = 1,
		addedMessage = "Entry added.",
	): Promise<MemoryResult> {
		const entries = this.entriesFor(target);
		const limit = this.charLimit(target);
		const strategy =
			this.config.memoryOverflowStrategy ??
			(this.config.autoConsolidate ? "auto-consolidate" : "reject");

		const result = computeAddResult({
			target,
			content,
			entries,
			limit,
			strategy,
			addedMessage,
			tryConsolidate:
				strategy === "auto-consolidate" && this.consolidator && _retriesLeft > 0
					? async () => {
							const res = await this.consolidator!(target, signal);
							return res.consolidated;
						}
					: undefined,
		});

		if (result.needsConsolidationRetry) {
			try {
				const consolidated = this.consolidator
					? await this.consolidator(target, signal).then((r) => r.consolidated)
					: false;
				if (consolidated) {
					await this.loadFromDisk();
					return this.add(
						target,
						content,
						signal,
						_retriesLeft - 1,
						addedMessage,
					);
				}
			} catch {
				// fall through to full error
			}
			return buildMemoryFullError(
				target,
				this.charCount(target),
				limit,
				content.trim().length,
			);
		}

		if (result.result && result.newEntries) {
			this.setEntries(target, result.newEntries);
			await saveMemoryFile(
				this.memoryDir,
				this.pathFor(target),
				result.newEntries,
			);
			return result.result;
		}

		if (
			strategy === "fifo-evict" &&
			result.newEntries === null &&
			result.result === null
		) {
			const today = new Date().toISOString().split("T")[0];
			const encoded = encodeEntry(content.trim(), today, today);
			return fifoEvictAndAdd(
				target,
				entries,
				encoded,
				content.trim().length,
				limit,
				this.saveForTarget(target),
			);
		}

		return (
			result.result ??
			buildMemoryFullError(
				target,
				this.charCount(target),
				limit,
				content.trim().length,
			)
		);
	}

	async addFailure(
		content: string,
		options: {
			category: import("../types.js").MemoryCategory;
			failureReason?: string;
			toolState?: string;
			correctedTo?: string;
		},
	): Promise<MemoryResult> {
		const failureText = buildFailureMemoryText(content, options);
		return this.add(
			"failure",
			failureText,
			undefined,
			1,
			"Failure memory saved: " + options.category,
		);
	}

	async replace(
		target: "memory" | "user" | "failure",
		oldText: string,
		newContent: string,
	): Promise<MemoryResult> {
		const result = computeReplaceResult({
			target,
			oldText,
			newContent,
			entries: this.entriesFor(target),
			limit: this.charLimit(target),
		});

		if (result.newEntries) {
			this.setEntries(target, result.newEntries);
			await saveMemoryFile(
				this.memoryDir,
				this.pathFor(target),
				result.newEntries,
			);
		}

		return result.result ?? { success: false, error: "Replace failed." };
	}

	async remove(
		target: "memory" | "user" | "failure",
		oldText: string,
	): Promise<MemoryResult> {
		const result = computeRemoveResult({
			target,
			oldText,
			entries: this.entriesFor(target),
			limit: this.charLimit(target),
		});

		if (result.newEntries) {
			this.setEntries(target, result.newEntries);
			await saveMemoryFile(
				this.memoryDir,
				this.pathFor(target),
				result.newEntries,
			);
		}

		return result.result ?? { success: false, error: "Remove failed." };
	}

	formatForSystemPrompt(): string {
		return formatSystemPromptContext(
			this.snapshot,
			this.failureEntries,
			this.config,
		);
	}

	getAllFailureEntries(): string[] {
		return this.failureEntries.map((e) => stripMetadata(e));
	}

	getMemoryEntries(): string[] {
		return this.memoryEntries.map((e) => stripMetadata(e));
	}

	getUserEntries(): string[] {
		return this.userEntries.map((e) => stripMetadata(e));
	}
}
