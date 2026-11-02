#!/usr/bin/env node
// SubagentStop: the worker result must contain a "Failures" section (P-028). The triage subagent is removed (2026-11-02):
// the main agent reads the mechanical lines `<id> <category>` itself (P-044).
import { readHookInput, emit, isMain } from '../scripts/hooks-io.mjs';
import { loadPolicy } from '../scripts/config.mjs';

export const HOOK_META = { event: 'SubagentStop', class: 'block', limit: '1 reason', principles: ['P-028'] };

export function hasFailuresSection(text) {
  return /(^|\n)\s*(#+\s*|\*\*)?failures\b/i.test(String(text || ''));
}

export function run(input, policy = loadPolicy(null)) {
  if (input.stop_hook_active) return {};
  const exempt = policy.harness?.subagent_stop_exempt_agent_types || [];
  if (exempt.includes(input.agent_type)) return {};
  if (hasFailuresSection(input.last_assistant_message)) return {};
  return {
    decision: 'block',
    reason: 'Result must end with a section "Failures: <what failed and what finally worked>" (write "Failures: none" if nothing failed), P-028. Keep the whole result under the limit (2 000 chars).',
  };
}

if (isMain(import.meta.url)) {
  try {
    emit(run(readHookInput()));
  } catch (err) {
    process.stderr.write(`subagent-stop: ${err.message}\n`);
    emit({});
  }
}
