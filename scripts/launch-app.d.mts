import type { Page } from "playwright";

export declare const projectRoot: string;
export declare const builtExecutable: string;

export declare function launchApp(options?: { prefix?: string }): Promise<{
  page: Page;
  dataDirectory: string;
  close(): Promise<void>;
}>;
