import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceDirectory = path.join(process.cwd(), "src");
const tokenPath = path.join(sourceDirectory, "styles", "tokens.css");
const tokenCss = readFileSync(tokenPath, "utf8");
const declarationPattern = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;

function collectCssFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const entryPath = path.join(directory, entry);

    if (statSync(entryPath).isDirectory()) {
      return collectCssFiles(entryPath);
    }

    return entryPath.endsWith(".css") ? [entryPath] : [];
  });
}

function readDeclarations(css: string): Array<[string, string]> {
  const declarations: Array<[string, string]> = [];

  for (const match of css.matchAll(declarationPattern)) {
    const name = match[1];
    const value = match[2];

    if (!name || !value) {
      throw new Error("Encountered an invalid custom-property declaration");
    }

    declarations.push([name, value.trim()]);
  }

  return declarations;
}

function readTokenMap(): Map<string, string> {
  return new Map(readDeclarations(tokenCss));
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);

  if (!match) {
    throw new Error(`Expected a six-digit hex color, received ${hex}`);
  }

  const value = match[1];

  if (!value) {
    throw new Error(`Expected a color value, received ${hex}`);
  }

  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function relativeLuminance(hex: string): number {
  const convertChannel = (channel: number) => {
    const normalized = channel / 255;

    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const [red, green, blue] = hexToRgb(hex);

  return (
    0.2126 * convertChannel(red) +
    0.7152 * convertChannel(green) +
    0.0722 * convertChannel(blue)
  );
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

describe("Pulse AI design tokens", () => {
  it("defines every required semantic state", () => {
    const tokens = readTokenMap();
    const states = [
      "success",
      "warning",
      "error",
      "info",
      "pending",
      "approved",
      "rejected",
      "anomaly",
      "disabled",
    ];

    for (const state of states) {
      expect(tokens.has(`--color-${state}`)).toBe(true);
      expect(tokens.has(`--color-${state}-soft`)).toBe(true);
      expect(tokens.has(`--color-${state}-border`)).toBe(true);
    }
  });

  it("includes the required foundation token groups", () => {
    const tokens = readTokenMap();
    const requiredTokens = [
      "--color-primary",
      "--color-secondary",
      "--color-canvas",
      "--color-surface",
      "--color-text-primary",
      "--color-border",
      "--color-focus",
      "--font-family-sans",
      "--font-family-mono",
      "--font-size-body-md",
      "--spacing-md",
      "--radius-md",
      "--elevation-raised",
      "--layout-sidebar-width",
      "--layout-content-max-width",
      "--breakpoint-tablet",
      "--breakpoint-desktop",
      "--breakpoint-large-desktop",
      "--motion-duration-fast",
      "--motion-easing-standard",
      "--focus-ring-width",
      "--focus-ring-offset",
    ];

    for (const token of requiredTokens) {
      expect(tokens.has(token), `${token} should be defined`).toBe(true);
    }
  });

  it("declares each token exactly once and only in tokens.css", () => {
    const declarations = collectCssFiles(sourceDirectory).flatMap((file) =>
      readDeclarations(readFileSync(file, "utf8")).map(([name]) => ({
        file,
        name,
      })),
    );
    const declarationsByName = Map.groupBy(
      declarations,
      (declaration) => declaration.name,
    );

    for (const [name, matches] of declarationsByName) {
      expect(
        matches,
        `${name} should have one authoritative declaration`,
      ).toHaveLength(1);
      expect(matches[0]?.file).toBe(tokenPath);
    }
  });

  it("keeps raw color values out of consumer stylesheets", () => {
    const rawColorPattern =
      /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|lab|lch)\s*\(/gi;

    for (const file of collectCssFiles(sourceDirectory)) {
      if (file === tokenPath) {
        continue;
      }

      expect(
        readFileSync(file, "utf8").match(rawColorPattern),
        `${path.relative(process.cwd(), file)} should consume color tokens`,
      ).toBeNull();
    }
  });

  it("resolves every custom property consumed by application CSS", () => {
    const tokens = readTokenMap();
    const referencePattern = /var\(\s*(--[a-z0-9-]+)/gi;

    for (const file of collectCssFiles(sourceDirectory)) {
      for (const match of readFileSync(file, "utf8").matchAll(
        referencePattern,
      )) {
        const token = match[1];
        expect(
          token ? tokens.has(token) : false,
          `${path.relative(process.cwd(), file)} references undefined ${token ?? "token"}`,
        ).toBe(true);
      }
    }
  });

  it("keeps normal text and semantic foregrounds at AA contrast", () => {
    const tokens = readTokenMap();
    const pairs: Array<[string, string]> = [
      ["--color-text-primary", "--color-canvas"],
      ["--color-text-secondary", "--color-surface"],
      ["--color-text-tertiary", "--color-surface"],
      ["--color-primary", "--color-primary-soft"],
      ["--color-secondary", "--color-secondary-soft"],
      ["--color-success", "--color-success-soft"],
      ["--color-warning", "--color-warning-soft"],
      ["--color-error", "--color-error-soft"],
      ["--color-info", "--color-info-soft"],
      ["--color-pending", "--color-pending-soft"],
      ["--color-approved", "--color-approved-soft"],
      ["--color-rejected", "--color-rejected-soft"],
      ["--color-anomaly", "--color-anomaly-soft"],
    ];

    for (const [foregroundToken, backgroundToken] of pairs) {
      const foreground = tokens.get(foregroundToken);
      const background = tokens.get(backgroundToken);

      expect(foreground).toBeDefined();
      expect(background).toBeDefined();
      expect(
        contrastRatio(foreground ?? "", background ?? ""),
        `${foregroundToken} on ${backgroundToken} should meet 4.5:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the focus indicator distinguishable from light surfaces", () => {
    const tokens = readTokenMap();
    const focus = tokens.get("--color-focus") ?? "";

    for (const surfaceToken of ["--color-surface", "--color-canvas"]) {
      expect(
        contrastRatio(focus, tokens.get(surfaceToken) ?? ""),
        `--color-focus on ${surfaceToken} should meet 3:1`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
