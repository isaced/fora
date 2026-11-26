/** ANSI helpers that degrade to plain text when colour is unavailable. */

const enabled =
  Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== "dumb";

function paint(code: number, close: number): (text: string) => string {
  return (text: string) => (enabled ? `\u001b[${code}m${text}\u001b[${close}m` : text);
}

export const color = {
  bold: paint(1, 22),
  dim: paint(2, 22),
  red: paint(31, 39),
  green: paint(32, 39),
  yellow: paint(33, 39),
  blue: paint(34, 39),
  magenta: paint(35, 39),
  cyan: paint(36, 39),
  gray: paint(90, 39),
};

export const colorEnabled = enabled;
