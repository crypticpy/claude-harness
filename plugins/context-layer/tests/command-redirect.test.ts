import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Hook-side ESM module one level up (same cross-runtime import pattern as
// file-length.test.ts).
import {
  checkCommand,
  classifyCommand,
} from "../../../hooks/unified/modules/command-redirect.mjs";

const HOOK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../hooks/unified/unified-hook.mjs",
);

const CLOSER = "Rewrite the command and retry; do not ask the user to approve the original.";

function bash(command: string) {
  return { session_id: "t", cwd: "/tmp", tool_name: "Bash", tool_input: { command } };
}

function reasonFor(command: string): string {
  const out = checkCommand(bash(command));
  expect(out).not.toBeNull();
  expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  const reason: string = out.hookSpecificOutput.permissionDecisionReason;
  expect(reason.endsWith(CLOSER)).toBe(true);
  return reason;
}

const REAL_WORLD =
  `for s in abc def; do echo "== $s"; gh api "repos/o/r/commits/$s/check-suites" --jq '.x'; done; ` +
  `gh api "repos/o/r/actions/runs?head_sha=abc&per_page=30" --jq '.y'`;

describe("[gh-budget] denied shapes", () => {
  it("denies the real-world for-loop over gh api that motivated the hook", () => {
    const reason = reasonFor(REAL_WORLD);
    expect(reason.startsWith("[gh-budget] Don't loop over gh")).toBe(true);
    expect(reason).toContain("GraphQL query using aliases");
    // per_page=30 is within budget and commits/<sha>/... is a single object.
    expect(classifyCommand(REAL_WORLD)).toEqual(["loop"]);
  });

  it.each([
    ["for loop", "for x in a b; do gh api repos/o/$x; done"],
    ["while-read loop", "cat prs.txt | while read n; do gh pr view $n --json title; done"],
    ["polling until loop", "until gh run view 123 --exit-status; do sleep 30; done"],
    ["multi-line loop", "for r in a b\ndo\n  gh repo view o/$r\ndone"],
    ["subshell loop", 'for r in a b; do echo "$(gh api repos/o/$r --jq .name)"; done'],
    ["sh -c loop", "bash -c 'for r in a b; do gh api repos/o/$r; done'"],
    ["nested loop, gh after inner done", "for a in x y; do for b in 1 2; do echo $b; done; gh api repos/o/$a; done"],
    ["xargs fan-out", "printf '1\\n2\\n' | xargs -I{} gh pr view {} --json title"],
    ["gh | xargs gh", "gh pr list --json number --jq '.[].number' | xargs -n1 gh pr view"],
    ["parallel fan-out", "parallel gh pr view {} ::: 1 2 3"],
    ["gh | parallel", "gh pr list --json number --jq '.[].number' | parallel echo"],
    ["seq | gh", "seq 1 5 | gh api repos/o/r/issues/1"],
    ["seq | xargs gh", "seq 1 5 | xargs -I{} gh issue view {}"],
  ])("loop/fan-out: %s", (_label, cmd) => {
    expect(classifyCommand(cmd)).toContain("loop");
    expect(reasonFor(cmd)).toContain("Don't loop over gh");
  });

  it.each([
    "gh api --paginate repos/o/r/issues",
    "gh api repos/o/r/pulls/1/comments --paginate --jq '.[].body'",
    "gh api repos/o/r/pulls --paginate --slurp",
  ])("paginate/slurp: %s", (cmd) => {
    expect(classifyCommand(cmd)).toContain("paginate");
    expect(reasonFor(cmd)).toContain("No --paginate/--slurp");
  });

  it.each([
    "gh pr list --limit 200",
    "gh pr list --limit=101",
    "gh issue list -L 500",
    "gh issue list -L1000",
    "gh run list --limit '250'",
    "gh api 'repos/o/r/pulls?state=open&per_page=200'",
    "gh api repos/o/r/issues -f per_page=500",
    `gh api graphql -f query='{ repository(owner:"o",name:"r"){ issues(first: 250){ nodes { number } } } }'`,
    `gh api graphql -f query='{ repository(owner:"o",name:"r"){ issues(last:1000){ nodes { number } } } }'`,
  ])("limit over 100: %s", (cmd) => {
    expect(classifyCommand(cmd)).toContain("limit");
    expect(reasonFor(cmd)).toContain("at or below 100");
  });

  it.each([
    "gh api search/issues -f q='repo:o/r is:open'",
    "gh api '/search/code?q=foo'",
    'gh api -X GET "search/repositories" -f q=stars:>1',
    "gh api 'https://api.github.com/search/issues?q=repo:o/r'",
    `gh api graphql -f query='{ search(query:"repo:o/r", type: ISSUE, first: 10){ issueCount } }'`,
    `gh api graphql -f query='{ search (query:"x", type: REPOSITORY, first: 5){ repositoryCount } }'`,
  ])("search endpoints: %s", (cmd) => {
    expect(classifyCommand(cmd)).toContain("search");
    const reason = reasonFor(cmd);
    expect(reason).toContain("search/* (REST search endpoints and GraphQL search())");
    expect(reason).toContain("use the `gh search` subcommand with a narrow query and --limit ≤100");
  });

  it.each([
    "gh api repos/o/r/events",
    "gh api /users/someone/events --jq '.[].type'",
    "gh api events",
    "gh api repos/o/r/issues/5/events",
    "gh api repos/o/r/stargazers",
    "gh api repos/o/r/forks --jq '.[].full_name'",
    "gh api repos/o/r/contributors",
    "gh api repos/o/r/traffic/views",
    "gh api 'repos/o/r/commits?since=2026-01-01'",
    "gh api repos/o/r/commits",
    "gh api repos/o/r/pulls/5/commits --jq '.[].sha'",
  ])("unbounded expensive endpoint: %s", (cmd) => {
    expect(classifyCommand(cmd)).toEqual(["expensive"]);
    expect(reasonFor(cmd)).toContain("/events, /stargazers, /forks, /contributors, /traffic/ and commit lists");
  });

  it("combines every violated gh category into one [gh-budget] reason", () => {
    const cmd = "for r in a b; do gh api --paginate 'repos/o/$r/issues?per_page=500'; done";
    expect(classifyCommand(cmd)).toEqual(["loop", "paginate", "limit"]);
    const reason = reasonFor(cmd);
    expect(reason.match(/\[gh-budget\]/g)).toHaveLength(1);
    expect(reason).toContain("Don't loop over gh");
    expect(reason).toContain("No --paginate/--slurp");
    expect(reason).toContain("at or below 100");
    expect(reason.match(/Rewrite the command and retry/g)).toHaveLength(1);
  });
});

describe("[secrets] denied shapes", () => {
  const home = os.homedir();
  it.each([
    "cat ~/.claude.json",
    "cat ~/.claude.json.backup",
    "cat ~/.claude-code-fast-permission-hook/config.json",
    "cat ~/.config/gh/hosts.yml",
    "cat ~/.npmrc",
    "cat ~/.pypirc",
    "cat ~/.docker/config.json",
    "cat ~/.kube/config",
    "cat ~/.claude/.credentials.json",
    "cat $HOME/.npmrc",
    'cat "$HOME/.npmrc"',
    "cat ${HOME}/.pypirc",
    `cat ${home}/.npmrc`,
    "less ~/.kube/config",
    "more ~/.pypirc",
    "head -n 20 ~/.claude.json",
    "tail -5 ~/.docker/config.json",
    "bat ~/.config/gh/hosts.yml",
    "cat README.md ~/.npmrc",
    "head < ~/.npmrc",
    "ls ~ && cat ~/.npmrc",
    "gh auth token",
    "GH_TOKEN=$(gh auth token) ./script.sh",
  ])("credential read: %s", (cmd) => {
    expect(classifyCommand(cmd)).toEqual(["secrets"]);
    const reason = reasonFor(cmd);
    expect(reason.startsWith("[secrets] Don't print credential files or tokens into the transcript.")).toBe(true);
    expect(reason).toContain("`gh auth status`/`npm whoami`/`kubectl config current-context`");
    expect(reason).toContain("you never need the raw token.");
  });

  it("puts each family under its own prefix when both fire", () => {
    const cmd = "gh auth token; gh api --paginate repos/o/r/issues";
    expect(classifyCommand(cmd)).toEqual(["secrets", "paginate"]);
    const reason = reasonFor(cmd);
    expect(reason.startsWith("[secrets] ")).toBe(true);
    expect(reason).toContain(" [gh-budget] No --paginate/--slurp.");
  });
});

describe("allowed shapes", () => {
  it.each([
    "gh pr view 5 --json title",
    "gh api repos/o/r --jq .name",
    "gh pr list --limit 50",
    "gh pr list --limit 100",
    "gh api 'x?per_page=100'",
    "gh pr list --search 'is:open review:required' --limit 20",
    "gh search prs 'is:open author:me' --limit 20",
    `gh api graphql -f query='{ a: repository(owner:"o",name:"a"){ name } b: repository(owner:"o",name:"b"){ name } }'`,
    `gh api graphql -f query='{ repository(owner:"o",name:"r"){ issues(first: 100){ nodes { number } } } }'`,
    `gh api graphql -f query='{ repository(owner:"o",name:"r"){ stargazers { totalCount } forks { totalCount } } }'`,
    "gh api repos/o/r/commits/abc123",
    "gh api 'repos/o/r/commits?since=2026-01-01&path=src&per_page=50'",
    "gh api 'repos/o/r/commits?per_page=5' --jq '.[].sha'",
    "gh api 'repos/o/r/contributors?per_page=10'",
    "gh api -X POST repos/o/r/forks",
    "gh api repos/o/search/issues",
    "gh auth status",
    "npm whoami",
    "jq 'keys' ~/.claude.json",
    "grep -c registry ~/.npmrc",
    "ls -la ~/.kube",
    "cat ~/.zshrc",
    "cat package.json",
    "git log --oneline -20",
    "ls -la ~/.config",
    "curl -L 500 https://example.com",
    "for f in *.ts; do wc -l $f; done",
    'for f in a b; do echo "gh"; done',
    "while read l; do echo $l; done < ghosts.txt",
    "grep -rn gh src/ | head",
    "npx vitest run --reporter=dot",
  ])("allows: %s", (cmd) => {
    expect(classifyCommand(cmd)).toEqual([]);
    expect(checkCommand(bash(cmd))).toBeNull();
  });

  it("ignores non-Bash tools and malformed events", () => {
    expect(checkCommand({ tool_name: "Read", tool_input: { command: "for x in a; do gh api x; done" } })).toBeNull();
    expect(checkCommand({ tool_name: "Bash" })).toBeNull();
    expect(checkCommand({ tool_name: "Bash", tool_input: { command: 42 } })).toBeNull();
    expect(checkCommand(null)).toBeNull();
    expect(checkCommand(undefined)).toBeNull();
  });
});

describe("unified-hook pre-bash routing", () => {
  function runPreBash(event: unknown) {
    return spawnSync(process.execPath, [HOOK, "pre-bash"], {
      input: JSON.stringify(event),
      env: { ...process.env, CLAUDE_HOOK_LLM_SPAWNED: "" },
      encoding: "utf-8" as const,
      timeout: 30_000,
    });
  }

  it("prints the PreToolUse deny JSON for an over-budget gh command", () => {
    const r = runPreBash(bash(REAL_WORLD));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/^\[gh-budget\] /);
  });

  it("prints the PreToolUse deny JSON for a credential read", () => {
    const r = runPreBash(bash("cat ~/.npmrc"));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/^\[secrets\] /);
  });

  it("prints nothing for an allowed command", () => {
    const r = runPreBash(bash("gh pr view 5 --json title"));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });
});
