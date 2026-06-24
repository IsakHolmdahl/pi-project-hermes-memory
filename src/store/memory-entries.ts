/**
 * Memory entry encoding / decoding helpers.
 * Entries store metadata (created, lastReferenced) in an HTML comment.
 */

export function encodeEntry(
	text: string,
	created: string,
	lastReferenced: string,
): string {
	return `${text} <!-- created=${created}, last=${lastReferenced} -->`;
}

export function decodeEntry(raw: string): {
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

export function stripMetadata(raw: string): string {
	return decodeEntry(raw).text;
}
