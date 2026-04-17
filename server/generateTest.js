const PREFIXES = [
  "neon",
  "pixel",
  "glitch",
  "nova",
  "arcade",
  "lunar",
  "echo",
  "cyber",
  "hyper",
  "retro",
];

const ROOTS = [
  "moth",
  "otter",
  "ghost",
  "wizard",
  "sprite",
  "fox",
  "byte",
  "kitty",
  "drifter",
  "raccoon",
];

const SUFFIXES = ["tv", "gg", "live", "x", "jr", "plays"];
const ACTION_TYPES = ["restore", "eliminate"];

function pick(list, random = Math.random) {
  return list[Math.floor(random() * list.length)];
}

function maybe(random = Math.random, threshold = 0.5) {
  return random() < threshold;
}

function randomViewerName(random = Math.random) {
  const prefix = pick(PREFIXES, random);
  const root = pick(ROOTS, random);
  const addNumber = maybe(random, 0.65);
  const addSuffix = maybe(random, 0.35);
  const number = addNumber ? String(10 + Math.floor(random() * 990)) : "";
  const suffix = addSuffix ? pick(SUFFIXES, random) : "";
  return `${prefix}${root}${number}${suffix}`;
}

function randomTestRedeem(random = Math.random) {
  return {
    source: "test",
    viewerName: randomViewerName(random),
    actionType: pick(ACTION_TYPES, random),
    userInput: "",
    sourceMetadata: {
      generated: true,
    },
  };
}

module.exports = {
  randomTestRedeem,
  randomViewerName,
};
