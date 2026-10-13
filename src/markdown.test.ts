import { describe, expect, it } from "vitest";
import { escapeMd } from "./markdown";

describe("escapeMd", () => {
  it("turns a command link into text", () => {
    const out = escapeMd("[click](command:workbench.action.terminal.new)");
    expect(out).toBe("\\[click\\]\\(command\\:workbench\\.action\\.terminal\\.new\\)");
  });

  it("turns a theme icon into text", () => {
    expect(escapeMd("$(alert) boom")).toBe("\\$\\(alert\\) boom");
  });

  it("escapes emphasis, HTML and entities", () => {
    expect(escapeMd("**a** <img> &#91;")).toBe("\\*\\*a\\*\\* \\<img\\> \\&\\#91;");
  });

  it("keeps a value on one line", () => {
    expect(escapeMd("a\n# b\r\nc")).toBe("a \\# b c");
  });

  it("leaves plain words alone", () => {
    expect(escapeMd("OrdersController GetById")).toBe("OrdersController GetById");
  });
});
