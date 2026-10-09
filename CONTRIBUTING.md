# Contributing

Thanks for helping. The most useful thing is telling us which school you use and whether sign-in worked.

1. Run `npx brightspace-d2l-mcp@latest doctor` and paste the output into your issue.
2. For code changes, fork the repo, then run `npm install`, `npm run build` and `npm test`. All tests should pass.
3. Keep tools read-only. Anything that submits, edits or deletes in Brightspace will not be merged.
4. Open a pull request with a short description of what changed and why.

Adding sign-in support for a new school lives in `src/cli/school.ts` and `src/auth/`.
