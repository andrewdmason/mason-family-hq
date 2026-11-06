/**
 * The graph visual's `functions[].expr` ("2*x+1", "sqrt(x)", "-x^2+3"),
 * compiled to a plain function of x without eval: the model writes these, so
 * they're parsed against a fixed grammar and anything outside it is rejected.
 *
 *   expr   := term (("+" | "-") term)*
 *   term   := unary (("*" | "/") unary | implicit)*      implicit: "2x", "3(x+1)", "2sqrt(x)"
 *   unary  := ("-" | "+") unary | power
 *   power  := atom ("^" unary)?                           right-associative; -x^2 = -(x^2)
 *   atom   := number | "x" | "pi" | "e" | fn "(" expr ")" | "(" expr ")"
 *
 * `**` is accepted as `^`. Returns null for anything that doesn't parse.
 */

type Node =
  | { k: "num"; v: number }
  | { k: "x" }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { k: "fn"; f: (n: number) => number; a: Node };

const FUNCTIONS: Record<string, (n: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  // School math's "log" is base 10; "ln" is the natural log.
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) return null;
      tokens.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-zA-Zπ]/.test(c)) {
      const m = /^([a-zA-Z]+|π)/.exec(src.slice(i))!;
      tokens.push({ t: "id", v: m[0] === "π" ? "pi" : m[0].toLowerCase() });
      i += m[0].length;
    } else if (src.startsWith("**", i)) {
      tokens.push({ t: "op", v: "^" });
      i += 2;
    } else if ("+-*/^()".includes(c)) {
      tokens.push({ t: "op", v: c });
      i++;
    } else if (c === "−") {
      tokens.push({ t: "op", v: "-" });
      i++;
    } else {
      return null;
    }
  }
  return tokens;
}

/** Split runs like "xsin" or "pix" into known names, so "2pix" still reads. */
function splitIdentifier(id: string): string[] | null {
  const out: string[] = [];
  let rest = id;
  const names = ["sqrt", "abs", "sin", "cos", "tan", "log", "exp", "ln", "pi", "x", "e"];
  while (rest) {
    const name = names.find((n) => rest.startsWith(n));
    if (!name) return null;
    out.push(name);
    rest = rest.slice(name.length);
  }
  return out;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  parse(): Node | null {
    const node = this.expr();
    return this.pos === this.tokens.length ? node : null;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return t?.t === "op" && t.v === v;
  }

  private expr(): Node {
    let node = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.tokens[this.pos++] as { v: "+" | "-" }).v;
      node = { k: "bin", op, a: node, b: this.term() };
    }
    return node;
  }

  private term(): Node {
    let node = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/")) {
        const op = (this.tokens[this.pos++] as { v: "*" | "/" }).v;
        node = { k: "bin", op, a: node, b: this.unary() };
      } else if (this.startsAtom()) {
        // Implicit multiplication: "2x", "3(x+1)", "x sqrt(x)".
        node = { k: "bin", op: "*", a: node, b: this.power() };
      } else {
        return node;
      }
    }
  }

  private startsAtom(): boolean {
    const t = this.peek();
    return !!t && (t.t === "num" || t.t === "id" || (t.t === "op" && t.v === "("));
  }

  private unary(): Node {
    if (this.isOp("-")) {
      this.pos++;
      return { k: "neg", a: this.unary() };
    }
    if (this.isOp("+")) {
      this.pos++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Node {
    const base = this.atom();
    if (this.isOp("^")) {
      this.pos++;
      return { k: "bin", op: "^", a: base, b: this.unary() };
    }
    return base;
  }

  private atom(): Node {
    const t = this.tokens[this.pos++];
    if (!t) throw new Error("unexpected end");
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "op" && t.v === "(") {
      const inner = this.expr();
      if (!this.isOp(")")) throw new Error("missing )");
      this.pos++;
      return inner;
    }
    if (t.t === "id") {
      const parts = splitIdentifier(t.v);
      if (!parts) throw new Error(`unknown name ${t.v}`);
      // Re-queue every piece but the first, so "2pix" parses as 2 * pi * x.
      if (parts.length > 1) {
        this.tokens.splice(this.pos, 0, ...parts.slice(1).map((v): Token => ({ t: "id", v })));
      }
      const name = parts[0];
      if (name === "x") return { k: "x" };
      if (name in CONSTANTS) return { k: "num", v: CONSTANTS[name] };
      const f = FUNCTIONS[name];
      // A function takes a parenthesized argument, or binds to the next power
      // ("sin x", "sqrt 2x" reads as sqrt(2) * x — like a calculator).
      if (this.isOp("(")) {
        this.pos++;
        const arg = this.expr();
        if (!this.isOp(")")) throw new Error("missing )");
        this.pos++;
        return { k: "fn", f, a: arg };
      }
      return { k: "fn", f, a: this.power() };
    }
    throw new Error(`unexpected ${t.v}`);
  }
}

function evaluate(node: Node, x: number): number {
  switch (node.k) {
    case "num":
      return node.v;
    case "x":
      return x;
    case "neg":
      return -evaluate(node.a, x);
    case "fn":
      return node.f(evaluate(node.a, x));
    case "bin": {
      const a = evaluate(node.a, x);
      const b = evaluate(node.b, x);
      switch (node.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "^":
          return a ** b;
      }
    }
  }
}

/** Compile an expression in x, or null if it isn't one we understand. */
export function compileExpression(src: string): ((x: number) => number) | null {
  if (typeof src !== "string" || src.length > 200) return null;
  // The model sometimes writes "y = 2x + 1" in expr; the right side is the function.
  const body = src.replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=/i, "");
  const tokens = tokenize(body);
  if (!tokens || tokens.length === 0) return null;
  try {
    const tree = new Parser(tokens).parse();
    if (!tree) return null;
    return (x: number) => evaluate(tree, x);
  } catch {
    return null;
  }
}
