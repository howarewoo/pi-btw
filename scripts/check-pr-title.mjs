import { parseSubject } from "./conventional-commits.mjs";

if (!parseSubject(process.env.PR_TITLE ?? "")) {
  console.error(
    "PR title must use type(optional-scope)!: description. Types: feat, fix, perf, refactor, docs, test, build, ci, chore, revert, style.",
  );
  process.exitCode = 1;
} else {
  console.log(
    "Conventional PR title verified; maintainers must also confirm the final squash commit title.",
  );
}
