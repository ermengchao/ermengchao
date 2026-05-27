#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outputDir = resolve(root, "assets/profile");

const cards = [
  { name: "preface", desktopColumn: "left", mobileOrder: 1 },
  { name: "about-me", desktopColumn: "right", mobileOrder: 2 },
  { name: "preference", desktopColumn: "left", mobileOrder: 3 },
  { name: "about-my-github", desktopColumn: "right", mobileOrder: 4 },
];

const themes = {
  light: "#ffffff",
  dark: "#0e1116",
};
const shadowThemes = {
  light: { opacity: 0.32 },
  dark: { opacity: 0.48 },
};
const transparentInsetPx = 60;

mkdirSync(outputDir, { recursive: true });

for (const theme of Object.keys(themes)) {
  const cardImages = Object.fromEntries(
    cards.map((card) => [card.name, readCardImage(card.name, theme)]),
  );

  const desktop = buildDesktopSvg(theme, cardImages);
  const desktopPath = resolve(outputDir, `${theme}.svg`);
  writeFileSync(desktopPath, desktop);
  console.log(`Rendered ${desktopPath}`);

  const mobile = buildMobileSvg(theme, cardImages);
  const mobilePath = resolve(outputDir, `${theme}-mobile.svg`);
  writeFileSync(mobilePath, mobile);
  console.log(`Rendered ${mobilePath}`);
}

function buildDesktopSvg(theme, cardImages) {
  const width = 1276;
  const contentWidth = 1180;
  const paddingX = 48;
  const paddingY = 72;
  const columnGap = 14;
  const rowGap = 22;
  const leftWidth = ((contentWidth - columnGap) * 1.04) / 2.04;
  const rightWidth = contentWidth - columnGap - leftWidth;

  const prefaceHeight = displayHeight(cardImages["preface"], leftWidth);
  const preferenceHeight = displayHeight(cardImages["preference"], leftWidth);
  const aboutMeHeight = displayHeight(cardImages["about-me"], rightWidth);
  const aboutGithubHeight = displayHeight(cardImages["about-my-github"], rightWidth);
  const leftHeight = prefaceHeight + rowGap + preferenceHeight;
  const rightHeight = aboutMeHeight + rowGap + aboutGithubHeight;
  const gridHeight = Math.max(leftHeight, rightHeight);
  const height = gridHeight + paddingY * 2;
  const leftX = paddingX;
  const rightX = paddingX + leftWidth + columnGap;

  const items = [
    imageElement(cardImages["preface"], leftX, paddingY, leftWidth, prefaceHeight),
    imageElement(cardImages["preference"], leftX, paddingY + gridHeight - preferenceHeight, leftWidth, preferenceHeight),
    imageElement(cardImages["about-me"], rightX, paddingY, rightWidth, aboutMeHeight),
    imageElement(cardImages["about-my-github"], rightX, paddingY + gridHeight - aboutGithubHeight, rightWidth, aboutGithubHeight),
  ];

  return svgDocument(width, height, themes[theme], items, shadowThemes[theme].opacity);
}

function buildMobileSvg(theme, cardImages) {
  const width = 560;
  const paddingY = 20;
  let y = paddingY;
  const items = [];

  for (const card of [...cards].sort((a, b) => a.mobileOrder - b.mobileOrder)) {
    const image = cardImages[card.name];
    const height = displayHeight(image, width);
    items.push(imageElement(image, 0, y, width, height));
    y += height;
  }

  return svgDocument(width, y + paddingY, themes[theme], items, shadowThemes[theme].opacity);
}

function readCardImage(name, theme) {
  const path = resolve(root, `assets/${name}/${theme}.svg`);
  const svg = readFileSync(path, "utf8");
  const match = svg.match(/<image[^>]+href="data:image\/png;base64,([^"]+)"/);

  if (!match) {
    throw new Error(`Could not find embedded PNG image in ${path}`);
  }

  const base64 = match[1];
  const dimensions = readPngDimensions(Buffer.from(base64, "base64"));

  return {
    href: `data:image/png;base64,${base64}`,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function readPngDimensions(buffer) {
  const pngSignature = "89504e470d0a1a0a";

  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error("Embedded image is not a PNG.");
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function displayHeight(image, displayWidth) {
  return (displayWidth * image.height) / image.width;
}

function imageElement(image, x, y, width, height) {
  const inset = (transparentInsetPx / image.width) * width;
  const shadowX = x + inset;
  const shadowY = y + inset;
  const shadowWidth = width - inset * 2;
  const shadowHeight = height - inset * 2;

  return [
    `<rect x="${round(shadowX)}" y="${round(shadowY)}"`,
    `  width="${round(shadowWidth)}" height="${round(shadowHeight)}"`,
    `  rx="16" ry="16"`,
    `  fill="#000000" filter="url(#cardShadow)" />`,
    `<image href="${image.href}"`,
    `  x="${round(x)}" y="${round(y)}"`,
    `  width="${round(width)}" height="${round(height)}"`,
    `  preserveAspectRatio="xMinYMin meet" />`,
  ].join("\n");
}

function svgDocument(width, height, background, items, shadowOpacity = 0.32) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}">`,
    "<defs>",
    '  <filter id="cardShadow" x="-35%" y="-30%" width="170%" height="190%">',
    `    <feGaussianBlur in="SourceAlpha" stdDeviation="16" result="blur" />`,
    `    <feOffset in="blur" dx="0" dy="18" result="offsetBlur" />`,
    `    <feFlood flood-color="#000000" flood-opacity="${shadowOpacity}" result="shadowColor" />`,
    `    <feComposite in="shadowColor" in2="offsetBlur" operator="in" result="shadow" />`,
    `    <feMerge><feMergeNode in="shadow" /></feMerge>`,
    "  </filter>",
    "</defs>",
    `<rect width="100%" height="100%" fill="${background}" />`,
    ...items,
    "</svg>",
    "",
  ].join("\n");
}

function round(value) {
  return Number(value.toFixed(3));
}
