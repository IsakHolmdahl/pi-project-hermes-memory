/**
 * Index sessions command — /memory-index-sessions imports past sessions into SQLite.
 */

import path from 'node:path';
import fs from 'node:fs';
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DatabaseManager } from '../store/db.js';
import { indexAllSessions, getSessionStats } from '../store/session-indexer.js';
import { cwdToSessionDir } from '../store/session-parser.js';
import { AGENT_ROOT } from '../paths.js';

const SESSIONS_DIR = path.join(AGENT_ROOT, 'sessions');

export function registerIndexSessionsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("memory-index-sessions", {
    description: "Import past Pi sessions into the search database",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      // Show initial progress
      ctx.ui.notify('🔍 Scanning session directories...', 'info');

      try {
        // Scope to the current project directory only
        const projectDir = cwdToSessionDir(ctx.cwd);
        const projectSessionsDir = path.join(SESSIONS_DIR, projectDir);

        // Count session files for this project
        let totalFiles = 0;
        if (fs.existsSync(projectSessionsDir)) {
          totalFiles = fs.readdirSync(projectSessionsDir)
            .filter(f => f.endsWith('.jsonl')).length;
        }

        ctx.ui.notify(`📁 Found ${totalFiles} session file${totalFiles === 1 ? '' : 's'} for this project\n⏳ Indexing...`, 'info');

        const memoryDir = path.join(AGENT_ROOT, 'pi-hermes-memory');
        const dbManager = new DatabaseManager(memoryDir);

        try {
          const result = indexAllSessions(dbManager, SESSIONS_DIR, projectDir);
          const stats = getSessionStats(dbManager);

          let output = `\n✅ Session indexing complete!\n\n`;
          output += `📊 Results:\n`;
          output += `├─ Sessions processed: ${result.sessionsProcessed}\n`;
          output += `├─ Sessions indexed: ${result.sessionsIndexed}\n`;
          output += `├─ Sessions skipped (already indexed): ${result.sessionsSkipped}\n`;
          output += `└─ Messages indexed: ${result.messagesIndexed}\n`;

          if (stats.projects.length > 0) {
            output += `\n📁 Projects indexed:\n`;
            for (const p of stats.projects) {
              output += `├─ ${p.project}: ${p.sessions} sessions, ${p.messages} messages\n`;
            }
          }

          // Show totals
          output += `\n📈 Database totals:\n`;
          output += `├─ ${stats.totalSessions} sessions\n`;
          output += `├─ ${stats.totalMessages} messages\n`;
          output += `└─ ${stats.projects.length} projects\n`;

          if (result.errors.length > 0) {
            output += `\n⚠️ Errors (${result.errors.length}):\n`;
            for (const err of result.errors.slice(0, 3)) {
              output += `├─ ${err}\n`;
            }
            if (result.errors.length > 3) {
              output += `└─ ... and ${result.errors.length - 3} more\n`;
            }
          }

          output += `\n💡 Use the session_search tool to search across sessions in this project.`;

          ctx.ui.notify(output, 'info');
        } finally {
          dbManager.close();
        }
      } catch (err) {
        ctx.ui.notify(`❌ Session indexing failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    },
  });
}
