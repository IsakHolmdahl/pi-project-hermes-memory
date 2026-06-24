/**
 * Failure memory text construction.
 */

import type { MemoryCategory } from "../types.js";

export function buildFailureMemoryText(
	content: string,
	options: {
		category: MemoryCategory;
		failureReason?: string;
		toolState?: string;
		correctedTo?: string;
	},
): string {
	const trimmedContent = content.trim();
	const categoryTag = "[" + options.category + "]";
	const parts = [categoryTag + " " + trimmedContent];
	if (options.failureReason) parts.push("Failed: " + options.failureReason);
	if (options.toolState) parts.push("Tool state: " + options.toolState);
	if (options.correctedTo) parts.push("Corrected to: " + options.correctedTo);
	return parts.join(" — ");
}

export function filterFailureEntriesByAge(
	entries: string[],
	maxAgeDays: number,
): string[] {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - maxAgeDays);
	const cutoffStr = cutoff.toISOString().split("T")[0];

	return entries
		.filter((entry) => {
			const match = entry.match(
				/^(.*?)\s*<!--\s*created=([^,]+),\s*last=([^>]+)\s*-->\s*$/,
			);
			const created = match
				? match[2].trim()
				: new Date().toISOString().split("T")[0];
			return created >= cutoffStr;
		})
		.map((entry) => {
			const match = entry.match(
				/^(.*?)\s*<!--\s*created=([^,]+),\s*last=([^>]+)\s*-->\s*$/,
			);
			return match ? match[1].trim() : entry.trim();
		});
}
