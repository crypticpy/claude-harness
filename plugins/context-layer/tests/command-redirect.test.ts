import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Hook-side ESM modules one level up (same cross-runtime import pattern as
// file-length.test.ts).
import {
  checkCommand,
  classifyCommand,
} from "../../../hooks/unified/modules/command-redirect.mjs";
import { parseCommand } from "../../../hooks/unified/modules/command-lexer.mjs";
import { RULES } from "../../../hooks/unified/modules/command-rules.mjs";

const HOOK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../hooks/unified/unified-hook.mjs",
);

const RETRY = "Rewrite the command and retry; do not ask the user to approve the original.";
const WORKAROUND = "Don't work around this with another tool (python shutil/os.remove, node fs.rm, find -delete, a script file, etc.).";
const GUARDED_END = "' to your final report/handoff and continue with the rest of the task.";

function bash(command: string) {
  return { session_id: "t", cwd: "/tmp", tool_name: "Bash", tool_input: { command } };
}

function reasonFor(command: string): string {
  const out = checkCommand(bash(command));
  expect(out).not.toBeNull();
  expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  return out.hookSpecificOutput.permissionDecisionReason;
}

const REAL_WORLD =
  `for s in abc def; do echo "== $s"; gh api "repos/o/r/commits/$s/check-suites" --jq '.x'; done; ` +
  `gh api "repos/o/r/actions/runs?head_sha=abc&per_page=30" --jq '.y'`;

// ---------------------------------------------------------------------------
// Deny table: [rule id, command]. Each command must hit exactly that rule.
// ---------------------------------------------------------------------------

const GH_BUDGET: Array<[string, string]> = [
  ["loop", "for x in a b; do gh api repos/o/$x; done"],
  ["loop", "cat prs.txt | while read n; do gh pr view $n --json title; done"],
  ["loop", "until gh run view 123 --exit-status; do sleep 30; done"],
  ["loop", "for r in a b\ndo\n  gh repo view o/$r\ndone"],
  ["loop", 'for r in a b; do echo "$(gh api repos/o/$r --jq .name)"; done'],
  ["loop", "bash -c 'for r in a b; do gh api repos/o/$r; done'"],
  ["loop", "for a in x y; do for b in 1 2; do echo $b; done; gh api repos/o/$a; done"],
  ["loop", "printf '1\\n2\\n' | xargs -I{} gh pr view {} --json title"],
  ["loop", "gh pr list --json number --jq '.[].number' | xargs -n1 gh pr view"],
  ["loop", "parallel gh pr view {} ::: 1 2 3"],
  ["loop", "gh pr list --json number --jq '.[].number' | parallel echo"],
  ["loop", "seq 1 5 | gh api repos/o/r/issues/1"],
  ["loop", "seq 1 5 | xargs -I{} gh issue view {}"],
  ["paginate", "gh api --paginate repos/o/r/issues"],
  ["paginate", "gh api repos/o/r/pulls/1/comments --paginate --jq '.[].body'"],
  ["paginate", "gh api repos/o/r/pulls --paginate --slurp"],
  ["limit", "gh pr list --limit 200"],
  ["limit", "gh pr list --limit=101"],
  ["limit", "gh issue list -L 500"],
  ["limit", "gh issue list -L1000"],
  ["limit", "gh run list --limit '250'"],
  ["limit", "gh api 'repos/o/r/pulls?state=open&per_page=200'"],
  ["limit", "gh api repos/o/r/issues -f per_page=500"],
  ["limit", `gh api graphql -f query='{ repository(owner:"o",name:"r"){ issues(first: 250){ nodes { number } } } }'`],
  ["limit", `gh api graphql -f query='{ repository(owner:"o",name:"r"){ issues(last:1000){ nodes { number } } } }'`],
  ["search", "gh api search/issues -f q='repo:o/r is:open'"],
  ["search", "gh api '/search/code?q=foo'"],
  ["search", 'gh api -X GET "search/repositories" -f q=stars:>1'],
  ["search", "gh api 'https://api.github.com/search/issues?q=repo:o/r'"],
  ["search", `gh api graphql -f query='{ search(query:"repo:o/r", type: ISSUE, first: 10){ issueCount } }'`],
  ["search", `gh api graphql -f query='{ search (query:"x", type: REPOSITORY, first: 5){ repositoryCount } }'`],
  ["expensive", "gh api repos/o/r/events"],
  ["expensive", "gh api /users/someone/events --jq '.[].type'"],
  ["expensive", "gh api events"],
  ["expensive", "gh api repos/o/r/issues/5/events"],
  ["expensive", "gh api repos/o/r/stargazers"],
  ["expensive", "gh api repos/o/r/forks --jq '.[].full_name'"],
  ["expensive", "gh api repos/o/r/contributors"],
  ["expensive", "gh api repos/o/r/traffic/views"],
  ["expensive", "gh api 'repos/o/r/commits?since=2026-01-01'"],
  ["expensive", "gh api repos/o/r/commits"],
  ["expensive", "gh api repos/o/r/pulls/5/commits --jq '.[].sha'"],
];

const home = os.homedir();
const SECRETS: Array<[string, string]> = [
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
].map((c) => ["secrets", c]);

const GUARDED: Array<[string, string]> = [
  // file deletion
  ["rm-recursive", "rm -rf build"],
  ["rm-recursive", "rm -r dir"],
  ["rm-recursive", "rm -R dir"],
  ["rm-recursive", "rm -fr dir"],
  ["rm-recursive", "rm --recursive dir"],
  ["rm-recursive", "rm dir -rf"],
  ["rm-recursive", "/bin/rm -rf x"],
  ["rm-recursive", "\\rm -rf x"],
  ["rm-recursive", "r''m -rf x"],
  ["rm-recursive", "command rm -rf x"],
  ["rm-recursive", "FOO=1 rm -rf x"],
  ["rm-recursive", "cd /tmp && rm -rf x"],
  ["rm-recursive", "bash -c 'rm -rf x'"],
  ["rm-recursive", "echo $(rm -rf x)"],
  ["rm-recursive", "sh <<'EOF'\nrm -rf x\nEOF"],
  ["find-delete", "find . -name '*.log' -delete"],
  ["find-delete", "find . -type f -exec rm {} \\;"],
  ["find-delete", "find . -execdir /bin/rm -f {} +"],
  ["xargs-rm", "ls *.tmp | xargs rm"],
  ["xargs-rm", "find . -name x -print0 | xargs -0 rm -f"],
  ["mv-devnull", "mv notes.txt /dev/null"],
  ["truncate", "truncate -s 0 app.log"],
  ["script-delete", `python3 -c "import shutil; shutil.rmtree('build')"`],
  ["script-delete", `node -e "require('fs').rmSync('dist', { recursive: true, force: true })"`],
  ["script-delete", `node -e "fs.rmSync(path.join(a, 'b'), {recursive: true})"`],
  ["script-delete", `ruby -e "FileUtils.rm_rf('x')"`],
  ["script-delete", "python3 - <<'EOF'\nimport shutil\nshutil.rmtree('x')\nEOF"],
  // git
  ["git-discard", "git reset --hard"],
  ["git-discard", "git reset --hard HEAD~1"],
  ["git-discard", "git reset --merge"],
  ["git-discard", "git -C repo reset --hard origin/main"],
  ["git-discard", "git checkout -- src/a.ts"],
  ["git-discard", "git checkout ."],
  ["git-discard", "git checkout -f main"],
  ["git-discard", "git checkout HEAD -- ."],
  ["git-discard", "git restore ."],
  ["git-discard", "git restore src/a.ts"],
  ["git-discard", "git restore --worktree a"],
  ["git-discard", "git restore -W a"],
  ["git-discard", "git restore --source=HEAD~1 a"],
  ["git-discard", "git restore -s HEAD a"],
  ["git-discard", "git restore --staged --worktree a"],
  ["git-discard", "git switch -f main"],
  ["git-discard", "git switch --discard-changes main"],
  ["git-discard", "git switch -C main"],
  ["git-discard", "git clean -fd"],
  ["git-discard", "git clean -xdf"],
  ["git-discard", "git clean -X"],
  ["git-discard", "git clean --force"],
  ["git-branch-force", "git branch -D feat"],
  ["git-branch-force", "git branch -f main HEAD~1"],
  ["git-branch-force", "git branch --delete --force x"],
  ["git-push-force", "git push --force"],
  ["git-push-force", "git push -f origin main"],
  ["git-push-force", "git push --force-with-lease"],
  ["git-push-force", "git push origin feat --force-with-lease=feat"],
  ["git-push-force", "git push --force-if-includes"],
  ["git-push-force", "git push origin +main"],
  ["git-push-force", "git push --mirror"],
  ["git-push-delete", "git push origin --delete old"],
  ["git-push-delete", "git push origin :old"],
  ["git-push-delete", "git push -d origin old"],
  ["git-push-tags", "git push --tags"],
  ["git-push-tags", "git push origin --tags"],
  ["git-stash-drop", "git stash drop"],
  ["git-stash-drop", "git stash drop stash@{0}"],
  ["git-stash-drop", "git stash clear"],
  ["git-tag-rewrite", "git tag -d v1"],
  ["git-tag-rewrite", "git tag -f v1"],
  ["git-tag-rewrite", "git tag --delete v1"],
  ["git-worktree-force", "git worktree remove --force ../wt"],
  ["git-worktree-force", "git worktree remove -f ../wt"],
  ["git-worktree-force", "git worktree remove ../wt --force"],
  ["git-rm-force", "git rm -f a"],
  ["git-rm-force", "git rm -rf dir"],
  ["git-rm-force", "git rm --force a"],
  ["git-submodule-deinit", "git submodule deinit lib"],
  ["git-remote-change", "git remote remove origin"],
  ["git-remote-change", "git remote rm origin"],
  ["git-remote-change", "git remote set-url origin git@x:y.git"],
  ["git-remote-change", "git remote rename a b"],
  ["git-config-global", "git config --global user.name x"],
  ["git-config-global", "git config --system core.editor vi"],
  ["git-config-global", "git config core.hooksPath /dev/null"],
  ["git-gc", "git gc --prune=now"],
  ["git-gc", "git repack -ad"],
  ["git-prune-tags", "git fetch --prune-tags"],
  ["git-prune-tags", "git fetch origin --prune-tags"],
  ["git-rebase-interactive", "git rebase -i HEAD~3"],
  ["git-rebase-interactive", "git rebase --interactive main"],
  // registries and global installs
  ["publish", "npm publish"],
  ["publish", "pnpm publish --access public"],
  ["publish", "yarn publish"],
  ["publish", "yarn npm publish"],
  ["publish", "bun publish"],
  ["publish", "npm unpublish x@1.0.0"],
  ["publish", "npm deprecate x 'old'"],
  ["publish", "poetry publish --build"],
  ["publish", "cargo publish"],
  ["publish", "cargo yank --version 1.0.0"],
  ["publish", "gem push x-1.0.gem"],
  ["registry-auth", "npm login"],
  ["registry-auth", "npm logout"],
  ["global-install", "npm install -g typescript"],
  ["global-install", "npm i -g x"],
  ["global-install", "npm install --global x"],
  ["global-install", "npm uninstall -g x"],
  ["global-install", "npm install x -g"],
  ["global-install", "pnpm add -g x"],
  ["global-install", "pnpm remove -g x"],
  ["global-install", "yarn global add x"],
  ["global-install", "bun add -g x"],
  ["global-install", "cargo install ripgrep"],
  ["global-install", "cargo uninstall ripgrep"],
  ["global-install", "gem uninstall rails"],
  ["global-install", "brew install jq"],
  ["global-install", "brew upgrade"],
  ["global-install", "brew uninstall jq"],
  ["global-install", "brew rm jq"],
  ["global-install", "brew cleanup"],
  ["global-install", "brew services start postgresql"],
  ["global-install", "pip uninstall requests"],
  ["global-install", "pip3 uninstall requests"],
  ["global-install", "python3 -m pip uninstall requests"],
  ["global-install", "make install"],
  ["global-install", "make -C build uninstall"],
  ["global-install", "npm cache clean --force"],
  ["global-install", "yarn cache clean"],
  ["global-install", "pnpm store prune"],
  ["npm-audit-fix", "npm audit fix"],
  ["npm-audit-fix", "npm audit fix --force"],
  // processes and system
  ["kill", "kill 1234"],
  ["kill", "kill -9 1234"],
  ["kill", "killall node"],
  ["kill", "pkill -f vite"],
  ["kill", "lsof -ti :3000 | xargs kill"],
  ["sudo", "sudo ls /root"],
  ["sudo", "sudo -u admin whoami"],
  ["sudo", "su root"],
  ["sudo", "doas pkg_add x"],
  ["system-config", "launchctl unload ~/Library/LaunchAgents/x.plist"],
  ["system-config", "launchctl bootout gui/501/com.x"],
  ["system-config", "launchctl kickstart -k gui/501/com.x"],
  ["system-config", "defaults write com.apple.dock autohide -bool true"],
  ["system-config", "defaults delete com.x"],
  ["system-config", "crontab -e"],
  ["system-config", "crontab -l"],
  ["system-config", "shutdown -h now"],
  ["system-config", "reboot"],
  ["system-config", "halt"],
  ["desktop", "osascript -e 'display dialog \"x\"'"],
  ["desktop", "open https://example.com"],
  ["desktop", "open ."],
  ["keys", "security find-generic-password -s x -w"],
  ["keys", "ssh-keygen -t ed25519"],
  ["keys", "ssh-add ~/.ssh/id_ed25519"],
  ["keys", "gpg --delete-secret-keys ABC"],
  ["keys", "gpg --gen-key"],
  ["keys", "gpg --full-generate-key"],
  ["perms-recursive", "chmod -R 777 ."],
  ["perms-recursive", "chown -R me dir"],
  ["perms-recursive", "chflags hidden x"],
  // infra
  ["infra", "docker rm c1"],
  ["infra", "docker rmi img"],
  ["infra", "docker image rm img"],
  ["infra", "docker image prune -a"],
  ["infra", "docker container prune"],
  ["infra", "docker volume rm v"],
  ["infra", "docker network prune"],
  ["infra", "docker builder prune"],
  ["infra", "docker system prune -af"],
  ["infra", "docker kill c1"],
  ["infra", "docker push img"],
  ["infra", "docker login"],
  ["infra", "docker logout"],
  ["infra", "docker compose down -v"],
  ["infra", "docker compose -f dev.yml down --volumes"],
  ["infra", "docker-compose down --volumes"],
  ["infra", "docker compose rm -v"],
  ["infra", "kubectl delete pod x"],
  ["infra", "kubectl -n prod apply -f x.yaml"],
  ["infra", "kubectl patch deploy x -p '{}'"],
  ["infra", "kubectl edit deploy x"],
  ["infra", "kubectl scale deploy x --replicas=0"],
  ["infra", "kubectl rollout restart deploy/x"],
  ["infra", "kubectl rollout undo deploy/x"],
  ["infra", "kubectl exec -it pod -- sh"],
  ["infra", "kubectl drain node1"],
  ["infra", "kubectl cordon node1"],
  ["infra", "kubectl replace -f x.yaml"],
  ["infra", "terraform apply"],
  ["infra", "terraform destroy -auto-approve"],
  ["infra", "terraform import aws_s3_bucket.b b"],
  ["infra", "terraform state rm x"],
  ["infra", "terraform state mv a b"],
  ["infra", "terraform taint x"],
  ["infra", "terraform workspace delete dev"],
  ["infra", "terraform force-unlock 123"],
  ["infra", "railway up"],
  ["infra", "railway redeploy"],
  ["infra", "railway down"],
  ["infra", "railway delete"],
  ["infra", "railway unlink"],
  ["infra", "railway variables set K=V"],
  ["infra", "railway variables delete K"],
  ["infra", "railway variables --set K=V"],
  ["infra", "railway volume delete v"],
  ["infra", "aws s3 rm s3://b/k"],
  ["infra", "aws s3 rb s3://b"],
  ["infra", "aws s3 sync . s3://b --delete"],
  ["infra", "aws ec2 terminate-instances --instance-ids i-1"],
  ["infra", "aws dynamodb delete-table --table-name t"],
  ["infra", "gcloud compute instances delete x"],
  ["infra", "az group delete -n rg"],
  // harness and gh
  ["harness", "claude mcp add x -- npx y"],
  ["harness", "claude mcp remove x"],
  ["harness", "claude plugin install x"],
  ["harness", "claude plugin uninstall x"],
  ["harness", "claude config set -g theme dark"],
  ["harness", "claude config remove x"],
  ["harness", "claude update"],
  ["harness", "claude install"],
  ["gh-user-action", "gh repo archive o/r"],
  ["gh-user-action", "gh repo unarchive o/r"],
  ["gh-user-action", "gh repo rename x"],
  ["gh-user-action", "gh repo edit --visibility public"],
  ["gh-user-action", "gh repo sync --force"],
  ["gh-user-action", "gh repo sync o/r --force"],
  ["gh-user-action", "gh repo delete o/r --yes"],
  ["gh-user-action", "gh project close 1"],
  ["gh-user-action", "gh project item-archive 1"],
  ["gh-user-action", "gh workflow disable ci"],
  ["gh-user-action", "gh auth login"],
  ["gh-user-action", "gh auth logout"],
  ["gh-user-action", "gh auth refresh -s project"],
  ["gh-user-action", "gh secret set TOKEN"],
  ["gh-user-action", "gh variable set NAME"],
  ["gh-user-action", "gh release delete v1"],
];

const FAMILY_OF = new Map(RULES.map((r: { id: string; family: string }) => [r.id, r.family]));

describe.each([
  ["gh-budget", GH_BUDGET],
  ["secrets", SECRETS],
  ["guarded", GUARDED],
])("[%s] denied shapes", (family, table) => {
  it.each(table)("%s: %s", (id, cmd) => {
    expect(classifyCommand(cmd)).toEqual([id]);
    expect(FAMILY_OF.get(id)).toBe(family);
    const reason = reasonFor(cmd);
    expect(reason.startsWith(`[${family}] `)).toBe(true);
    if (family === "guarded") {
      expect(reason).toContain(WORKAROUND);
      expect(reason).toMatch(/If the task truly needs it, add 'User action: run `[^`]+` because <why>'/);
      expect(reason.endsWith(GUARDED_END)).toBe(true);
    } else {
      expect(reason.endsWith(RETRY)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Allow table: near misses for every family. None may produce a decision.
// ---------------------------------------------------------------------------

const ALLOWED: string[] = [
  // gh-budget / secrets near misses
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
  "kubectl config current-context",
  "jq 'keys' ~/.claude.json",
  "grep -c registry ~/.npmrc",
  "ls -la ~/.kube",
  "cat ~/.zshrc",
  "cat package.json",
  "git log --oneline -20",
  "curl -L 500 https://example.com",
  "for f in *.ts; do wc -l $f; done",
  'for f in a b; do echo "gh"; done',
  "while read l; do echo $l; done < ghosts.txt",
  "grep -rn gh src/ | head",
  "npx vitest run --reporter=dot",
  // file deletion near misses
  "rm file.txt",
  "rm -f file.txt",
  "rm -- -r",
  "rmdir empty",
  'echo "rm -rf"',
  'grep -rn "rm -rf" .',
  'git commit -m "rm -rf build is gone"',
  "trash build",
  'mv build "$TMPDIR/"',
  "mv a b",
  "find . -name '*.log'",
  "find . -name x -print",
  "ls | xargs wc -l",
  "truncated-report --help",
  `node -e "fs.mkdirSync('a/b', {recursive: true})"`,
  "python3 script.py",
  "cat <<'EOF' > notes.md\nrm -rf is denied\nEOF",
  // git near misses
  "git reset --soft HEAD~1",
  "git reset HEAD a",
  "git checkout main",
  "git checkout -b feat",
  "git checkout --orphan gh-pages",
  "git restore --staged a",
  "git switch main",
  "git switch -c feat",
  "git switch --orphan x",
  "git clean -n",
  "git clean -nd",
  "git branch -d feat",
  "git branch --delete feat",
  "git branch -m old new",
  "git push",
  "git push -u origin feat",
  "git push origin v1.0",
  "git stash push -u -m why",
  "git stash pop --index",
  "git stash list",
  "git tag v1",
  "git tag -a v1 -m msg",
  "git worktree remove ../wt",
  "git worktree move a b",
  "git rm a",
  "git rm -r dir",
  "git rm --cached a",
  "git remote -v",
  "git config user.name x",
  "git config --get user.name",
  "git fetch --prune",
  "git rebase main",
  "git rebase --continue",
  "git commit --amend --no-edit",
  "git bisect reset",
  'echo "git reset --hard"',
  // package managers
  "npm uninstall lodash",
  "npm rm lodash",
  "pnpm remove x",
  "yarn remove x",
  "bun remove x",
  "uv remove x",
  "poetry remove x",
  "npm install -D vitest",
  "npm i",
  "pnpm install",
  "npm run publish-docs",
  "npm pack --dry-run",
  "npm audit",
  "cargo build",
  "cargo clean",
  "make clean",
  "make distclean",
  "make test",
  "brew list",
  "brew info jq",
  "pip3 list",
  // processes and system
  "ps aux | grep node",
  "echo kill",
  "lsof -i :3000",
  "launchctl list",
  "launchctl print gui/501",
  "defaults read com.apple.dock",
  "chmod +x script.sh",
  "chown me file",
  "gpg --list-keys",
  "grep -n sudo README.md",
  "openssl version",
  // infra
  "docker ps",
  "docker images",
  "docker inspect x",
  "docker stop c1",
  "docker compose down",
  "docker compose up -d",
  "docker build .",
  "kubectl get pods",
  "kubectl describe pod x",
  "kubectl diff -f x.yaml",
  "kubectl rollout status deploy/x",
  "terraform plan",
  "terraform state list",
  "railway status",
  "railway logs",
  "aws s3 ls",
  "aws ec2 describe-instances",
  "gcloud compute instances list",
  // harness and gh
  "claude mcp list",
  "claude plugin list",
  "claude -p hello",
  "gh run cancel 123",
  "gh pr close 5",
  "gh issue close 5",
  "gh repo view",
  "gh secret list",
  "gh workflow list",
  "ls -la",
];

describe("allowed shapes", () => {
  it.each(ALLOWED)("allows: %s", (cmd) => {
    expect(classifyCommand(cmd)).toEqual([]);
    expect(checkCommand(bash(cmd))).toBeNull();
  });

  it("ignores non-Bash tools and malformed events", () => {
    expect(checkCommand({ tool_name: "Read", tool_input: { command: "rm -rf x" } })).toBeNull();
    expect(checkCommand({ tool_name: "Bash" })).toBeNull();
    expect(checkCommand({ tool_name: "Bash", tool_input: { command: 42 } })).toBeNull();
    expect(checkCommand({ tool_name: "Bash", tool_input: { command: "" } })).toBeNull();
    expect(checkCommand(null)).toBeNull();
    expect(checkCommand(undefined)).toBeNull();
  });
});

describe("reason shape", () => {
  it("denies the real-world for-loop over gh api that motivated the hook", () => {
    const reason = reasonFor(REAL_WORLD);
    expect(reason.startsWith("[gh-budget] Don't loop over gh")).toBe(true);
    expect(reason).toContain("GraphQL query using aliases");
    // per_page=30 is within budget and commits/<sha>/... is a single object.
    expect(classifyCommand(REAL_WORLD)).toEqual(["loop"]);
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

  it("puts each family under its own prefix when several fire", () => {
    const cmd = "gh auth token; gh api --paginate repos/o/r/issues";
    expect(classifyCommand(cmd)).toEqual(["secrets", "paginate"]);
    const reason = reasonFor(cmd);
    expect(reason.startsWith("[secrets] ")).toBe(true);
    expect(reason).toContain(" [gh-budget] No --paginate/--slurp.");
    expect(reason.endsWith(RETRY)).toBe(true);
  });

  it("closes the retry families before the [guarded] section", () => {
    const reason = reasonFor("gh auth token && rm -rf build");
    expect(reason).toMatch(/^\[secrets\] .* Rewrite the command and retry; do not ask the user to approve the original\. \[guarded\] /);
    expect(reason.endsWith(GUARDED_END)).toBe(true);
  });

  it("names the offending segment in the User action line and states the alternative", () => {
    const reason = reasonFor("npm test && rm -rf build && echo done");
    expect(reason).toContain("`trash <path>`");
    expect(reason).toContain("'User action: run `rm -rf build` because <why>'");
  });

  it("lists a shared reason once when several rules of it fire", () => {
    const cmd = "rm -rf a; find . -delete; truncate -s0 x";
    expect(classifyCommand(cmd)).toEqual(["rm-recursive", "find-delete", "truncate"]);
    const reason = reasonFor(cmd);
    expect(reason.match(/is irreversible\. Move things to the Trash/g)).toHaveLength(1);
    expect(reason.match(/\[guarded\]/g)).toHaveLength(1);
  });

  it("every rule has a family prefix it can be reported under and a non-empty reason", () => {
    for (const r of RULES) {
      expect(["gh-budget", "secrets", "guarded"]).toContain(r.family);
      expect(r.reason.length).toBeGreaterThan(40);
      expect(r.cmds.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Nested-command bypasses: an allowed parent command whose flag or argument
// runs another command. [rule id the result must contain, command].
// ---------------------------------------------------------------------------

const NESTED_DENY: Array<[string, string]> = [
  // 1. git rebase --exec
  ["rm-recursive", "git rebase -x 'rm -rf src' HEAD~3"],
  ["git-rebase-exec", "git rebase -x 'rm -rf src' HEAD~3"],
  ["rm-recursive", "git rebase --exec='rm -rf ~/Projects' main"],
  ["git-rebase-exec", "git rebase --exec='rm -rf ~/Projects' main"],
  ["git-rebase-exec", 'git rebase --exec "npm test" main'],
  ["git-rebase-exec", "git rebase main -x 'make test'"],
  ["rm-recursive", "git rebase -x'rm -rf src' main"],
  // 2. shelled-out rm -r from inline interpreter code
  ["script-delete", `python3 -c "import os; os.system('rm -rf x')"`],
  ["script-delete", `python3 -c "import os; os.system('rm -Rf x')"`],
  ["script-delete", `python3 -c "import os; os.system('rm --recursive x')"`],
  ["script-delete", `python3 -c "import subprocess; subprocess.run(['rm', '-rf', 'x'])"`],
  ["script-delete", `python3 -c "import subprocess; subprocess.run(['rm', '--recursive', 'x'])"`],
  ["script-delete", `node -e "require('child_process').execSync('rm -rf x')"`],
  ["script-delete", `node -e "require('child_process').spawnSync('rm', ['-Rf', 'x'])"`],
  ["script-delete", `node -e "require('child_process').execSync('rm --recursive x')"`],
  // 3. find -exec / -execdir through a wrapper
  ["rm-recursive", `find . -exec sh -c 'rm -rf "$1"' _ {} \\;`],
  ["rm-recursive", "find . -exec env rm -rf {} +"],
  ["rm-recursive", `find . -execdir bash -c 'cd .. && rm -r "$0"' {} \\;`],
  ["find-delete", "find . -name '*.tmp' -exec env rm {} +"],
  // 4. package runners
  ["script-delete", `uv run python -c "import shutil; shutil.rmtree('x')"`],
  ["script-delete", `npx tsx -e "require('fs').rmSync('x',{recursive:true})"`],
  ["script-delete", `tsx -e "require('fs').rmSync('x',{recursive:true})"`],
  ["script-delete", `ts-node -e "require('fs').rmSync('x',{recursive:true})"`],
  ["script-delete", `poetry run python -c "import shutil; shutil.rmtree('x')"`],
  ["rm-recursive", "npm exec -- rimraf dist"],
  ["rm-recursive", "bunx rimraf dist"],
  ["rm-recursive", "npx rimraf dist"],
  ["rm-recursive", "npx --yes rimraf dist"],
  ["rm-recursive", "pnpm dlx rimraf dist"],
  ["rm-recursive", "yarn dlx rimraf dist"],
  ["rm-recursive", "bun x rimraf dist"],
  ["rm-recursive", "rimraf dist"],
  ["rm-recursive", "npx del-cli dist"],
  ["rm-recursive", "npx -c 'rm -rf dist'"],
  ["rm-recursive", "pnpm exec rm -rf dist"],
  ["rm-recursive", "pnpm --filter web exec rm -rf dist"],
  ["rm-recursive", "uvx --from x rm -rf dist"],
  ["rm-recursive", "pipx run --spec x rm -rf dist"],
  // 5. branch force-rename / force-copy
  ["git-branch-force", "git branch -M feature main"],
  ["git-branch-force", "git branch -C feature main"],
  ["git-branch-force", "git branch -M new"], // round 3 allowed this; -M overwrites an existing branch
  ["git-branch-force", "git branch --copy --force a b"],
  // 6. gh inside a loop body fed by <(...) is still a loop
  ["loop", "while read -r n; do gh pr view $n; done < <(gh pr list --json number --limit 50)"],
  // 7. git clean with force stays denied
  ["git-discard", "git clean -fx"],
  // sweep: other parents that run a nested command
  ["rm-recursive", "git bisect run sh -c 'rm -rf src'"],
  ["git-discard", "git submodule foreach 'git reset --hard'"],
  ["rm-recursive", "git submodule foreach --recursive 'rm -rf build'"],
  ["git-history-rewrite", "git filter-branch --tree-filter 'rm -rf x' HEAD"],
  ["rm-recursive", "git filter-branch --tree-filter 'rm -rf x' HEAD"],
  ["rm-recursive", "ls | xargs -I{} sh -c 'rm -rf {}'"],
  ["rm-recursive", "watch -n 5 'rm -rf x'"],
  ["loop", "watch -n 30 gh pr checks 5"],
  ["rm-recursive", "ls *.ts | entr rm -rf dist"],
  ["rm-recursive", "ls *.ts | entr -s 'rm -rf dist'"],
  ["rm-recursive", "nodemon --exec 'rm -rf dist' src/index.ts"],
  ["rm-recursive", `parallel ::: "rm -rf a" "rm -rf b"`],
  ["rm-recursive", "parallel 'rm -rf {}' ::: a b"],
  ["rm-recursive", "git -c core.editor='rm -rf src' commit"],
  ["rm-recursive", "git -c alias.x='!rm -rf src' x"],
  ["git-discard", "git -c alias.nuke='reset --hard' nuke"],
  ["rm-recursive", "git config alias.x '!rm -rf src'"],
  ["rm-recursive", "GIT_EDITOR='rm -rf src' git commit"],
  ["rm-recursive", "export GIT_SEQUENCE_EDITOR='rm -rf src'"],
  ["git-config-global", "git -c core.hooksPath=/tmp/h commit"],
  ["rm-recursive", "git difftool -x 'rm -rf src'"],
  ["rm-recursive", "env -S 'rm -rf x'"],
  ["rm-recursive", "nice -n 10 rm -rf x"],
  ["rm-recursive", "caffeinate -i rm -rf x"],
  ["rm-recursive", "time rm -rf x"],
  ["rm-recursive", "nohup rm -rf x &"],
  ["rm-recursive", "timeout 5 rm -rf x"],
  ["find-delete", "fd -e log -x rm {}"],
  // hardening found while fixing the above
  ["git-rebase-exec", "git rebase -kx 'rm -rf src' main"],
  ["git-rebase-exec", "git rebase '-xrm -rf src' main"],
  ["rm-recursive", "git rebase -kx 'rm -rf src' main"],
  ["script-delete", `python3 -c'import shutil; shutil.rmtree("x")'`],
  ["script-delete", `python3 -Bc "import os; os.system('rm -rf x')"`],
  ["script-delete", `echo "import shutil; shutil.rmtree('x')" | python3`],
  ["script-delete", `python3 <<< "import shutil; shutil.rmtree('x')"`],
  ["script-delete", `perl -e 'system("rm -rf x")'`],
  ["script-delete", `node --eval="require('child_process').execSync('rm -r x')"`],
  ["script-delete", `ts-node -e "require('fs').rmSync('x', {recursive: true})"`],
  ["script-delete", `deno eval "await Deno.remove('x', { recursive: true })"`],
  ["rm-recursive", "yarn dlx rimraf dist"],
  ["rm-recursive", "uv tool run --from x rm -rf dist"],
  ["find-delete", "find . -name '*.tmp' -exec unlink {} \\;"],
  ["loop", "find . -name '*.json' -exec gh api repos/o/r/contents/{} \\;"],
  ["loop", "git submodule foreach 'gh pr list --limit 5'"],
  ["loop", 'while [ "$(gh pr checks 5 --json state -q .[0].state)" != SUCCESS ]; do sleep 30; done'],
  ["nesting-too-deep", "eval ".repeat(12) + "ls"],
];

const NESTED_ALLOW: string[] = [
  // 4. runners with harmless tools
  "npx tsc --noEmit",
  "uv run pytest",
  "bunx prettier --check .",
  "npm exec -- eslint .",
  "pnpm dlx create-vite app",
  "tsx scripts/build.ts",
  // 6. <(...) after `done` runs once, not per iteration
  "while read -r n; do echo $n; done < <(gh pr list --json number --limit 50)",
  // 7. dry runs, even with x/X/d
  "git clean -n -x",
  "git clean -ndX",
  "git clean -nx",
  "git clean --dry-run -x",
  "git clean -xn",
  "git clean -Xdn",
  // 8. only code-carrying arguments are inspected
  "bun add -d rimraf",
  "python3 -m pytest -k rmtree",
  'node scripts/check.js --pattern "rm -rf"',
  // 5. rename/copy without force
  "git branch -m old new",
  "git branch --move old new",
  "git branch -c old copy",
  // sweep near misses
  "git bisect run npm test",
  "git submodule foreach git pull",
  "watch -n 5 ls",
  "nodemon --exec 'npm test' src/index.ts",
  "parallel echo ::: a b",
  "git -c core.editor=true commit --amend",
  "GIT_EDITOR=true git rebase --continue",
  "EDITOR=vim git commit",
  "git config alias.st status",
  "caffeinate -i npm test",
  "ls | entr -r npm test",
  "fd -e ts -x wc -l",
  // hardening near misses
  "git rebase -Xours main",
  "git rebase -Xtheirs main",
  "git rebase -Xignore-space-change -sx main",
  "git rebase --onto main feature~3 feature",
  "python3 scripts/clean.py --rm -r",
  "node -e \"console.log(1)\"",
  "echo 'shutil.rmtree is bad' | wc -l",
  "for p in $(gh pr list --json number --limit 20 -q '.[].number'); do echo $p; done",
  "PAGER=cat git log -1",
];

describe("nested commands", () => {
  it.each(NESTED_DENY)("denies (%s): %s", (id, cmd) => {
    expect(classifyCommand(cmd)).toContain(id);
    const reason = reasonFor(cmd);
    expect(reason).toMatch(/^\[(guarded|gh-budget|secrets)\] /);
  });

  it.each(NESTED_ALLOW)("allows: %s", (cmd) => {
    expect(classifyCommand(cmd)).toEqual([]);
    expect(checkCommand(bash(cmd))).toBeNull();
  });

  it("names the whole top-level command in the User action line", () => {
    const reason = reasonFor("git rebase -x 'rm -rf src' HEAD~3");
    expect(reason).toContain("'User action: run `git rebase -x 'rm -rf src' HEAD~3` because <why>'");
  });
});

describe("command-lexer", () => {
  it("splits on separators outside quotes only", () => {
    const segs = parseCommand(`echo "a; b" && ls 'c|d' | wc -l; git status`);
    expect(segs.map((s: { argv: string[] }) => s.argv)).toEqual([
      ["echo", "a; b"], ["ls", "c|d"], ["wc", "-l"], ["git", "status"],
    ]);
    expect(segs[1].pipeline).toBe(segs[2].pipeline);
    expect(segs[0].pipeline).not.toBe(segs[1].pipeline);
  });

  it("tracks loop nesting, including loops opened after do/then", () => {
    const segs = parseCommand("for a in x; do for b in y; do echo $b; done; ls; done; pwd");
    const inLoop = Object.fromEntries(
      segs.filter((s: { argv: string[] }) => s.argv.length)
        .map((s: { argv: string[]; inLoop: boolean }) => [s.argv[0], s.inLoop]),
    );
    expect(inLoop).toEqual({ echo: true, ls: true, pwd: false });
  });

  it("parses substitutions, sh -c and eval as nested commands", () => {
    const heads = (c: string) => parseCommand(c).map((s: { argv: string[] }) => s.argv[0]);
    expect(heads("echo $(date) `whoami`")).toEqual(expect.arrayContaining(["echo", "date", "whoami"]));
    expect(heads("bash -lc 'cd x && make'")).toEqual(expect.arrayContaining(["bash", "cd", "make"]));
    expect(heads("eval 'git status'")).toEqual(expect.arrayContaining(["eval", "git"]));
  });

  it("strips wrappers and assignments and records fan-out wrappers", () => {
    const [seg] = parseCommand("FOO=1 env BAR=2 nohup timeout 5 /usr/bin/node x.js");
    expect(seg.argv).toEqual(["node", "x.js"]);
    const [, x] = parseCommand("ls | xargs -I{} -P 4 rm {}");
    expect(x.argv).toEqual(["rm", "{}"]);
    expect(x.wrappers).toContain("xargs");
    expect(parseCommand("command -v rm")[0].argv).toEqual([]);
  });

  it("attaches heredoc bodies to their command, or parses them when fed to a shell", () => {
    const [py] = parseCommand("python3 - <<'EOF'\nprint(1)\nEOF\necho after");
    expect(py.heredoc).toBe("print(1)\n");
    const heads = parseCommand("bash <<EOF\nrm -rf x\nEOF").map((s: { argv: string[] }) => s.argv[0]);
    expect(heads).toContain("rm");
    const cat = parseCommand("cat <<'EOF' > f\nrm -rf x\nEOF").map((s: { argv: string[] }) => s.argv[0]);
    expect(cat).toEqual(["cat"]);
  });

  it("links nested commands to the command that runs them", () => {
    const segs = parseCommand("find . -exec env rm -rf {} + ; git rebase -x 'make test' main");
    const rm = segs.find((s: { argv: string[] }) => s.argv[0] === "rm");
    expect(rm.argv).toEqual(["rm", "-rf", "{}"]);
    expect(rm.parent.argv[0]).toBe("find");
    expect(rm.wrappers).toContain("per-item");
    const make = segs.find((s: { argv: string[] }) => s.argv[0] === "make");
    expect(make.parent.argv.slice(0, 2)).toEqual(["git", "rebase"]);
    expect(segs.find((s: { argv: string[] }) => s.argv[0] === "find").parent).toBeNull();
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

  it.each([
    ["gh-budget", REAL_WORLD],
    ["secrets", "cat ~/.npmrc"],
    ["guarded", "rm -rf build"],
  ])("prints the PreToolUse deny JSON for a [%s] command", (family, cmd) => {
    const r = runPreBash(bash(cmd));
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason.startsWith(`[${family}] `)).toBe(true);
  });

  it.each(["gh pr view 5 --json title", "rm file.txt", "git branch -d feat"])(
    "prints nothing for an allowed command: %s",
    (cmd) => {
      const r = runPreBash(bash(cmd));
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("");
    },
  );
});
