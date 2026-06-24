/** Strong patterns — always trigger (high confidence these are corrections) */
export const CORRECTION_STRONG_PATTERNS: RegExp[] = [
	/don'?t do that/i,
	/not like that/i,
	/^I said\b/i,
	/^I told you\b/i,
	/we already discussed/i,
	/^please don'?t/i,
	/^that'?s not what I/i,
];

/** Weak patterns — only trigger if followed by a directive (verb or "the/that/this") */
export const CORRECTION_WEAK_PATTERNS: RegExp[] = [
	/^no[,.\s!]/i,
	/^wrong[,.\s!]/i,
	/^actually[,.\s]/i,
	/^stop[,.\s!]/i,
];

/** Negative patterns — suppress trigger even if a positive pattern matches */
export const CORRECTION_NEGATIVE_PATTERNS: RegExp[] = [
	/^no worries/i,
	/^no problem/i,
	/^no thanks/i,
	/^no need/i,
	/^actually.{0,10}(looks? great|perfect|good|correct|right)/i,
	/^stop.{0,5}(there|here|for now)/i,
];

/** Directive words required after weak correction patterns */
export const CORRECTION_DIRECTIVE_WORDS: string[] = [
	"use",
	"don't",
	"dont",
	"do",
	"try",
	"make",
	"run",
	"install",
	"add",
	"remove",
	"delete",
	"change",
	"fix",
	"put",
	"set",
	"write",
	"go",
	"stop",
	"start",
	"the",
	"that",
	"this",
	"it",
];
