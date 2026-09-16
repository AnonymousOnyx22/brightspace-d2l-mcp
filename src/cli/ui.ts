import * as readline from "node:readline/promises";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const bold = paint("1");
export const dim = paint("2");
export const green = paint("32");
export const yellow = paint("33");
export const red = paint("31");
export const cyan = paint("36");

export const ok = (text: string) => console.log(`  ${green("✔")} ${text}`);
export const warn = (text: string) => console.log(`  ${yellow("!")} ${text}`);
export const fail = (text: string) => console.log(`  ${red("✖")} ${text}`);
export const info = (text: string) => console.log(`  ${text}`);
export const step = (n: number, total: number, title: string) => console.log(`\n${bold(cyan(`Step ${n}/${total}`))}  ${bold(title)}`);

export let interactive = process.stdin.isTTY === true;
export function setNonInteractive(): void {
  interactive = false;
}

export async function ask(question: string, fallback = ""): Promise<string> {
  if (!interactive) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`  ${question} `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  if (!interactive) return defaultYes;
  const answer = (await ask(`${question} ${dim(defaultYes ? "(Y/n)" : "(y/N)")}`)).toLowerCase();
  if (!answer) return defaultYes;
  return answer.startsWith("y");
}
