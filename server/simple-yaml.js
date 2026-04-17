function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return "";
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (!Number.isNaN(Number(trimmed)) && trimmed !== "") {
    return Number(trimmed);
  }
  return trimmed;
}

function parseYaml(source) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = source.replace(/\t/g, "  ").split(/\r?\n/);

  for (const rawLine of lines) {
    const withoutComment = rawLine.replace(/\s+#.*$/, "");
    if (!withoutComment.trim()) {
      continue;
    }
    const indent = withoutComment.match(/^ */)[0].length;
    const content = withoutComment.trim();
    const separatorIndex = content.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const key = content.slice(0, separatorIndex).trim();
    const rawValue = content.slice(separatorIndex + 1);

    while (stack.length > 1 && indent <= stack.at(-1).indent) {
      stack.pop();
    }

    const parent = stack.at(-1).value;
    if (rawValue.trim() === "") {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
      continue;
    }
    parent[key] = parseScalar(rawValue);
  }

  return root;
}

module.exports = {
  parseYaml,
};
