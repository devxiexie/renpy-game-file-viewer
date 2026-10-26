import type { Writer } from "./writer";
import { asArray, attr, className, lineOf, pyCodeSource, quoteString, str } from "./util";

/**
 * Best-effort decompiler for `testcase` blocks (renpy.test.testast). Test cases are
 * developer tooling and rarely ship in games, so unknown nodes become comments.
 */
export function writeTestcase(w: Writer, test: unknown): void {
  const kind = className(test);
  if (kind === "Block" || kind === "TestCase" || kind === "TestSuite") {
    const block = asArray(attr(test, "block", attr(test, "children", [])));
    if (block.length === 0) w.write("pass");
    for (const node of block) writeTestNode(w, node);
    return;
  }
  writeTestNode(w, test);
}

function pattern(node: unknown): string {
  const p = attr<unknown>(node, "pattern", null);
  return p === null || p === undefined ? "" : quoteString(str(p));
}

function testExpr(node: unknown): string {
  switch (className(node)) {
    case "Click": {
      const parts = ["click"];
      const p = pattern(node);
      if (p) parts.push(p);
      const button = attr<unknown>(node, "button", 1);
      if (button !== 1 && button !== null) parts.push("button", str(button));
      const pos = attr<unknown>(node, "position", null);
      if (pos) parts.push("pos", str(pos));
      if (attr(node, "always", false)) parts.push("always");
      return parts.join(" ");
    }
    case "Type": {
      const keys = asArray(attr(node, "keys", []));
      const text = keys.every((k) => typeof k === "string" && k.length === 1) ? quoteString(keys.join("")) : keys.map(str).join(" ");
      const p = pattern(node);
      return `type ${text}${p ? ` pattern ${p}` : ""}`;
    }
    case "Drag":
      return `drag ${str(attr(node, "points"))}${pattern(node) ? ` pattern ${pattern(node)}` : ""}`;
    case "Move":
      return `move ${str(attr(node, "position"))}${pattern(node) ? ` pattern ${pattern(node)}` : ""}`;
    case "Scroll":
      return `scroll ${pattern(node)}`;
    case "Pause":
      return `pause ${str(attr(node, "expr"))}`;
    case "Label":
      return `label ${str(attr(node, "name"))}`;
    case "Action":
      return `run ${str(attr(node, "expr"))}`;
    case "Assert":
      return `assert ${str(attr(node, "expr"))}`;
    case "Eval":
      return `eval ${str(attr(node, "expr"))}`;
    case "Advance":
      return "advance";
    case "Skip":
      return "skip";
    case "Exit":
      return "exit";
    case "Until":
      return `${testExpr(attr(node, "left"))} until ${testExpr(attr(node, "right"))}`;
    default:
      return `# test: ${className(node)}`;
  }
}

function writeTestNode(w: Writer, node: unknown): void {
  w.advanceTo(lineOf(node));
  switch (className(node)) {
    case "Python": {
      const src = pyCodeSource(attr(node, "code")).trim();
      if (!src.includes("\n")) w.write(`$ ${src}`);
      else {
        w.write("python:");
        w.indent(() => w.writeBlock(src));
      }
      return;
    }
    case "If":
      w.write(`if ${testExpr(attr(node, "condition"))}:`);
      w.indent(() => writeTestcase(w, attr(node, "block")));
      return;
    case "Call":
      w.write(`call ${str(attr(node, "target"))}`);
      return;
    case "Jump":
      w.write(`jump ${str(attr(node, "target"))}`);
      return;
    default:
      w.write(testExpr(node));
  }
}
