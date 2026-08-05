import { existsSync } from 'node:fs';
import type { LaunchOptions } from 'puppeteer';

const chromePaths = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean) as string[];

export async function launchPdfBrowser() {
  const { default: puppeteer } = await import('puppeteer');
  const executablePath = chromePaths.find((path) => existsSync(path));
  const options: LaunchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };

  if (executablePath) {
    options.executablePath = executablePath;
  }

  return puppeteer.launch(options);
}
