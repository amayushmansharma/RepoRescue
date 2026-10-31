/**
 * Beginner-friendly explanations for RepoRescue findings.
 *
 * Mapped statically by ruleId to provide newcomers with clear, jargon-free context:
 * - What the problem means
 * - Why it matters / what it could affect
 *
 * Unknown ruleIds gracefully return null so unmapped findings render normally.
 */

export const FINDING_SIMPLE_EXPLANATIONS = {
  "readme-missing": {
    meaning: "There is no welcome document or homepage to explain what this project is or how to use it.",
    whyItMatters: "Without a README, people arriving at the repository have to guess what the project does and how to get started.",
  },
  "readme-install-missing": {
    meaning: "The documentation doesn't tell you the exact commands to download and install this project's dependencies.",
    whyItMatters: "Newcomers cannot set up a local workspace to try the code or make improvements.",
  },
  "readme-prerequisites-missing": {
    meaning: "The project doesn't clearly explain which tools, runtimes, or software versions someone needs before running it.",
    whyItMatters: "You might spend hours debugging errors caused simply by having the wrong version of Node, Python, or a database.",
  },
  "readme-usage-missing": {
    meaning: "The documentation explains installation but doesn't tell you how to actually launch, run, or use the project.",
    whyItMatters: "Contributors can't easily see the effects of their code changes or test their own work.",
  },
  "manifest-missing": {
    meaning: "The project is missing the standard file that lists its packages and building tools.",
    whyItMatters: "Package managers cannot automatically install dependencies or build the project.",
  },
  "lockfile-missing": {
    meaning: "The exact versions of downloaded packages were not frozen and saved in the repository.",
    whyItMatters: "Different people installing the project might get different package versions, causing mysterious bugs that work on one computer but break on another.",
  },
  "env-template-missing": {
    meaning: "The code needs configuration settings (like database URLs or API keys) to run, but there is no template showing what settings are required.",
    whyItMatters: "The application will likely crash on startup, and new contributors won't know which settings or dummy values to provide.",
  },
  "env-template-incomplete": {
    meaning: "An environment template file exists, but it leaves out some settings that the code actually looks for.",
    whyItMatters: "Contributors can fill out the template completely and still experience unexpected crashes because hidden variables are missing.",
  },
  "tests-missing": {
    meaning: "There are no automated checks or tests to verify that the code behaves correctly.",
    whyItMatters: "Any small change could accidentally break existing features without anyone noticing until users report it.",
  },
  "test-command-undocumented": {
    meaning: "The project has automated tests, but the documentation doesn't tell you what command runs them.",
    whyItMatters: "Contributors don't know how to run tests before submitting their pull requests.",
  },
  "ci-missing": {
    meaning: "The project doesn't appear to have an automated process for checking proposed code changes.",
    whyItMatters: "Maintainers must manually download and test every submission on their own computers, slowing down reviews.",
  },
  "ci-tests-missing": {
    meaning: "An automated workflow exists, but it doesn't actually run the test suite.",
    whyItMatters: "Pull requests might show a green checkmark even if the code changes broke the tests.",
  },
  "contributing-missing": {
    meaning: "This project doesn't have a guide explaining how new people can contribute.",
    whyItMatters: "New contributors won't know how to get started, propose changes, or follow the repository's guidelines.",
  },
  "code-of-conduct-missing": {
    meaning: "The project doesn't have a written code outlining standards for respectful behavior in the community.",
    whyItMatters: "Newcomers may hesitate to participate without clear guidelines on community expectations and conflict resolution.",
  },
  "templates-missing": {
    meaning: "There are no standard forms for submitting bug reports or proposing code changes.",
    whyItMatters: "Reports and pull requests arrive missing essential details, leading to slow back-and-forth communication.",
  },
  "contribution-workflow-undocumented": {
    meaning: "The contribution guide exists but misses specific setup or testing commands.",
    whyItMatters: "Contributors have to guess which commands to run before asking maintainers to review their work.",
  },
  "license-missing": {
    meaning: "There is no legal license file stating who is allowed to use, modify, or share this code.",
    whyItMatters: "By default, copyright laws treat unlicensed code as 'all rights reserved', meaning others cannot legally use or contribute to it.",
  },
  "manifest-license-missing": {
    meaning: "The project's package file doesn't specify its license name.",
    whyItMatters: "Automated package registries and tools cannot detect that the code is free to use.",
  },
  "gitignore-missing": {
    meaning: "There is no file telling Git which temporary or private files should be ignored.",
    whyItMatters: "Contributors might accidentally commit large build folders, private secrets, or operating system junk files.",
  },
  "metadata-incomplete": {
    meaning: "The repository is missing a short summary description or topic tags in its GitHub settings.",
    whyItMatters: "People searching GitHub won't easily discover the repository or understand what it does at a glance.",
  },
  "committed-env-file": {
    meaning: "A private settings file (like .env) was accidentally uploaded to the public repository.",
    whyItMatters: "Private passwords, database credentials, or secret API keys might be exposed to anyone on the internet.",
  },
};

/**
 * Returns a beginner-friendly explanation for a given ruleId, or null if unknown.
 * @param {string} [ruleId]
 * @returns {{ meaning: string, whyItMatters: string } | null}
 */
export function getSimpleExplanation(ruleId) {
  if (!ruleId || typeof ruleId !== "string") return null;
  return FINDING_SIMPLE_EXPLANATIONS[ruleId] ?? null;
}
