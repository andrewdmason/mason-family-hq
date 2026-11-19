import Foundation

/// A function of x the tutor asks a graph to draw ("2*x+1", "sqrt(x)^2"). The
/// grammar is the one the tutor is told about (src/lib/tuttles/prompt.ts):
/// numbers, x, pi, + - * / ^, parentheses, unary minus, and a few functions.
/// Parsed once into a tree and evaluated per point; anything else fails to
/// parse and the graph leaves that line out.
indirect enum Expression {
    case number(Double)
    case x
    case unary(Expression)
    case binary(Character, Expression, Expression)
    case call(String, Expression)

    static let functions: [String: (Double) -> Double] = [
        "sqrt": { $0.squareRoot() }, "abs": { Swift.abs($0) },
        "sin": { Foundation.sin($0) }, "cos": { Foundation.cos($0) }, "tan": { Foundation.tan($0) },
        "log": { Foundation.log($0) }, "exp": { Foundation.exp($0) },
    ]

    func value(at x: Double) -> Double {
        switch self {
        case .number(let n): n
        case .x: x
        case .unary(let e): -e.value(at: x)
        case .call(let name, let e): Self.functions[name]?(e.value(at: x)) ?? .nan
        case .binary(let op, let a, let b):
            switch op {
            case "+": a.value(at: x) + b.value(at: x)
            case "-": a.value(at: x) - b.value(at: x)
            case "*": a.value(at: x) * b.value(at: x)
            case "/": a.value(at: x) / b.value(at: x)
            default: pow(a.value(at: x), b.value(at: x))
            }
        }
    }

    /// Nil when the text isn't in the grammar. Tolerates "Math." prefixes and
    /// "**" for powers, which a model used to JavaScript tends to write.
    static func parse(_ text: String) -> Expression? {
        var parser = Parser(Array(text.replacingOccurrences(of: "Math.", with: "")
            .replacingOccurrences(of: "**", with: "^").lowercased()))
        guard let e = parser.sum(), parser.atEnd else { return nil }
        return e
    }

    private struct Parser {
        let chars: [Character]
        var i = 0
        init(_ chars: [Character]) { self.chars = chars }

        var atEnd: Bool { mutating get { skipSpace(); return i == chars.count } }

        mutating func skipSpace() { while i < chars.count, chars[i] == " " { i += 1 } }

        mutating func peek() -> Character? { skipSpace(); return i < chars.count ? chars[i] : nil }

        mutating func sum() -> Expression? {
            guard var left = product() else { return nil }
            while let op = peek(), op == "+" || op == "-" {
                i += 1
                guard let right = product() else { return nil }
                left = .binary(op, left, right)
            }
            return left
        }

        mutating func product() -> Expression? {
            guard var left = power() else { return nil }
            while let op = peek() {
                if op == "*" || op == "/" {
                    i += 1
                    guard let right = power() else { return nil }
                    left = .binary(op, left, right)
                } else if op == "x" || op == "(" || op.isLetter {
                    // "2x", "3(x+1)": multiplication written by juxtaposition.
                    guard let right = power() else { return nil }
                    left = .binary("*", left, right)
                } else { break }
            }
            return left
        }

        mutating func power() -> Expression? {
            guard let base = unary() else { return nil }
            if peek() == "^" {
                i += 1
                guard let exponent = power() else { return nil }  // right-associative
                return .binary("^", base, exponent)
            }
            return base
        }

        mutating func unary() -> Expression? {
            if peek() == "-" {
                i += 1
                return power().map { .unary($0) }
            }
            if peek() == "+" { i += 1 }
            return atom()
        }

        mutating func atom() -> Expression? {
            guard let c = peek() else { return nil }
            if c == "(" {
                i += 1
                guard let e = sum(), peek() == ")" else { return nil }
                i += 1
                return e
            }
            if c.isNumber || c == "." {
                let start = i
                while i < chars.count, chars[i].isNumber || chars[i] == "." { i += 1 }
                return Double(String(chars[start..<i])).map { .number($0) }
            }
            if c.isLetter {
                let start = i
                while i < chars.count, chars[i].isLetter { i += 1 }
                let word = String(chars[start..<i])
                if word == "x" { return .x }
                if word == "pi" { return .number(.pi) }
                if word == "e" { return .number(M_E) }
                guard Expression.functions[word] != nil, peek() == "(" else { return nil }
                i += 1
                guard let arg = sum(), peek() == ")" else { return nil }
                i += 1
                return .call(word, arg)
            }
            return nil
        }
    }
}
