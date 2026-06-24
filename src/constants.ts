/**
 * Constants — prompts, defaults, and delimiter.
 * Ported from hermes-agent/tools/memory_tool.py and hermes-agent/run_agent.py.
 * See PLAN.md → "Hermes Source File Reference Map" for exact source lines.
 */

// ─── Entry delimiter (same as Hermes) ───
export const ENTRY_DELIMITER = "\n§\n";

// ─── Directory names ───
export const LOCAL_HERMES_DIR = ".pi/hermes-memory";
export const LOCAL_SKILLS_DIR = ".pi/skills";
export const LOCAL_CONFIG_FILE = "config.json";

// ─── Character limits (not tokens — model-independent) ───
export const DEFAULT_MEMORY_CHAR_LIMIT = 5000;
export const DEFAULT_USER_CHAR_LIMIT = 5000;

// ─── Learning loop defaults ───
export const DEFAULT_PROJECT_CHAR_LIMIT = 5000;

export const DEFAULT_NUDGE_INTERVAL = 10;
export const DEFAULT_FLUSH_MIN_TURNS = 6;
export const DEFAULT_NUDGE_TOOL_CALLS = 15;
export const DEFAULT_REVIEW_RECENT_MESSAGES = 0;
export const DEFAULT_FLUSH_RECENT_MESSAGES = 0;
export const DEFAULT_CONSOLIDATION_TIMEOUT_MS = 60000;
export const DEFAULT_FAILURE_INJECTION_MAX_AGE_DAYS = 7;
export const DEFAULT_FAILURE_INJECTION_MAX_ENTRIES = 5;

// ─── File names ───
export const MEMORY_FILE = "MEMORY.md";
export const USER_FILE = "USER.md";

export {
	MEMORY_POLICY_PROMPT,
	MEMORY_POLICY_PROMPT_COMPACT,
	MEMORY_TOOL_DESCRIPTION,
	COMBINED_REVIEW_PROMPT,
	FLUSH_PROMPT,
	CONSOLIDATION_PROMPT,
	CORRECTION_SAVE_PROMPT,
	SKILL_TOOL_DESCRIPTION,
	INTERVIEW_PROMPT,
} from "./constants/prompts.js";
export {
	CORRECTION_STRONG_PATTERNS,
	CORRECTION_WEAK_PATTERNS,
	CORRECTION_NEGATIVE_PATTERNS,
	CORRECTION_DIRECTIVE_WORDS,
} from "./constants/correction-patterns.js";
